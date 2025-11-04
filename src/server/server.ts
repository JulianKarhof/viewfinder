import db from "../db";
import { logger } from "../logger";
import type { Command } from "../types";
import { ClientManager, type WebSocketData } from "./clientManager";
import { ServerCommandHandler } from "./handlers";

const log = logger.server;

export function startServer(port: number = 3000) {
	process.title = "viewfinder:server";
	const clientManager = new ClientManager();
	const commandHandler = new ServerCommandHandler(clientManager);

	const server: Bun.Server = Bun.serve({
		port,
		websocket: {
			message(ws: Bun.ServerWebSocket<WebSocketData>, message) {
				let command: Command;
				try {
					command = JSON.parse(message.toString());
				} catch (error) {
					log.error("Failed to parse message:", error);
					return;
				}

				log.debug("⬅️  Message from client", command);

				commandHandler.handleCommand(ws, command, String(message));
			},
			open(ws: Bun.ServerWebSocket<WebSocketData>) {
				clientManager.add(ws);

				const initialMessage = JSON.stringify({
					type: "dbInit",
					shapes: db.shapes,
				});
				ws.send(initialMessage);
			},
			close(ws: Bun.ServerWebSocket<WebSocketData>) {
				clientManager.remove(ws);
			},
		},
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/") {
				const html = await Bun.file("src/web/index.html").text();
				return new Response(html, {
					headers: { "Content-Type": "text/html" },
				});
			}

			if (url.pathname === "/index.js") {
				try {
					const tsContent = await Bun.file("src/web/index.ts").text();
					const transpiler = new Bun.Transpiler({ loader: "tsx" });
					const jsContent = transpiler.transformSync(tsContent);

					return new Response(jsContent, {
						headers: { "Content-Type": "application/javascript" },
					});
				} catch (error) {
					log.error("TypeScript transpilation error:", error);
					return new Response("Transpilation failed", { status: 500 });
				}
			}

			if (url.pathname === "/ws") {
				const isWeb = url.searchParams.get("client") === "web";
				const clientId = url.searchParams.get("clientId");
				const success = server.upgrade(req, {
					data: { isWeb, clientId: clientId ? parseInt(clientId, 10) : 0 },
				});

				return success
					? undefined
					: new Response("Failed to upgrade", { status: 500 });
			}

			if (url.pathname === "/api/db") {
				const serializedDb = {
					shapes: db.shapes,
					clients: clientManager.toDbFormat().map((client) => ({
						...client,
						lastSeenVersion: Object.fromEntries(client.lastSeenVersion),
					})),
				};
				return new Response(JSON.stringify(serializedDb), {
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	log.info(`🔗 Server running at http://localhost:${server.port}`);

	return {
		server,
		clientManager,
		stop: () => server.stop(),
	};
}

if (import.meta.main) {
	startServer();
}

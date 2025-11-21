import * as microtime from "microtime";
import SuperJSON from "superjson";
import db from "../db";
import { logger } from "../logger";
import type { Command, StartupReadyMessage } from "../types";
import { ClientManager, type WebSocketData } from "./clientManager";
import { ServerCommandHandler } from "./handlers";
import { ServerMetricsCollector } from "./metrics";

const log = logger.server;

export function startServer(
	port: number = 3000,
	enableViewportFiltering: boolean = process.env.ENABLE_VIEWPORT_FILTERING ===
		"true",
) {
	process.title = "viewfinder:server";

	log.info(
		`🔧 Viewport filtering: ${enableViewportFiltering ? "ENABLED" : "DISABLED"}`,
	);

	const clientManager = new ClientManager({ enableViewportFiltering });
	const commandHandler = new ServerCommandHandler(clientManager);
	const metricsCollector = new ServerMetricsCollector(clientManager);

	metricsCollector.startCollection();

	const server: Bun.Server = Bun.serve({
		port,
		websocket: {
			message(ws: Bun.ServerWebSocket<WebSocketData>, message) {
				let command: Command;
				try {
					command = SuperJSON.parse(message.toString());
				} catch (error) {
					log.error("Failed to parse message:", error);
					return;
				}

				const timestampedCommand = {
					...command,
					serverReceivedAt: microtime.now(),
				} as Command;

				log.debug("⬅️  Message from client", timestampedCommand);

				commandHandler.handleCommand(ws, timestampedCommand);
			},
			open(ws: Bun.ServerWebSocket<WebSocketData>) {
				clientManager.add(ws);

				const initialMessage = SuperJSON.stringify({
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
				const parsedClientId = clientId ? parseInt(clientId, 10) : 0;

				const success = server.upgrade(req, {
					data: { isWeb, clientId: parsedClientId },
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

	process.send?.({
		type: "ready",
		processType: "server",
		processId: "server",
		timestamp: Date.now(),
	} as StartupReadyMessage);

	process.on("SIGTERM", () => {
		metricsCollector.stopCollection();
		server.stop();
		process.exit(0);
	});

	return {
		server,
		clientManager,
		stop: () => server.stop(),
	};
}

if (import.meta.main) {
	startServer();
}

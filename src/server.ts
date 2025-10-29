import db from "./db";
import { logger } from "./logger";
import type { Action } from "./types";

const log = logger.server;

interface WebSocketData {
	isWeb?: boolean;
	clientId: number;
}

export function startServer(port: number = 3000) {
	process.title = "viewfinder:server";
	const clients = new Set<Bun.ServerWebSocket<WebSocketData>>();
	const webClients = new Set<Bun.ServerWebSocket<WebSocketData>>();

	const server: Bun.Server = Bun.serve({
		port,
		websocket: {
			message(ws: Bun.ServerWebSocket<WebSocketData>, message) {
				let action: Action;
				try {
					action = JSON.parse(message.toString());
				} catch (error) {
					log.error("Failed to parse message:", error);
					return;
				}

				log.debug("⬅️  Message from client", message);

				switch (action.type) {
					case "moveShape": {
						db.shapes = db.shapes.map((shape) => {
							if (String(shape.id) === String(action.shape.id)) {
								const updatedShape = { ...shape };
								Object.keys(action.shape).forEach((key) => {
									const value = (action.shape as Record<string, unknown>)[key];
									if (value !== undefined) {
										(updatedShape as Record<string, unknown>)[key] = value;
									}
								});
								return updatedShape;
							}
							return shape;
						});
						break;
					}
					case "addShape": {
						db.shapes.push(action.shape);
						break;
					}
					case "deleteShape": {
						db.shapes = db.shapes.filter(
							(shape) => String(shape.id) !== String(action.shape.id),
						);
						break;
					}
					case "moveWindow": {
						const wsIndex = Array.from(clients).indexOf(ws);
						db.clients = db.clients.map((client, index) => {
							if (index === wsIndex) {
								return {
									...client,
									location: {
										...client.location,
										x: action.location.x,
										y: action.location.y,
									},
								};
							}
							return client;
						});
						break;
					}
				}

				log.debug(`➡️  Sending update to ${clients.size - 1} clients`);

				webClients.forEach((client) => {
					if (client !== ws) {
						client.send("reload");
					}
				});

				if (action.type === "moveWindow") return;

				clients.forEach((client) => {
					if (client !== ws) {
						client.send(message);
					}
				});
			},
			open(ws: Bun.ServerWebSocket<WebSocketData>) {
				if (ws.data?.isWeb) {
					webClients.add(ws);
					log.info(`🤝 New web client connected (${webClients.size} total)`);
				} else {
					clients.add(ws);
					db.clients.push({
						id: ws.data?.clientId,
						location: { x: 0, y: 0, height: 200, width: 300 },
					});
				}

				const initialMessage = JSON.stringify({
					type: "dbInit",
					shapes: db.shapes,
				});
				ws.send(initialMessage);
			},
			close(ws: Bun.ServerWebSocket<WebSocketData>) {
				if (ws.data?.isWeb) {
					webClients.delete(ws);
				} else {
					clients.delete(ws);
				}
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
					data: { isWeb, clientId },
				});

				return success
					? undefined
					: new Response("Failed to upgrade", { status: 500 });
			}

			if (url.pathname === "/api/db") {
				return new Response(JSON.stringify(db), {
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/api/status") {
				return new Response("OK");
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	log.info(`🔗 Server running at http://localhost:${server.port}`);

	return {
		server,
		clients,
		stop: () => server.stop(),
	};
}

if (import.meta.main) {
	startServer();
}

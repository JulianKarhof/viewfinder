import db from "./db";
import { logger } from "./logger";
import type { Action } from "./types";

const log = logger.server;

export function startServer(port: number = 3000) {
	process.title = "viewfinder:server";
	const clients = new Set<Bun.ServerWebSocket<unknown>>();

	const server: Bun.Server = Bun.serve({
		port,
		websocket: {
			message(_, message) {
				let action: Action;
				try {
					if (typeof message === "string") {
						action = JSON.parse(message);
					} else {
						action = message as unknown as Action;
					}
				} catch (error) {
					log.error("Failed to parse message:", error);
					return;
				}

				log.debug("Message from client", message);

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
				}

				log.debug("Db Update", db);

				const updateMessage = JSON.stringify({
					type: "dbUpdate",
					shapes: db.shapes,
				});

				clients.forEach((client) => {
					client.send(updateMessage);
				});
			},
			open(ws) {
				clients.add(ws);

				// Send initial data to new client
				const initialMessage = JSON.stringify({
					type: "dbUpdate",
					shapes: db.shapes,
				});
				ws.send(initialMessage);
			},
			close(ws) {
				clients.delete(ws);
			},
		},
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/ws") {
				const success = server.upgrade(req);
				return success
					? undefined
					: new Response("Failed to upgrade", { status: 500 });
			}

			if (url.pathname === "/api/shapes") {
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

	log.info(`🚀 Server running at http://localhost:${server.port}`);

	return {
		server,
		clients,
		stop: () => server.stop(),
	};
}

if (import.meta.main) {
	startServer();
}

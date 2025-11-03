import { ClientManager, type WebSocketData } from "./clientManager";
import db from "./db";
import { logger } from "./logger";
import type { Action, Shape } from "./types";

const log = logger.server;

export function startServer(port: number = 3000) {
	process.title = "viewfinder:server";
	const clientManager = new ClientManager();

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

				log.debug("⬅️  Message from client", action);

				switch (action.type) {
					case "updateShape": {
						const shape = db.shapes.find(
							(s) => String(s.id) === String(action.shape.id),
						);
						if (shape) {
							Object.assign(shape, action.shape);
							shape.version += 1;
							clientManager.updateLastSeenVersions(shape);
						}
						break;
					}
					case "addShape": {
						if (!action.shape) break;
						db.shapes.push(action.shape);

						const client = clientManager.get(ws.data.clientId);
						if (client) {
							client.lastSeenVersion.set(action.shape.id, action.shape.version);
						}

						clientManager.updateLastSeenVersions(action.shape);
						break;
					}
					case "deleteShape": {
						const shape = db.shapes.find(
							(s) => String(s.id) === String(action.shape.id),
						);

						if (!shape) break;
						shape.isDeleted = true;
						shape.version += 1;

						clientManager.updateLastSeenVersions(shape);
						break;
					}
					case "moveWindow": {
						const client = clientManager.updateClientViewport(
							ws.data.clientId,
							action.location.x,
							action.location.y,
						);

						if (!client) break;

						const shapesInViewport = clientManager.getShapesInViewport(
							db.shapes,
							client.viewport,
						);

						const shapesToSend = shapesInViewport.filter((shape) => {
							const lastSeenVersion = client.lastSeenVersion.get(
								String(shape.id),
							);
							if (lastSeenVersion === undefined) return true;
							return shape.version > lastSeenVersion;
						});

						shapesInViewport.forEach((shape) => {
							client.lastSeenVersion.set(String(shape.id), shape.version);
						});

						if (shapesToSend.length === 0) {
							break;
						}

						const updateMessage = JSON.stringify({
							type: "bulkUpdate",
							shapes: shapesToSend,
						});

						log.debug(
							`🔷 Sending ${shapesToSend.length} updated shapes to client ${ws.data.clientId}`,
						);

						ws.send(updateMessage);
						break;
					}
					default:
						log.warn(`⚠️ Unknown action type: ${action}`);
				}

				clientManager.broadcastToWebClients("reload", ws);

				if (action.type === "moveWindow") return;

				let affectedShape: Shape | undefined;

				switch (action.type) {
					case "updateShape":
					case "deleteShape": {
						affectedShape = db.shapes.find(
							(s) => String(s.id) === String(action.shape.id),
						);
						break;
					}
					case "addShape": {
						affectedShape = action.shape;
						break;
					}
				}

				if (affectedShape) {
					clientManager.sendToClientsInViewport(
						affectedShape,
						String(message),
						ws,
					);
				}
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

import db from "./db";
import { logger } from "./logger";
import type { Action, Shape, Viewport } from "./types";

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

				log.debug("⬅️  Message from client", action);

				switch (action.type) {
					case "updateShape": {
						const shape = db.shapes.find(
							(s) => String(s.id) === String(action.shape.id),
						);
						if (shape) {
							Object.assign(shape, action.shape);
							shape.version += 1;
						}

						db.clients.forEach((client) => {
							if (!shape) return;
							const shapesInViewport = getShapesInViewport(
								[shape],
								client.viewport,
							);
							if (shapesInViewport.length > 0) {
								client.lastSeenVersion.set(String(shape.id), shape.version);
							}
						});
						break;
					}
					case "addShape": {
						if (!action.shape) break;
						db.shapes.push(action.shape);
						db.clients
							.find((client) => client.id === ws.data.clientId)
							?.lastSeenVersion.set(action.shape.id, action.shape.version);

						db.clients.forEach((client) => {
							if (!action.shape) return;
							const shapesInViewport = getShapesInViewport(
								[action.shape],
								client.viewport,
							);
							if (shapesInViewport.length > 0) {
								client.lastSeenVersion.set(
									String(action.shape.id),
									action.shape.version,
								);
							}
						});
						break;
					}
					case "deleteShape": {
						const shape = db.shapes.find(
							(s) => String(s.id) === String(action.shape.id),
						);

						if (!shape) break;
						shape.isDeleted = true;
						shape.version += 1;

						db.clients.forEach((client) => {
							if (!shape) return;
							const shapesInViewport = getShapesInViewport(
								[shape],
								client.viewport,
							);
							if (shapesInViewport.length > 0) {
								client.lastSeenVersion.set(String(shape.id), shape.version);
							}
						});

						break;
					}
					case "moveWindow": {
						const client = db.clients.find(
							(client) => client.id === ws.data.clientId,
						);
						if (!client) {
							log.error(`Client with id ${ws.data.clientId} not found`);
							break;
						}

						client.viewport.x = action.location.x;
						client.viewport.y = action.location.y;

						const shapesInViewport = getShapesInViewport(
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

				webClients.forEach((client) => {
					if (client !== ws) {
						client.send("reload");
					}
				});

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

				if (!affectedShape) return;

				clients.forEach((client) => {
					if (client === ws) return;

					const dbClient = db.clients.find(
						(c) => c.id === client.data.clientId,
					);
					if (!dbClient) return;

					const shapesInViewport = getShapesInViewport(
						[affectedShape],
						dbClient.viewport,
					);
					if (shapesInViewport.length > 0) {
						client.send(message);
						log.debug(
							`➡️  Sent update to client ${client.data.clientId} (shape is visible)`,
						);
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
						viewport: { x: 0, y: 0, height: 200, width: 300 },
						lastSeenVersion: new Map(),
						connectedAt: Date.now(),
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
					data: { isWeb, clientId: clientId ? parseInt(clientId, 10) : 0 },
				});

				return success
					? undefined
					: new Response("Failed to upgrade", { status: 500 });
			}

			if (url.pathname === "/api/db") {
				const serializedDb = {
					shapes: db.shapes,
					clients: db.clients.map((client) => ({
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

	function getShapesInViewport(shapes: Shape[], viewport: Viewport): Shape[] {
		return shapes.filter(
			(shape) =>
				shape.x >= viewport.x &&
				shape.x <= viewport.x + viewport.width &&
				shape.y >= viewport.y &&
				shape.y <= viewport.y + viewport.height,
		);
	}

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

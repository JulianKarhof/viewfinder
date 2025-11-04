import { logger } from "../logger";
import type { Client, Shape, Viewport } from "../types";

export interface ManagedClient {
	id: number;
	ws: Bun.ServerWebSocket<WebSocketData>;
	isWeb: boolean;
	viewport: Viewport;
	lastSeenVersion: Map<string, number>;
	connectedAt: number;
}

export interface WebSocketData {
	isWeb?: boolean;
	clientId: number;
}

const log = logger.server;

export class ClientManager {
	private _clients = new Map<number, ManagedClient>();

	public add(ws: Bun.ServerWebSocket<WebSocketData>): void {
		const clientId = ws.data.clientId;
		const isWeb = ws.data.isWeb || false;

		const client: ManagedClient = {
			id: clientId,
			ws,
			isWeb,
			viewport: { x: 0, y: 0, height: 200, width: 300 },
			lastSeenVersion: new Map(),
			connectedAt: Date.now(),
		};

		this._clients.set(clientId, client);

		if (isWeb) {
			log.info(
				`🤝 New web client connected (${this.getWebClients().length} total web clients)`,
			);
		} else {
			log.info(
				`🤝 New client ${clientId} connected (${this.getClients().length} total clients)`,
			);
		}
	}

	public remove(ws: Bun.ServerWebSocket<WebSocketData>): void {
		const clientId = ws.data.clientId;
		const client = this._clients.get(clientId);

		if (client) {
			this._clients.delete(clientId);

			if (client.isWeb) {
				log.info(
					`🛑 Web client disconnected (${this.getWebClients().length} remaining)`,
				);
			} else {
				log.info(
					`🛑 Client ${clientId} disconnected (${this.getClients().length} remaining)`,
				);
			}
		}
	}

	public broadcastToClients(
		message: string,
		excludeWs?: Bun.ServerWebSocket<WebSocketData>,
	): void {
		this.getClients().forEach((client) => {
			if (client.ws !== excludeWs) {
				client.ws.send(message);
			}
		});
	}

	public broadcastToWebClients(
		message: string,
		excludeWs?: Bun.ServerWebSocket<WebSocketData>,
	): void {
		this.getWebClients().forEach((client) => {
			if (client.ws !== excludeWs) {
				client.ws.send(message);
			}
		});
	}

	public sendToClientsInViewport(
		shape: Shape,
		message: string,
		excludeWs?: Bun.ServerWebSocket<WebSocketData>,
	): void {
		this.getClients().forEach((client) => {
			if (client.ws === excludeWs) return;

			const shapesInViewport = this.getShapesInViewport(
				[shape],
				client.viewport,
			);
			if (shapesInViewport.length > 0) {
				client.ws.send(message);
				log.debug(`➡️  Sent update to client ${client.id} (shape is visible)`);
			}
		});
	}

	public updateClientViewport(
		clientId: number,
		x: number,
		y: number,
	): ManagedClient | null {
		const client = this.get(clientId);
		if (!client) {
			log.error(`Client with id ${clientId} not found`);
			return null;
		}

		client.viewport.x = x;
		client.viewport.y = y;
		return client;
	}

	public updateLastSeenVersions(shape: Shape): void {
		this.getClients().forEach((client) => {
			const shapesInViewport = this.getShapesInViewport(
				[shape],
				client.viewport,
			);
			if (shapesInViewport.length > 0) {
				client.lastSeenVersion.set(String(shape.id), shape.version);
			}
		});
	}

	public getShapesInViewport(shapes: Shape[], viewport: Viewport): Shape[] {
		return shapes.filter(
			(shape) =>
				shape.x >= viewport.x &&
				shape.x <= viewport.x + viewport.width &&
				shape.y >= viewport.y &&
				shape.y <= viewport.y + viewport.height,
		);
	}

	public toDbFormat(): Client[] {
		return this.getClients().map((client) => ({
			id: client.id,
			viewport: client.viewport,
			lastSeenVersion: client.lastSeenVersion,
			connectedAt: client.connectedAt,
		}));
	}

	public get(clientId: number): ManagedClient | undefined {
		return this._clients.get(clientId);
	}

	private _getAll(): ManagedClient[] {
		return Array.from(this._clients.values());
	}

	public getWebClients(): ManagedClient[] {
		return this._getAll().filter((client) => client.isWeb);
	}

	public getClients(): ManagedClient[] {
		return this._getAll().filter((client) => !client.isWeb);
	}
}

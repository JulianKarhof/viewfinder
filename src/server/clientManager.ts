import * as microtime from "microtime";
import SuperJSON from "superjson";
import { logger } from "../logger";
import type { Client, Event, Shape, Viewport } from "../types";

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

export interface ClientManagerConfig {
	enableViewportFiltering: boolean;
}

const log = logger.server;

export class ClientManager {
	private _clients = new Map<number, ManagedClient>();
	private _config: ClientManagerConfig;

	public constructor(
		config: ClientManagerConfig = { enableViewportFiltering: true },
	) {
		this._config = config;
	}

	public isViewportFilteringEnabled(): boolean {
		return this._config.enableViewportFiltering;
	}

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

	private _sendToClient(
		client: Bun.ServerWebSocket<WebSocketData>,
		event: Event,
	) {
		const timestampedEvent = {
			...event,
			serverSentAt: microtime.now(),
		} as Event;
		client.send(SuperJSON.stringify(timestampedEvent));
	}

	public broadcastToClients(
		event: Event,
		excludeWs?: Bun.ServerWebSocket<WebSocketData>,
	): void {
		this.getClients().forEach((client) => {
			if (client.ws !== excludeWs) {
				this._sendToClient(client.ws, event);
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
		event: Event,
		excludeWs?: Bun.ServerWebSocket<WebSocketData>,
	): void {
		this.getClients().forEach((client) => {
			if (client.ws === excludeWs) return;

			if (this.isViewportFilteringEnabled()) {
				const shapesInViewport = this.getShapesInViewport(
					[shape],
					client.viewport,
				);
				if (shapesInViewport.length > 0) {
					this._sendToClient(client.ws, event);
				}
			} else {
				this._sendToClient(client.ws, event);
				log.debug(`➡️  Sent update to client ${client.id}`);
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
		if (!this.isViewportFilteringEnabled()) {
			return;
		}

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

	public getShapesInViewport(
		shapes: Shape[],
		viewport: Viewport,
		margin: number = 100,
	): Shape[] {
		return shapes.filter(
			(shape) =>
				shape.x >= viewport.x - margin &&
				shape.x <= viewport.x + viewport.width + margin &&
				shape.y >= viewport.y - margin &&
				shape.y <= viewport.y + viewport.height + margin,
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

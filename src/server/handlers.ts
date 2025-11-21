import * as microtime from "microtime";
import SuperJSON from "superjson";
import db from "../db";
import { logger } from "../logger";
import type {
	Command,
	CreateShapeCommand,
	DeleteShapeCommand,
	Event,
	MoveWindowCommand,
	Shape,
	UpdateShapeCommand,
} from "../types";
import type { ClientManager, WebSocketData } from "./clientManager";

const log = logger.server;

export class ServerCommandHandler {
	public constructor(private _clientManager: ClientManager) {}

	public handleCommand(
		ws: Bun.ServerWebSocket<WebSocketData>,
		command: Command,
	): void {
		log.debug("⬅️  Message from client", command);

		switch (command.type) {
			case "updateShape":
				this._handleUpdateShape(command);
				break;
			case "createShape":
				this._handleCreateShape(ws, command);
				break;
			case "deleteShape":
				this._handleDeleteShape(command);
				break;
			case "moveWindow":
				this._handleMoveWindow(ws, command);
				break;
			default:
				log.warn(`⚠️ Unknown command type: ${command}`);
				return;
		}

		this._clientManager.broadcastToWebClients("reload", ws);
		if (command.type === "moveWindow") return;
		this._handleShapeUpdate(ws, command);
	}

	private _handleUpdateShape(command: UpdateShapeCommand): void {
		const shape = db.shapes.find(
			(s) => String(s.id) === String(command.shape.id),
		);
		if (shape) {
			Object.assign(shape, command.shape);
			shape.version += 1;
			this._clientManager.updateLastSeenVersions(shape);
		}
	}

	private _handleCreateShape(
		ws: Bun.ServerWebSocket<WebSocketData>,
		command: CreateShapeCommand,
	): void {
		if (!command.shape) return;

		db.shapes.push(command.shape);

		if (this._clientManager.isViewportFilteringEnabled()) {
			return;
		}

		const client = this._clientManager.get(ws.data.clientId);
		if (client) {
			client.lastSeenVersion.set(command.shape.id, command.shape.version);
		}

		this._clientManager.updateLastSeenVersions(command.shape);
	}

	private _handleDeleteShape(command: DeleteShapeCommand): void {
		const shape = db.shapes.find(
			(s) => String(s.id) === String(command.shapeId),
		);

		if (!shape) return;

		shape.isDeleted = true;
		shape.version += 1;
		this._clientManager.updateLastSeenVersions(shape);
	}

	private _handleMoveWindow(
		ws: Bun.ServerWebSocket<WebSocketData>,
		command: MoveWindowCommand,
	): void {
		if (!this._clientManager.isViewportFilteringEnabled()) {
			return;
		}

		const client = this._clientManager.updateClientViewport(
			ws.data.clientId,
			command.location.x,
			command.location.y,
		);

		if (!client) return;

		const shapesInViewport = this._clientManager.getShapesInViewport(
			db.shapes,
			client.viewport,
		);

		const shapesToSend = shapesInViewport.filter((shape) => {
			const lastSeenVersion = client.lastSeenVersion.get(String(shape.id));
			if (lastSeenVersion === undefined) return true;
			return shape.version > lastSeenVersion;
		});

		shapesInViewport.forEach((shape) => {
			client.lastSeenVersion.set(String(shape.id), shape.version);
		});

		if (shapesToSend.length === 0) return;

		const updateEvent = {
			type: "bulkUpdate",
			shapes: shapesToSend,
			serverSentAt: microtime.now(),
		} as Event;

		log.info(
			`🔷 Sending ${shapesToSend.length} updated shapes to client ${ws.data.clientId}`,
		);

		ws.send(SuperJSON.stringify(updateEvent));
	}

	private _handleShapeUpdate(
		ws: Bun.ServerWebSocket<WebSocketData>,
		command: Command,
	): void {
		let affectedShape: Shape | undefined;
		let event: Event | null = null;

		switch (command.type) {
			case "updateShape":
				affectedShape = db.shapes.find(
					(s) => String(s.id) === String(command.shape.id),
				);
				if (!affectedShape) break;
				event = {
					...command,
					type: "updatedShape",
					shape: affectedShape,
				};
				break;
			case "deleteShape":
				affectedShape = db.shapes.find(
					(s) => String(s.id) === String(command.shapeId),
				);
				event = {
					...command,
					type: "deletedShape",
				};
				break;
			case "createShape":
				affectedShape = command.shape;
				if (!affectedShape) break;
				event = {
					...command,
					type: "createdShape",
					shape: affectedShape,
				};
				break;
		}

		if (event === null) {
			log.warn(`⚠️ Unable to determine event type for command: ${command}`);
			return;
		}

		if (affectedShape) {
			this._clientManager.sendToClientsInViewport(affectedShape, event, ws);
		}
	}
}

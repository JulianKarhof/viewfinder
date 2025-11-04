import db from "../db";
import { logger } from "../logger";
import type {
	Command,
	CreateShapeCommand,
	DeleteShapeCommand,
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
		message: string,
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
				return; // Skip broadcasting and shape updates
			default:
				log.warn(`⚠️ Unknown command type: ${command}`);
				return;
		}

		this._clientManager.broadcastToWebClients("reload", ws);
		this._handleShapeUpdate(ws, command, message);
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

		const updateMessage = JSON.stringify({
			type: "bulkUpdate",
			shapes: shapesToSend,
		});

		log.debug(
			`🔷 Sending ${shapesToSend.length} updated shapes to client ${ws.data.clientId}`,
		);

		ws.send(updateMessage);
	}

	private _handleShapeUpdate(
		ws: Bun.ServerWebSocket<WebSocketData>,
		command: Command,
		message: string,
	): void {
		let affectedShape: Shape | undefined;

		switch (command.type) {
			case "updateShape":
				affectedShape = db.shapes.find(
					(s) => String(s.id) === String(command.shape.id),
				);
				break;
			case "deleteShape":
				affectedShape = db.shapes.find(
					(s) => String(s.id) === String(command.shapeId),
				);
				break;
			case "createShape":
				affectedShape = command.shape;
				break;
		}

		if (affectedShape) {
			this._clientManager.sendToClientsInViewport(affectedShape, message, ws);
		}
	}
}

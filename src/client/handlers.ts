import { Settings } from "../env.ts";
import { logger } from "../logger.ts";
import type {
	BulkUpdateEvent,
	Command,
	CommandMessage,
	CommandResponse,
	CreatedShapeEvent,
	CreateShapeCommand,
	DeletedShapeEvent,
	Event,
	MoveWindowCommand,
	UpdatedShapeEvent,
} from "../types.ts";
import { seededRandom } from "../utils/seededRandom.js";
import { type ClientState, generateClientColor } from "./client.ts";

export class EventHandler {
	public constructor(
		private _clientState: ClientState,
		private _clientId: number,
	) {
		this._log = logger.client(this._clientId);
	}

	private _log: ReturnType<typeof logger.client>;

	public handleEvent(event: Event): void {
		this._log.debug("🔄 Updating local state", event);

		switch (event.type) {
			case "updatedShape":
				this._handleUpdatedShape(event);
				break;
			case "createdShape":
				this._handleCreatedShape(event);
				break;
			case "deletedShape":
				this._handleDeletedShape(event);
				break;
			case "bulkUpdate":
				this._handleBulkUpdate(event);
				break;
		}

		this._log.debug("✅ Local state updated", this._clientState);
	}

	private _handleUpdatedShape(event: UpdatedShapeEvent): void {
		const shape = this._clientState.shapes.find(
			(s) => String(s.id) === String(event.shape.id),
		);
		if (shape) {
			Object.assign(shape, event.shape);
		}
	}

	private _handleCreatedShape(event: CreatedShapeEvent): void {
		if (event.shape) {
			this._clientState.shapes.push(event.shape);
		}
	}

	private _handleDeletedShape(event: DeletedShapeEvent): void {
		this._clientState.shapes = this._clientState.shapes.filter(
			(shape) => String(shape.id) !== String(event.shapeId),
		);
	}

	private _handleBulkUpdate(event: BulkUpdateEvent): void {
		event.shapes.forEach((updatedShape) => {
			const shape = this._clientState.shapes.find(
				(s) => String(s.id) === String(updatedShape.id),
			);

			if (shape) {
				Object.assign(shape, updatedShape);
			} else {
				this._clientState.shapes.push(updatedShape);
			}
		});
	}
}

export class CommandHandler {
	private _log: ReturnType<typeof logger.client>;

	public constructor(
		private _clientState: ClientState,
		private _clientId: number,
		private _sendMessage: (command: Command) => void,
	) {
		this._log = logger.client(this._clientId);
	}

	public handleCommand(message: CommandMessage): CommandResponse {
		const { command } = message;
		const response: CommandResponse = {
			id: message.id,
			success: true,
			type: "response",
		};

		switch (command.type) {
			case "ping":
				return this._handlePing(response);
			case "createShape":
				return this._handleCreateShape(command, response);
			case "updateShape":
			case "deleteShape":
				return this._handleShapeCommand(command, response);
			case "moveWindow":
				return this._handleMoveWindow(command, response);
			default:
				response.success = false;
				response.error = "Unknown command type";
				return response;
		}
	}

	private _handlePing(response: CommandResponse): CommandResponse {
		process.send?.(response);
		return response;
	}

	private _handleCreateShape(
		command: CreateShapeCommand,
		response: CommandResponse,
	): CommandResponse {
		if (!command.shape) {
			command.shape = {
				id: `shape-${Date.now()}-${this._clientId}-${seededRandom().toString(36).substring(2, 9)}`,
				version: 0,
				type: "circle",
				x:
					command.coordinateMode === "global"
						? seededRandom() * Settings.canvasWidth
						: this._clientState.location.x +
							seededRandom() * this._clientState.location.width,
				y:
					command.coordinateMode === "global"
						? seededRandom() * Settings.canvasHeight
						: this._clientState.location.y +
							seededRandom() * this._clientState.location.height,
				color: generateClientColor(this._clientId),
				radius: 8,
			};
		}

		response.shapeId = command.shape.id;
		this._sendMessage(command);
		process.send?.(response);
		return response;
	}

	private _handleShapeCommand(
		command: Command,
		response: CommandResponse,
	): CommandResponse {
		this._sendMessage(command);
		process.send?.(response);
		return response;
	}

	private _handleMoveWindow(
		command: MoveWindowCommand,
		response: CommandResponse,
	): CommandResponse {
		const targetX = command.location.x;
		const targetY = command.location.y;
		const currentX = this._clientState.location.x;
		const currentY = this._clientState.location.y;

		const distance = Math.sqrt(
			(targetX - currentX) ** 2 + (targetY - currentY) ** 2,
		);

		if (distance < 20) {
			this._moveWindow(targetX, targetY);
			process.send?.(response);
			return response;
		}

		const steps = Math.min(Math.max(Math.ceil(distance / 30), 1), 8);

		let step = 0;
		const interval = setInterval(() => {
			step++;
			const progress = step / steps;

			const newX = currentX + (targetX - currentX) * progress;
			const newY = currentY + (targetY - currentY) * progress;

			this._moveWindow(newX, newY);

			if (step >= steps) {
				clearInterval(interval);
				this._moveWindow(targetX, targetY);
				process.send?.(response);
			}
		}, Settings.waitTime);

		return response;
	}

	private _moveWindow(x: number, y: number): void {
		this._clientState.location.x = x;
		this._clientState.location.y = y;

		if (process.env.ENABLE_VIEWPORT_FILTERING === "true") {
			this._sendMessage({
				type: "moveWindow",
				location: {
					x,
					y,
				},
			});
		}

		this._log.debug("📍 Moved window to", this._clientState.location);
	}
}

import { logger } from "../logger";
import type {
	Command,
	CommandResponse,
	CreateShapeCommand,
	Shape,
} from "../types";
import type { ProcessRunner } from "./runner";

const log = logger.main;

export class ClientWrapper {
	private _runner: ProcessRunner;
	private _clientId: number;

	public constructor(runner: ProcessRunner, clientId: number) {
		this._runner = runner;
		this._clientId = clientId;
	}

	private get _clientName(): string {
		return `client-${this._clientId}`;
	}

	/**
	 * Pings the client to check if it's responsive.
	 */
	public async ping(): Promise<boolean> {
		const response = await this._runner.sendCommand(this._clientName, {
			type: "ping",
		});
		return response.success === true;
	}

	/**
	 * Moves the client viewport.
	 */
	public async moveWindow(location: {
		x: number;
		y: number;
	}): Promise<CommandResponse> {
		log.info(
			`Client ${this._clientId} moving window to: ${JSON.stringify(location)}`,
		);
		return this._runner.sendCommand(this._clientName, {
			type: "moveWindow",
			location,
		});
	}

	/**
	 * Makes the client send a createShape command. If no shape is provided, the client will generate a random shape within its viewport coordinates.
	 */
	public async createShape(
		shape: Shape,
		coordinateMode: CreateShapeCommand["coordinateMode"] = "global",
	): Promise<CommandResponse> {
		log.info(`Client ${this._clientId} adding shape: ${JSON.stringify(shape)}`);
		return this._runner.sendCommand(this._clientName, {
			type: "createShape",
			coordinateMode,
			shape: shape,
		});
	}

	/**
	 * Creates a shape in the client's viewport and returns the shape ID for tracking.
	 */
	public async createShapeInViewport(): Promise<{
		response: CommandResponse;
		shapeId: string;
	}> {
		const response = await this._runner.sendCommand(this._clientName, {
			type: "createShape",
			coordinateMode: "local",
		});

		if (!response.shapeId)
			throw new Error("No shapeId returned from createShape command");

		const shapeId = response.shapeId;

		return { response, shapeId };
	}

	/**
	 * Makes the client send an updateShape command.
	 */
	public async updateShape(
		shape: Omit<Partial<Shape> & Pick<Shape, "id" | "type">, "version">,
	): Promise<CommandResponse> {
		log.info(
			`Client ${this._clientId} updating shape: ${JSON.stringify(shape)}`,
		);
		return this._runner.sendCommand(this._clientName, {
			type: "updateShape",
			shape: shape,
		});
	}

	/**
	 * Makes the client send a deleteShape command.
	 */
	public async deleteShape(shapeId: string): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "deleteShape",
			shapeId,
		});
	}

	/**
	 * Moves an existing shape to a new location.
	 */
	public async moveShape(
		shapeId: string,
		newX: number,
		newY: number,
	): Promise<CommandResponse> {
		log.info(
			`Client ${this._clientId} moving shape ${shapeId} to (${newX}, ${newY})`,
		);
		return this._runner.sendCommand(this._clientName, {
			type: "updateShape",
			shape: {
				id: shapeId,
				type: "circle",
				x: newX,
				y: newY,
			},
		});
	}

	/**
	 * Makes the client send a command.
	 */
	public async sendCommand(
		command: Command,
		timeoutMs?: number,
	): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, command, timeoutMs);
	}
}

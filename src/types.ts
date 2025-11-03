export interface Canvas {
	shapes: Shape[];
	clients: Client[];
}

export interface Client {
	id: number;
	viewport: Viewport;
	lastSeenVersion: Map<string, number>;
	connectedAt: number;
}

export interface Viewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BaseCommand {
	type: string;
}

export interface CreateShapeCommand extends BaseCommand {
	type: "addShape";
	shape?: Shape;
	coordinateMode?: "global" | "local";
}

export interface UpdateShapeCommand extends BaseCommand {
	type: "updateShape";
	shape: Partial<Shape> & Pick<Shape, "id" | "type">;
}

export interface DeleteShapeCommand extends BaseCommand {
	type: "deleteShape";
	shapeId: string;
}

export interface MoveWindowCommand extends BaseCommand {
	type: "moveWindow";
	location: {
		x: number;
		y: number;
	};
}

export interface PingCommand extends BaseCommand {
	type: "ping";
}

export type Command =
	| CreateShapeCommand
	| UpdateShapeCommand
	| DeleteShapeCommand
	| MoveWindowCommand
	| PingCommand;

export type CommandMessage = {
	id: string;
	timestamp: number;
	command: Command;
};

export interface CommandResponse {
	id: string;
	success: boolean;
	error?: string;
}

export type BaseEvent = {
	id: string;
	timestamp: number;
	causedBy: string;
};

export interface CreatedShapeEvent extends BaseEvent {
	type: "createdShape";
	shape: Shape;
}

export interface UpdatedShapeEvent extends BaseEvent {
	type: "updatedShape";
	shape: Shape;
}

export interface DeletedShapeEvent extends BaseEvent {
	type: "deletedShape";
	shapeId: string;
}

export interface BulkUpdateEvent extends BaseEvent {
	type: "bulkUpdate";
	shapes: Shape[];
}

export type Event =
	| CreatedShapeEvent
	| UpdatedShapeEvent
	| DeletedShapeEvent
	| BulkUpdateEvent;

export interface BaseShape {
	id: string;
	version: number;
	type: "rectangle" | "circle";
	x: number;
	y: number;
	color: string;
	strokeWidth?: number;
	isDeleted?: boolean;
}

export interface Circle extends BaseShape {
	type: "circle";
	radius: number;
}

export interface Rectangle extends BaseShape {
	type: "rectangle";
	width: number;
	height: number;
}

export type Shape = Circle | Rectangle;

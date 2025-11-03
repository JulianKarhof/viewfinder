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

export interface BaseAction {
	timestamp: number;
	type:
		| "addShape"
		| "updateShape"
		| "deleteShape"
		| "moveWindow"
		| "bulkUpdate";
}

export interface BulkUpdateAction extends BaseAction {
	type: "bulkUpdate";
	shapes: Shape[];
}

export interface AddShapeAction extends BaseAction {
	type: "addShape";
	coordinateMode?: "global" | "local";
	shape?: Shape;
}

export interface UpdateShapeAction extends BaseAction {
	type: "updateShape";
	shape: Partial<Shape> & Pick<Shape, "id" | "type">;
}

export interface DeleteShapeAction extends BaseAction {
	type: "deleteShape";
	shape: Pick<Shape, "id" | "type">;
}

export interface MoveWindowAction extends BaseAction {
	type: "moveWindow";
	location: {
		x: number;
		y: number;
	};
}

export type Action =
	| AddShapeAction
	| UpdateShapeAction
	| DeleteShapeAction
	| BulkUpdateAction
	| MoveWindowAction;

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

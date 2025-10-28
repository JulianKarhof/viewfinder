export interface Canvas {
	shapes: Shape[];
	clients: {
		id: number;
		location: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
	}[];
}

export interface BaseAction {
	timestamp: number;
	type: "addShape" | "moveShape" | "deleteShape" | "moveWindow";
}

export interface AddShapeAction extends BaseAction {
	type: "addShape";
	shape: Shape;
}

export interface MoveShapeAction extends BaseAction {
	type: "moveShape";
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
	| MoveShapeAction
	| DeleteShapeAction
	| MoveWindowAction;

export interface BaseShape {
	id: string;
	type: "rectangle" | "circle";
	x: number;
	y: number;
	color: string;
	strokeWidth?: number;
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

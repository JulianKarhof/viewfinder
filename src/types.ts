export interface Canvas {
  shapes: Shape[];
}


export interface BaseAction {
  timestamp: number;
  type: 'addShape' | 'moveShape' | 'deleteShape';
  shape: Partial<Shape> & Pick<Shape, 'id' | 'type'> & { };
}

export interface AddShapeAction extends BaseAction {
  type: 'addShape';
  shape: Shape;
}

export interface MoveShapeAction extends BaseAction {
  type: 'moveShape';
  shape: Partial<Shape> & Pick<Shape, 'id' | 'type'>;
}

export interface DeleteShapeAction extends BaseAction {
  type: 'deleteShape';
  shape: Pick<Shape, 'id' | 'type'>;
}

export type Action = AddShapeAction | MoveShapeAction | DeleteShapeAction;


export interface BaseShape {
  id: string;
  type: 'rectangle' | 'circle';
  x: number;
  y: number;
  color: string;
  strokeWidth?: number;
}

export interface Circle extends BaseShape {
  type: 'circle';
  radius: number;
}

export interface Rectangle extends BaseShape {
  type: 'rectangle';
  width: number;
  height: number;
}

export type Shape = Circle | Rectangle;

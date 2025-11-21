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

	origin?: number;
	clientSentAt?: number;
	serverReceivedAt?: number;
}

export interface CreateShapeCommand extends BaseCommand {
	type: "createShape";
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
	type: "command";
	timestamp: number;
	command: Command;
};

export interface CommandResponse {
	id: string;
	type: "response";
	success: boolean;
	error?: string;
	shapeId?: string;
}

export type BaseEvent = {
	origin?: number;
	clientSentAt?: number;
	serverReceivedAt?: number;
	serverSentAt?: number;
	clientReceivedAt?: number;
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

interface BaseMetrics {
	timestamp: number;
	processId: string;
}

export interface ThroughputMetrics extends BaseMetrics {
	dataType: "throughput";
	clientId: number;
	bytesReceived: number;
	bytesSent: number;
	messageCount?: number;
	avgMessageSize?: number;
}

export interface ServerMetrics extends BaseMetrics {
	dataType: "serverMetrics";
	cpuPercent: number;
	memoryMB: number;
	heapUsedMB: number;
	heapTotalMB: number;
	activeConnections: number;
	loadAverage?: number[];
	uptime?: number;
}

export interface LatencyMetrics extends BaseMetrics {
	dataType: "latency";
	operation: string;
	clientToServerUs: number;
	serverToClientUs: number;
	clientToClientUs: number;
	clientId?: number;
	targetClientId?: number;
	messageSize?: number;
}

export type MetricsData = ThroughputMetrics | ServerMetrics | LatencyMetrics;

export interface MetricsMessage {
	type: "metrics";
	data: MetricsData;
}

export interface StartupReadyMessage {
	type: "ready";
	processType: "server" | "client";
	processId?: string;
	timestamp: number;
}

export interface StartupAckMessage {
	type: "startup_ack";
	processId: string;
	timestamp: number;
}

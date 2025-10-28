import { logger } from "./logger.ts";
import type { CommandMessage, CommandResponse } from "./runner.ts";
import type { Action, MoveShapeAction, Shape } from "./types.ts";

interface ClientState {
	location: {
		x: number;
		y: number;
	};
	shapes: Shape[];
}

export function startClient(
	serverUrl: string = "ws://localhost:3000/ws",
	id: number = Math.floor(Math.random() * 10000),
) {
	const log = logger.client(id);
	process.title = `viewfinder:client:${id}`;
	const ws = new WebSocket(`${serverUrl}?clientId=${id}`);

	const clientState: ClientState = {
		location: {
			x: 0,
			y: 0,
		},
		shapes: [],
	};

	ws.onopen = () => {
		log.info(`🔗 Connected to ${serverUrl}`);
	};

	ws.onmessage = (update) => {
		log.debug("💬 Message received", update);
		updateLocalState(update);
	};

	ws.onclose = () => {
		log.info("🔌 Connection closed");
	};

	ws.onerror = (error) => {
		log.error("❌ WebSocket error:", error);
	};

	function updateLocalState(update: MessageEvent) {
		const action: Action = JSON.parse(update.data) as unknown as Action;

		log.debug("🔄 Updating local state", action);

		switch (action.type) {
			case "moveShape": {
				clientState.shapes = clientState.shapes.map((shape) => {
					if (String(shape.id) === String(action.shape.id)) {
						const updatedShape = { ...shape };
						Object.keys(action.shape).forEach((key) => {
							const value = (action.shape as Record<string, unknown>)[key];
							if (value !== undefined) {
								(updatedShape as Record<string, unknown>)[key] = value;
							}
						});
						return updatedShape;
					}
					return shape;
				});
				break;
			}
			case "addShape": {
				clientState.shapes.push(action.shape);
				break;
			}
			case "deleteShape": {
				clientState.shapes = clientState.shapes.filter(
					(shape) => String(shape.id) !== String(action.shape.id),
				);
				break;
			}
		}

		log.debug("✅ Local state updated", clientState);
	}

	function sendMessage(action: Action) {
		if (ws.readyState === WebSocket.OPEN) {
			log.debug("💬 Sending message", action);
			ws.send(JSON.stringify(action));
		} else {
			log.warn("⚠️ WebSocket not ready, message not sent");
		}
	}

	function moveWindow(x: number, y: number) {
		clientState.location.x = x;
		clientState.location.y = y;

		sendMessage({
			type: "moveWindow",
			timestamp: Date.now(),
			location: {
				x,
				y,
			},
		});

		log.debug("📍 Moved window to", clientState.location);
	}

	function sendExampleMessage() {
		const shape: MoveShapeAction = {
			timestamp: Date.now(),
			type: "moveShape",
			shape: {
				id: "shape1",
				type: "circle",
				x: 100,
				y: 200,
				radius: 4,
				color: "purple",
			},
		};
		sendMessage(shape);
	}

	process.on("message", (message) => {
		if (message && typeof message === "object" && "id" in message) {
			handleCommand(message as CommandMessage);
		}
	});

	function handleCommand(message: CommandMessage) {
		if (message.command.type === "ping") {
			process.send?.({
				id: message.id,
				success: true,
			} as CommandResponse);
		} else if (message.command.type === "sendAction") {
			sendMessage(message.command.action);
			process.send?.({
				id: message.id,
				success: true,
			} as CommandResponse);
		} else if (message.command.type === "moveWindow") {
			moveWindow(message.command.location.x, message.command.location.y);
			process.send?.({
				id: message.id,
				success: true,
			} as CommandResponse);
		} else {
			process.send?.({
				id: message.id,
				success: false,
				error: "Unknown command type",
			} as CommandResponse);
		}
	}

	return {
		ws,
		sendMessage,
		sendExampleMessage,
		close: () => ws.close(),
	};
}

if (import.meta.main) {
	startClient(
		undefined,
		Number.parseInt(process.env.CLIENT_ID || "", 10) ||
			Math.floor(Math.random() * 10000),
	);
}

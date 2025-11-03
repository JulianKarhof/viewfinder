import { Settings } from "./env.ts";
import { logger } from "./logger.ts";
import type {
	Command,
	CommandMessage,
	CommandResponse,
	Event,
	Shape,
} from "./types.ts";

interface ClientState {
	location: {
		x: number;
		y: number;
		height: 200;
		width: 300;
	};
	shapes: Shape[];
}

export function generateClientColor(clientId: number): string {
	const colors = [
		"#ffbe0b",
		"#ff006e",
		"#3a86ff",
		"#8338ec",
		"#fb5607",
		"#06d6a0",
	];
	return colors[clientId % colors.length];
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
			height: 200,
			width: 300,
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
		log.error("🚨 WebSocket error:", error);
	};

	function updateLocalState(update: MessageEvent) {
		const action: Event = JSON.parse(update.data) as unknown as Event;

		log.debug("🔄 Updating local state", action);

		switch (action.type) {
			case "updatedShape": {
				const shape = clientState.shapes.find(
					(s) => String(s.id) === String(action.shape.id),
				);
				if (shape) {
					Object.assign(shape, action.shape);
				}
				break;
			}
			case "createdShape": {
				if (action.shape) clientState.shapes.push(action.shape);
				break;
			}
			case "deletedShape": {
				clientState.shapes = clientState.shapes.filter(
					(shape) => String(shape.id) !== String(action.shapeId),
				);
				break;
			}
			case "bulkUpdate": {
				action.shapes.forEach((updatedShape) => {
					const shape = clientState.shapes.find(
						(s) => String(s.id) === String(updatedShape.id),
					);

					if (shape) {
						Object.assign(shape, updatedShape);
					} else {
						clientState.shapes.push(updatedShape);
					}
				});
			}
		}

		log.debug("✅ Local state updated", clientState);
	}

	function sendMessage(command: Command) {
		if (ws.readyState === WebSocket.OPEN) {
			log.debug("💬 Sending message", command);
			ws.send(JSON.stringify(command));
		} else {
			log.warn("⚠️ WebSocket not ready, message not sent");
		}
	}

	function moveWindow(x: number, y: number) {
		clientState.location.x = x;
		clientState.location.y = y;

		sendMessage({
			type: "moveWindow",
			location: {
				x,
				y,
			},
		});

		log.debug("📍 Moved window to", clientState.location);
	}

	process.on("message", (message) => {
		if (message && typeof message === "object" && "id" in message) {
			handleCommand(message as CommandMessage);
		}
	});

	function handleCommand(message: CommandMessage) {
		const { command } = message;
		const response: CommandResponse = { id: message.id, success: true };

		switch (command.type) {
			case "ping":
				process.send?.(response);
				break;
			case "addShape":
				if (!command.shape) {
					command.shape = {
						id: `shape-${Date.now()}`,
						version: 0,
						type: "circle",
						x:
							clientState.location.x +
							Math.random() * clientState.location.width,
						y:
							clientState.location.y +
							Math.random() * clientState.location.height,
						color: generateClientColor(id),
						radius: 8,
					};
				}
				sendMessage(command);
				process.send?.(response);
				break;
			case "updateShape":
			case "deleteShape":
				sendMessage(command);
				process.send?.(response);
				break;
			case "moveWindow": {
				const targetX = command.location.x;
				const targetY = command.location.y;
				const currentX = clientState.location.x;
				const currentY = clientState.location.y;

				const distance = Math.sqrt(
					(targetX - currentX) ** 2 + (targetY - currentY) ** 2,
				);

				if (distance < 20) {
					moveWindow(targetX, targetY);
					process.send?.(response);
					break;
				}

				const steps = Math.min(Math.max(Math.ceil(distance / 30), 1), 8);
				const intervalMs = Settings.waitTime;

				let step = 0;
				const interval = setInterval(() => {
					step++;
					const progress = step / steps;

					const newX = currentX + (targetX - currentX) * progress;
					const newY = currentY + (targetY - currentY) * progress;

					moveWindow(newX, newY);

					if (step >= steps) {
						clearInterval(interval);
						moveWindow(targetX, targetY);
						process.send?.(response);
					}
				}, intervalMs);
				break;
			}
			default:
				response.success = false;
				response.error = "Unknown command type";
				process.send?.(response);
		}
	}

	return {
		ws,
		sendMessage,
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

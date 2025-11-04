import { logger } from "../logger.ts";
import type { Command, CommandMessage, Event, Shape } from "../types.ts";
import { CommandHandler, EventHandler } from "./handlers.ts";

export interface ClientState {
	location: {
		x: number;
		y: number;
		height: number;
		width: number;
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

	const messageQueue: Command[] = [];

	function sendMessage(command: Command) {
		if (ws.readyState === WebSocket.OPEN) {
			log.debug("💬 Sending message", command);
			ws.send(JSON.stringify(command));
		} else {
			log.debug("📥 Queueing message for when connection opens", command);
			messageQueue.push(command);
		}
	}

	const eventHandler = new EventHandler(clientState, id);
	const commandHandler = new CommandHandler(clientState, id, sendMessage);

	ws.onopen = () => {
		log.info(`🔗 Connected to ${serverUrl}`);

		while (messageQueue.length > 0) {
			const command = messageQueue.shift();
			if (command) {
				log.debug("💬 Sending queued message", command);
				ws.send(JSON.stringify(command));
			}
		}
	};

	ws.onmessage = (update) => {
		log.debug("💬 Websocket message received", update);
		const event: Event = JSON.parse(update.data) as unknown as Event;
		eventHandler.handleEvent(event);
	};

	ws.onclose = () => {
		log.info("🔌 Connection closed");
	};

	ws.onerror = (error) => {
		log.error("🚨 WebSocket error:", error);
	};

	process.on("message", (message) => {
		log.debug("💬 Message from parent process", message);
		if (message && typeof message === "object" && "command" in message) {
			commandHandler.handleCommand(message as CommandMessage);
		}
	});

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

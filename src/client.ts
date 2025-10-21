import { logger } from "./logger.ts";
import type { CommandMessage, CommandResponse } from "./runner.ts";
import type { BaseAction } from "./types.ts";

export function startClient(
	serverUrl: string = "ws://localhost:3000/ws",
	id: number = Math.floor(Math.random() * 10000),
) {
	const log = logger.client(id);
	process.title = `viewfinder:client:${id}`;
	const ws = new WebSocket(serverUrl);

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
		log.debug("🔄 Updating local state", update);
	}

	function sendMessage(action: BaseAction) {
		if (ws.readyState === WebSocket.OPEN) {
			log.debug("💬 Sending message", action);
			ws.send(JSON.stringify(action));
		} else {
			log.warn("⚠️ WebSocket not ready, message not sent");
		}
	}

	function sendExampleMessage() {
		const shape: BaseAction = {
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

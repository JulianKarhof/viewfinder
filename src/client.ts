import { logger } from "./logger.ts";
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

	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (data) => {
		const lines = data
			.toString()
			.split("\n")
			.filter((line) => line.trim());

		for (const line of lines) {
			try {
				console.log(`Received command: ${line}`);
				const command = JSON.parse(line);
				handleCommand(command);
			} catch (_) {
				console.log(
					`{"commandId": "unknown", "success": false, "error": "Invalid JSON"}`,
				);
			}
		}
	});

	function handleCommand(command: { id: string; type: string; data: unknown }) {
		if (command.type === "ping") {
			console.log(`{"commandId": "${command.id}", "success": true}`);
		} else {
			console.log(
				`{"commandId": "${command.id}", "success": false, "error": "Unknown command type"}`,
			);
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

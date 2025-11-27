import * as microtime from "microtime";
import { SuperJSON } from "superjson";
import { logger } from "../logger.ts";
import type {
	Command,
	CommandMessage,
	Event,
	Shape,
	StartupReadyMessage,
} from "../types.ts";
import { initializeRandom } from "../utils/seededRandom.js";
import { CommandHandler, EventHandler } from "./handlers.ts";
import { ClientMetricsCollector } from "./metrics.ts";

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
	const metricsCollector = new ClientMetricsCollector(id);

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
			metricsCollector.trackMessage(command, "out");

			const timestampedCommand: Command = {
				...command,
				clientSentAt: microtime.now(),
				origin: id,
			};
			ws.send(SuperJSON.stringify(timestampedCommand));
		} else {
			log.debug("📥 Queueing message for when connection opens", command);
			messageQueue.push(command);
		}
	}

	const eventHandler = new EventHandler(clientState, id);
	const commandHandler = new CommandHandler(clientState, id, sendMessage);

	ws.onopen = () => {
		log.info(`🔗 Connected to ${serverUrl}`);

		metricsCollector.startPeriodicReporting();

		process.send?.({
			type: "ready",
			processType: "client",
			processId: `client-${id}`,
			timestamp: Date.now(),
		} as StartupReadyMessage);

		while (messageQueue.length > 0) {
			const command = messageQueue.shift();
			if (command) {
				log.debug("💬 Sending queued message", command);
				metricsCollector.trackMessage(command, "out");

				const timestampedCommand: Command = {
					...command,
					clientSentAt: microtime.now(),
					origin: id,
				};
				ws.send(SuperJSON.stringify(timestampedCommand));
			}
		}
	};

	ws.onmessage = (update) => {
		const event: Event = SuperJSON.parse(update.data) as unknown as Event;

		if (event.origin && id === event.origin) {
			throw new Error("🚨 Received own message back from server");
		}

		metricsCollector.trackMessage(event, "in");

		log.debug("💬 Websocket message received", update);
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

	process.on("SIGTERM", () => {
		metricsCollector.sendFinalMetrics();
		process.exit(0);
	});

	return {
		ws,
		sendMessage,
		close: () => {
			metricsCollector.sendFinalMetrics();
			ws.close();
		},
	};
}

if (import.meta.main) {
	const seed = Number.parseInt(process.env.RANDOM_SEED || "0", 10);
	if (seed > 0) {
		initializeRandom(seed);
	}

	startClient(
		undefined,
		Number.parseInt(process.env.CLIENT_ID || "", 10) ||
			Math.floor(Math.random() * 10000),
	);
}

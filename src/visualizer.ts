import { watch } from "node:fs";
import { logger } from "./logger";

const log = logger.visualizer;

const localDb = await import(`./db.ts?t=${Date.now()}`);

export function startVisualizer(
	port: number = 3001,
	serverUrl: string = "ws://localhost:3000/ws",
) {
	process.title = "viewfinder:visualizer";
	const clients = new Set<Bun.ServerWebSocket<unknown>>();
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

		notifyClients();
	}

	const server: Bun.Server = Bun.serve({
		port,
		websocket: {
			message() {},
			open(ws) {
				clients.add(ws);
			},
			close(ws) {
				clients.delete(ws);
			},
		},
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/ws") {
				const success = server.upgrade(req);
				return success
					? undefined
					: new Response("Failed to upgrade", { status: 500 });
			}

			if (url.pathname === "/") {
				const html = await Bun.file("./index.html").text();
				return new Response(html, {
					headers: { "Content-Type": "text/html" },
				});
			}

			if (url.pathname === "/api/shapes") {
				return new Response(JSON.stringify(localDb), {
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/api/status") {
				return new Response("OK");
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	function notifyClients() {
		clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				client.send("reload");
			}
		});
	}

	function notifyClientsPageReload() {
		clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				client.send("reload-page");
			}
		});
	}

	// Watch for file changes
	const watchers = [
		watch("./db.ts", { persistent: false }, (eventType) => {
			if (eventType === "change") {
				log.debug("👀 Database file changed, notifying clients...");
				setTimeout(notifyClients, 100);
			}
		}),

		watch("./client.ts", { persistent: false }, (eventType) => {
			if (eventType === "change") {
				log.debug("👀 Client file changed, notifying clients...");
				setTimeout(notifyClients, 100);
			}
		}),

		watch("./index.html", { persistent: false }, (eventType) => {
			if (eventType === "change") {
				log.debug("👀 HTML file changed, notifying clients...");
				setTimeout(notifyClientsPageReload, 100);
			}
		}),
	];

	log.info(`🎨 Canvas server running at http://localhost:${server.port}`);
	log.debug("👀 File watching enabled");

	return {
		server,
		clients,
		watchers,
		stop: () => {
			watchers.forEach((watcher) => {
				watcher.close();
			});
			server.stop();
		},
	};
}

if (import.meta.main) {
	startVisualizer();
}

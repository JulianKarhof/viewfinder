import { spawn } from "bun";
import { Settings } from "../env.ts";
import { logger } from "../logger.ts";
import type {
	Command,
	CommandMessage,
	CommandResponse,
	MetricsMessage,
} from "../types.ts";
import { ClientWrapper } from "./clientWrapper.ts";
import type { BenchmarkCollector } from "./collector.ts";

const log = logger.main;

interface ProcessInfo {
	process: Bun.Subprocess<"pipe", "pipe", "pipe">;
	name: string;
	startTime: Date;
}

export class ProcessRunner {
	private _server: ProcessInfo | null = null;
	private _clients: ProcessInfo[] = [];
	private _visualizer: ProcessInfo | null = null;
	private _isShuttingDown = false;
	private _pendingResponses: Map<string, (response: CommandResponse) => void> =
		new Map();
	private _collector: BenchmarkCollector | null = null;
	private _serverConfig: { enableViewportFiltering?: boolean } = {};

	public constructor() {
		process.on("SIGINT", () => this._shutdown());
		process.on("SIGTERM", () => this._shutdown());
	}

	public setCollector(collector: BenchmarkCollector) {
		this._collector = collector;
	}

	public setServerConfig(config: { enableViewportFiltering?: boolean }) {
		this._serverConfig = config;
	}

	private _cleanupProcess(name: string) {
		if (name === "server") {
			this._server = null;
		} else if (name === "visualizer") {
			this._visualizer = null;
		} else if (name.startsWith("client-")) {
			this._clients = this._clients.filter((client) => client.name !== name);
		}

		if (this._isShuttingDown && this.getAllRunningProcesses().length === 0) {
			log.info("✅ All processes have exited. Shutting down.");
			process.exit(0);
		}
	}

	public async sendCommand(
		processName: string,
		command: Command,
		timeoutMs: number = Settings.isDebugMode ? 60000 : 100,
	): Promise<CommandResponse> {
		const process = this._findProcess(processName);
		const commandMessage: CommandMessage = {
			id: `cmd-${Date.now()}`,
			type: "command",
			timestamp: Date.now(),
			command,
		};

		log.debug(
			`➡️  Sending command to ${processName}: ${JSON.stringify(commandMessage)}`,
		);

		process?.process.send?.(commandMessage);

		return await new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				this._pendingResponses.delete(commandMessage.id);
				if (!Settings.isDebugMode) {
					throw new Error(
						`🚨 Command to ${processName} timed out after ${timeoutMs}ms`,
					);
				}

				log.warn(`⚠️  Command to ${processName} timed out after ${timeoutMs}ms`);
				resolve({
					id: commandMessage.id,
					type: "response",
					success: false,
					error: `Command timeout after ${timeoutMs}ms`,
				} as CommandResponse);
			}, timeoutMs);

			this._pendingResponses.set(commandMessage.id, (response) => {
				log.debug(
					`⬅️  Response from ${processName}: ${JSON.stringify(response)}`,
				);

				clearTimeout(timeoutId);
				this._pendingResponses.delete(commandMessage.id);
				resolve(response);
			});
		});
	}

	private _findProcess(name: string): ProcessInfo | null {
		if (this._server && this._server.name === name) {
			return this._server;
		}
		if (this._visualizer && this._visualizer.name === name) {
			return this._visualizer;
		}
		const client = this._clients.find((c) => c.name === name);
		return client || null;
	}

	private _handleLogs(processInfo: ProcessInfo) {
		const { process: proc, name } = processInfo;

		if (proc.stdout) {
			proc.stdout.pipeTo(
				new WritableStream({
					write: (chunk) => {
						const text = new TextDecoder().decode(chunk).replace(/\n+$/, "");
						if (text) {
							console.log(text);
						}
					},
				}),
			);
		}

		if (proc.stderr) {
			proc.stderr.pipeTo(
				new WritableStream({
					write: (chunk) => {
						const text = new TextDecoder().decode(chunk).replace(/\n+$/, "");
						if (text) {
							console.error(text);
						}
					},
				}),
			);
		}

		proc.exited
			.then((exitCode) => {
				const runtime = Date.now() - processInfo.startTime.getTime();
				if (exitCode === 0) {
					log.info(`✅ [${name}] exited successfully after ${runtime}ms`);
				} else {
					log.error(
						`🚨 [${name}] exited with code ${exitCode} after ${runtime}ms`,
					);
				}
				this._cleanupProcess(name);
			})
			.catch((error) => {
				log.error(`🚨 [${name}] crashed: ${error.message}`);
				this._cleanupProcess(name);
			});
	}

	public async startServer() {
		if (this._server) {
			throw new Error("🚨 Server is already running");
		}

		log.info("⏳ Starting server...");
		const proc = spawn(["bun", "src/server/server.ts"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
			env: {
				...process.env,
				IS_SERVER: "true",
				ENABLE_VIEWPORT_FILTERING: String(
					this._serverConfig.enableViewportFiltering ?? true,
				),
			},
			ipc: (message, _process) => {
				if (message.type === "metrics") {
					const metrics = message as MetricsMessage;
					this._collector?.addMetrics(metrics.data);
				}
			},
		});

		this._server = {
			process: proc,
			name: "server",
			startTime: new Date(),
		};

		this._handleLogs(this._server);
		log.info("🚀 Server started");
	}

	public async startClients(count: number) {
		log.info(`⏳ Starting ${count} clients...`);

		for (let i = 0; i < count; i++) {
			const clientId = i + 1;

			const proc = spawn(["bun", "src/client/client.ts"], {
				stdout: "pipe",
				stderr: "pipe",
				stdin: "pipe",
				env: {
					...process.env,
					IS_CLIENT: "true",
					CLIENT_ID: String(clientId),
					RANDOM_SEED: process.env.RANDOM_SEED || "0",
				},
				ipc: (message, _process) => {
					if (message.type === "metrics") {
						const metrics = message as MetricsMessage;
						this._collector?.addMetrics(metrics.data);
					} else if (message.type === "response") {
						const response = message as CommandResponse;
						const callback = this._pendingResponses.get(response.id);
						if (callback) {
							callback(response);
						} else {
							log.warn(
								`⚠️  No pending response handler for commandId ${response.id} from client-${
									i + 1
								}`,
							);
							log.warn(`⚠️  Unmatched IPC message: ${JSON.stringify(response)}`);
						}
					}
				},
			});

			const clientInfo = {
				process: proc,
				name: `client-${clientId}`,
				startTime: new Date(),
			};

			this._clients.push(clientInfo);
			this._handleLogs(clientInfo);
		}

		log.info(`🚀 ${count} clients started`);
	}

	public getAllRunningProcesses(): ProcessInfo[] {
		const processes: ProcessInfo[] = [];

		if (this._server) processes.push(this._server);
		if (this._visualizer) processes.push(this._visualizer);
		processes.push(...this._clients);

		return processes;
	}

	public getStatus() {
		const running = this.getAllRunningProcesses();
		return {
			totalProcesses: running.length,
			server: !!this._server,
			visualizer: !!this._visualizer,
			clients: this._clients.length,
			processes: running.map((p) => ({
				name: p.name,
				startTime: p.startTime,
				runtime: Date.now() - p.startTime.getTime(),
			})),
		};
	}

	public async stopAll() {
		log.info("🛑 Stopping all processes...");

		const processes = this.getAllRunningProcesses();

		for (const processInfo of processes) {
			try {
				log.info(`🛑 Stopping ${processInfo.name}...`);
				processInfo.process.kill("SIGTERM");
			} catch (error) {
				log.error(`🚨 Failed to stop ${processInfo.name}: ${error}`);
				try {
					processInfo.process.kill("SIGKILL");
				} catch (killError) {
					log.error(
						`🚨 Failed to force kill ${processInfo.name}: ${killError}`,
					);
				}
			}
		}

		const timeout = setTimeout(() => {
			log.warn(
				"🚨 Timeout waiting for processes to exit, force killing remaining processes",
			);
			this.getAllRunningProcesses().forEach((p) => {
				try {
					p.process.kill("SIGKILL");
				} catch {}
			});
		}, 10000);

		await Promise.allSettled(
			processes.map((p) => p.process.exited.catch(() => {})),
		);

		clearTimeout(timeout);

		this._server = null;
		this._clients = [];
		this._visualizer = null;

		log.info("✅ All processes stopped");
	}

	public async waitForAllProcesses(timeout: number | null = null) {
		if (!Settings.isDebugMode) return;

		const processes = this.getAllRunningProcesses();

		if (processes.length === 0) {
			log.warn("⚠️ No processes running");
			return;
		}

		log.info(`⏳ Waiting for ${processes.length} processes to complete...`);

		const processesPromise = Promise.allSettled(
			processes.map((p) => p.process.exited.catch(() => {})),
		);

		if (timeout === null) {
			await processesPromise;
			log.info("✅ All processes have completed");
			return;
		}

		const timeoutMs = timeout * 1000;
		const timeoutPromise = new Promise<void>((_, reject) => {
			setTimeout(() => {
				reject(
					new Error(
						`🚨 Timeout waiting for processes to complete after ${timeout}s`,
					),
				);
			}, timeoutMs);
		});

		try {
			await Promise.race([processesPromise, timeoutPromise]);
			log.info("✅ All processes have completed");
		} catch (error) {
			log.warn(`⚠️ Timeout reached while waiting for processes: ${error}`);
			throw error;
		}
	}

	public async keepAlive() {
		while (this.getAllRunningProcesses().length > 0 && !this._isShuttingDown) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	public clients(): ClientWrapper[] {
		return this._clients.map((_, index) => new ClientWrapper(this, index + 1));
	}

	public client(clientId: number): ClientWrapper {
		if (clientId > this._clients.length) {
			throw new Error(`🚨 Client ${clientId} is not running`);
		}
		return new ClientWrapper(this, clientId);
	}

	public async wait(ms: number = Settings.waitTime) {
		if (ms === 0) return;
		log.info(`⏳ Waiting for ${ms}ms...`);
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async _shutdown() {
		if (this._isShuttingDown) return;

		this._isShuttingDown = true;
		log.info("🔌 Received shutdown signal, stopping all processes...");

		try {
			await this.stopAll();
		} catch (error) {
			log.error(`🚨 Error during shutdown: ${error}`);
		}

		process.exit(0);
	}
}

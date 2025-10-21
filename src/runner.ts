import { spawn } from "bun";
import { logger } from "./logger.js";
import type { BaseAction } from "./types.js";

const log = logger.main;

export interface ProcessRunnerConfig {
	maxConcurrentProcesses?: number;
}

interface ProcessInfo {
	process: Bun.Subprocess<"pipe", "pipe", "pipe">;
	name: string;
	startTime: Date;
}

export interface PingCommand {
	type: "ping";
}

export interface SendActionCommand {
	type: "sendAction";
	action: BaseAction;
}

export type Command = PingCommand | SendActionCommand;

export interface CommandMessage {
	id: number;
	command: Command;
}

export interface CommandResponse {
	id: number;
	success: boolean;
	error?: string;
	response?: {
		[key: string]: unknown;
	};
}

export class ProcessRunner {
	private config: ProcessRunnerConfig = {};
	private server: ProcessInfo | null = null;
	private clients: ProcessInfo[] = [];
	private visualizer: ProcessInfo | null = null;
	private isShuttingDown = false;
	private pendingResponses: Map<number, (response: CommandResponse) => void> =
		new Map();

	constructor(config: ProcessRunnerConfig = {}) {
		process.on("SIGINT", () => this.shutdown());
		process.on("SIGTERM", () => this.shutdown());
	}

	private cleanupProcess(name: string) {
		if (name === "server") {
			this.server = null;
		} else if (name === "visualizer") {
			this.visualizer = null;
		} else if (name.startsWith("client-")) {
			this.clients = this.clients.filter((client) => client.name !== name);
		}

		if (this.isShuttingDown && this.getAllRunningProcesses().length === 0) {
			log.info("✅ All processes have exited. Shutting down.");
			process.exit(0);
		}
	}

	async sendPing(processName: string): Promise<boolean> {
		const response = await this.sendCommand(processName, { type: "ping" });
		return response.success === true;
	}

	async sendCommand(
		processName: string,
		command: Command,
		timeoutMs: number = 500,
	): Promise<CommandResponse> {
		const process = this.findProcess(processName);
		const commandMessage: CommandMessage = {
			id: Date.now(),
			command,
		};

		log.debug(
			`➡️  Sending command to ${processName}: ${JSON.stringify(commandMessage)}`,
		);

		process?.process.send?.(commandMessage);

		return new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				this.pendingResponses.delete(commandMessage.id);
				resolve({
					id: commandMessage.id,
					success: false,
					error: `Command timeout after ${timeoutMs}ms`,
				});
			}, timeoutMs);

			this.pendingResponses.set(commandMessage.id, (response) => {
				log.debug(
					`⬅️  Response from ${processName}: ${JSON.stringify(response)}`,
				);

				clearTimeout(timeoutId);
				this.pendingResponses.delete(commandMessage.id);
				resolve(response);
			});
		});
	}

	private findProcess(name: string): ProcessInfo | null {
		if (this.server && this.server.name === name) {
			return this.server;
		}
		if (this.visualizer && this.visualizer.name === name) {
			return this.visualizer;
		}
		const client = this.clients.find((c) => c.name === name);
		return client || null;
	}

	private handleLogs(processInfo: ProcessInfo) {
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
				this.cleanupProcess(name);
			})
			.catch((error) => {
				log.error(`🚨 [${name}] crashed: ${error.message}`);
				this.cleanupProcess(name);
			});
	}

	async startServer() {
		if (this.server) {
			throw new Error("🚨 Server is already running");
		}

		log.info("⏳ Starting server...");
		const proc = spawn(["bun", "server.ts"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
		});

		this.server = {
			process: proc,
			name: "server",
			startTime: new Date(),
		};

		this.handleLogs(this.server);
		log.info("🚀 Server started");
	}

	async startVisualizer() {
		if (this.visualizer) {
			throw new Error("🚨 Visualizer is already running");
		}

		log.info("⏳ Starting visualizer...");
		const proc = spawn(["bun", "visualizer.ts"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
		});

		this.visualizer = {
			process: proc,
			name: "visualizer",
			startTime: new Date(),
		};

		this.handleLogs(this.visualizer);
		log.info("🚀 Visualizer started");
	}

	async startClients(count: number) {
		log.info(`⏳ Starting ${count} clients...`);

		for (let i = 0; i < count; i++) {
			const proc = spawn(["bun", "client.ts"], {
				stdout: "pipe",
				stderr: "pipe",
				stdin: "pipe",
				env: {
					...process.env,
					CLIENT_ID: String(i + 1),
				},
				ipc: (message, _process) => {
					if (message && typeof message === "object" && "id" in message) {
						const response = message as CommandResponse;
						const callback = this.pendingResponses.get(response.id);
						if (callback) {
							callback(response);
						} else {
							log.warn(
								`⚠️ No pending response handler for commandId ${response.id} from client-${
									i + 1
								}`,
							);
							log.warn(`⚠️ Unmatched IPC message: ${JSON.stringify(response)}`);
						}
					}
				},
			});

			const clientInfo = {
				process: proc,
				name: `client-${i + 1}`,
				startTime: new Date(),
			};

			this.clients.push(clientInfo);
			this.handleLogs(clientInfo);
		}

		log.info(`🚀 ${count} clients started`);
	}

	getAllRunningProcesses(): ProcessInfo[] {
		const processes: ProcessInfo[] = [];

		if (this.server) processes.push(this.server);
		if (this.visualizer) processes.push(this.visualizer);
		processes.push(...this.clients);

		return processes;
	}

	getStatus() {
		const running = this.getAllRunningProcesses();
		return {
			totalProcesses: running.length,
			server: !!this.server,
			visualizer: !!this.visualizer,
			clients: this.clients.length,
			processes: running.map((p) => ({
				name: p.name,
				startTime: p.startTime,
				runtime: Date.now() - p.startTime.getTime(),
			})),
		};
	}

	async stopAll() {
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

		this.server = null;
		this.clients = [];
		this.visualizer = null;

		log.info("✅ All processes stopped");
	}

	async waitForAllProcesses(timeout: number | null = null) {
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

	async keepAlive() {
		while (this.getAllRunningProcesses().length > 0 && !this.isShuttingDown) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	private async shutdown() {
		if (this.isShuttingDown) return;

		this.isShuttingDown = true;
		log.info("🔌 Received shutdown signal, stopping all processes...");

		try {
			await this.stopAll();
		} catch (error) {
			log.error(`🚨 Error during shutdown: ${error}`);
		}

		process.exit(0);
	}
}

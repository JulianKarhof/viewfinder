import { spawn } from "bun";
import { logger } from "./logger.js";

const log = logger.main;

export interface ProcessRunnerConfig {
	maxConcurrentProcesses?: number;
}
interface ProcessInfo {
	process: Bun.Subprocess<"pipe", "pipe", "pipe">;
	name: string;
	startTime: Date;
}

export class ProcessRunner {
	private config: ProcessRunnerConfig = {};
	private server: ProcessInfo | null = null;
	private clients: ProcessInfo[] = [];
	private visualizer: ProcessInfo | null = null;
	private isShuttingDown = false;
	private pendingResponses: Map<number, (response: any) => void> = new Map();

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
			log.info("All processes have exited. Shutting down.");
			process.exit(0);
		}
	}

	async sendPing(processName: string): Promise<boolean> {
		const response = await this.sendCommand(processName, '{ type: "ping" }');
		return response.success === true;
	}

	async sendCommand(processName: string, command: unknown): Promise<unknown> {
		const process = this.findProcess(processName);
		const commandWithId = {
			id: Date.now(),
			command,
		};

		log.info(
			`Sending command to ${processName}: ${JSON.stringify(commandWithId)}`,
		);

		const writer = process?.process.stdin;
		writer?.write(
			`${new TextEncoder().encode(JSON.stringify(commandWithId))}\n`,
		);

		return new Promise((resolve) => {
			this.pendingResponses.set(commandWithId.id, (response) => {
				log.info(`Response from ${processName}: ${JSON.stringify(response)}`);

				this.pendingResponses.delete(commandWithId.id);
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

	private handleResponses(processInfo: ProcessInfo) {
		const { process: proc, name } = processInfo;

		if (proc.stdout) {
			proc.stdout.pipeTo(
				new WritableStream({
					write: (chunk) => {
						const text = new TextDecoder().decode(chunk).trim();

						if (text && text.charAt(0) === "{") {
							try {
								const response = JSON.parse(text);
								const callback = this.pendingResponses.get(response.commandId);
								if (callback) {
									callback(response);
								} else {
									log.warn(
										`No pending response handler for commandId ${response.commandId} from ${name}`,
									);
									log.debug(`Unmatched response: ${text}`);
								}
							} catch {
								console.log(text);
							}
						} else if (text) {
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
						const text = new TextDecoder().decode(chunk).trim();
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
					log.info(`[${name}] exited successfully after ${runtime}ms`);
				} else {
					log.error(
						`[${name}] exited with code ${exitCode} after ${runtime}ms`,
					);
				}
				this.cleanupProcess(name);
			})
			.catch((error) => {
				log.error(`[${name}] crashed: ${error.message}`);
				this.cleanupProcess(name);
			});
	}

	async startServer() {
		if (this.server) {
			throw new Error("Server is already running");
		}

		log.info("Starting server...");
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

		this.handleResponses(this.server);
		log.info("Server started");
	}

	async startVisualizer() {
		if (this.visualizer) {
			throw new Error("Visualizer is already running");
		}

		log.info("Starting visualizer...");
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

		this.handleResponses(this.visualizer);
		log.info("Visualizer started");
	}

	async startClients(count: number) {
		log.info(`Starting ${count} clients...`);

		for (let i = 0; i < count; i++) {
			const proc = spawn(["bun", "client.ts"], {
				stdout: "pipe",
				stderr: "pipe",
				stdin: "pipe",
				env: {
					...process.env,
					CLIENT_ID: String(i + 1),
				},
			});

			const clientInfo = {
				process: proc,
				name: `client-${i + 1}`,
				startTime: new Date(),
			};

			this.clients.push(clientInfo);
			this.handleResponses(clientInfo);
		}

		log.info(`${count} clients started`);
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
		log.info("Stopping all processes...");

		const processes = this.getAllRunningProcesses();

		for (const processInfo of processes) {
			try {
				log.info(`Stopping ${processInfo.name}...`);
				processInfo.process.kill("SIGTERM");
			} catch (error) {
				log.error(`Failed to stop ${processInfo.name}: ${error}`);
				try {
					processInfo.process.kill("SIGKILL");
				} catch (killError) {
					log.error(`Failed to force kill ${processInfo.name}: ${killError}`);
				}
			}
		}

		const timeout = setTimeout(() => {
			log.warn(
				"Timeout waiting for processes to exit, force killing remaining processes",
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

		log.info("All processes stopped");
	}

	async waitForAllProcesses() {
		const processes = this.getAllRunningProcesses();

		if (processes.length === 0) {
			log.info("No processes running");
			return;
		}

		log.info(`Waiting for ${processes.length} processes to complete...`);

		await Promise.allSettled(
			processes.map((p) => p.process.exited.catch(() => {})),
		);

		log.info("All processes have completed");
	}

	async keepAlive() {
		while (this.getAllRunningProcesses().length > 0 && !this.isShuttingDown) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	private async shutdown() {
		if (this.isShuttingDown) return;

		this.isShuttingDown = true;
		log.info("Received shutdown signal, stopping all processes...");

		try {
			await this.stopAll();
		} catch (error) {
			log.error(`Error during shutdown: ${error}`);
		}

		process.exit(0);
	}
}

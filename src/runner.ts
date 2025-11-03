import { spawn } from "bun";
import { Settings } from "./env.ts";
import { logger } from "./logger.ts";
import type { Action, AddShapeAction, Shape } from "./types.ts";

const log = logger.main;

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
	action: Action;
}

export interface MoveWindowCommand {
	type: "moveWindow";
	location: {
		x: number;
		y: number;
	};
}

export type Command = PingCommand | SendActionCommand | MoveWindowCommand;

export class ClientWrapper {
	private _runner: ProcessRunner;
	private _clientId: number;

	constructor(runner: ProcessRunner, clientId: number) {
		this._runner = runner;
		this._clientId = clientId;
	}

	private get _clientName(): string {
		return `client-${this._clientId}`;
	}

	async ping(): Promise<boolean> {
		return this._runner.sendPing(this._clientName);
	}

	async moveWindow(location: {
		x: number;
		y: number;
	}): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "moveWindow",
			location,
		});
	}

	/**
	 * Makes the client send an addShape command. If no shape is provided, the client will generate a random shape within its viewport coordinates.
	 */
	async addShape(
		shape: Shape,
		coordinateMode: AddShapeAction["coordinateMode"] = "global",
	): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "sendAction",
			action: {
				type: "addShape",
				timestamp: Date.now(),
				coordinateMode,
				shape: shape,
			},
		});
	}

	async updateShape(
		shape: Omit<Partial<Shape> & Pick<Shape, "id" | "type">, "version">,
	): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "sendAction",
			action: {
				type: "updateShape",
				timestamp: Date.now(),
				shape: shape,
			},
		});
	}

	async addRandomShapeInViewport(): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "sendAction",
			action: {
				type: "addShape",
				timestamp: Date.now(),
				coordinateMode: "local",
			},
		});
	}

	async sendAction(action: Action): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, {
			type: "sendAction",
			action,
		});
	}

	async sendCommand(
		command: Command,
		timeoutMs?: number,
	): Promise<CommandResponse> {
		return this._runner.sendCommand(this._clientName, command, timeoutMs);
	}
}

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
	private _server: ProcessInfo | null = null;
	private _clients: ProcessInfo[] = [];
	private _visualizer: ProcessInfo | null = null;
	private _isShuttingDown = false;
	private _pendingResponses: Map<number, (response: CommandResponse) => void> =
		new Map();

	constructor() {
		process.on("SIGINT", () => this._shutdown());
		process.on("SIGTERM", () => this._shutdown());
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

	async sendPing(processName: string): Promise<boolean> {
		const response = await this.sendCommand(processName, { type: "ping" });
		return response.success === true;
	}

	async sendCommand(
		processName: string,
		command: Command,
		timeoutMs: number = Settings.isDebugMode ? 60000 : 100,
	): Promise<CommandResponse> {
		const process = this._findProcess(processName);
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
				this._pendingResponses.delete(commandMessage.id);
				if (!Settings.isDebugMode) {
					throw new Error(
						`🚨 Command to ${processName} timed out after ${timeoutMs}ms`,
					);
				}

				log.warn(`⚠️  Command to ${processName} timed out after ${timeoutMs}ms`);
				resolve({
					id: commandMessage.id,
					success: false,
					error: `Command timeout after ${timeoutMs}ms`,
				});
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

	async startServer() {
		if (this._server) {
			throw new Error("🚨 Server is already running");
		}

		log.info("⏳ Starting server...");
		const proc = spawn(["bun", "src/server.ts"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
		});

		this._server = {
			process: proc,
			name: "server",
			startTime: new Date(),
		};

		this._handleLogs(this._server);
		log.info("🚀 Server started");
	}

	async startVisualizer() {
		if (this._visualizer) {
			throw new Error("🚨 Visualizer is already running");
		}

		log.info("⏳ Starting visualizer...");
		const proc = spawn(["bun", "src/visualizer.ts"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "pipe",
		});

		this._visualizer = {
			process: proc,
			name: "visualizer",
			startTime: new Date(),
		};

		this._handleLogs(this._visualizer);
		log.info("🚀 Visualizer started");
	}

	async startClients(count: number) {
		log.info(`⏳ Starting ${count} clients...`);

		for (let i = 0; i < count; i++) {
			const proc = spawn(["bun", "src/client.ts"], {
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
				name: `client-${i + 1}`,
				startTime: new Date(),
			};

			this._clients.push(clientInfo);
			this._handleLogs(clientInfo);
		}

		log.info(`🚀 ${count} clients started`);
	}

	getAllRunningProcesses(): ProcessInfo[] {
		const processes: ProcessInfo[] = [];

		if (this._server) processes.push(this._server);
		if (this._visualizer) processes.push(this._visualizer);
		processes.push(...this._clients);

		return processes;
	}

	getStatus() {
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

		this._server = null;
		this._clients = [];
		this._visualizer = null;

		log.info("✅ All processes stopped");
	}

	async waitForAllProcesses(timeout: number | null = null) {
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

	async keepAlive() {
		while (this.getAllRunningProcesses().length > 0 && !this._isShuttingDown) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	clients(): ClientWrapper[] {
		return this._clients.map((_, index) => new ClientWrapper(this, index + 1));
	}

	client(clientId: number): ClientWrapper {
		if (clientId > this._clients.length) {
			throw new Error(`🚨 Client ${clientId} is not running`);
		}
		return new ClientWrapper(this, clientId);
	}

	async wait(ms: number = Settings.waitTime) {
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

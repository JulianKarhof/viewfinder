export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = "client" | "server" | "visual" | "misc" | "main";

interface LoggerOptions {
	useColors?: boolean;
	showTimestamp?: boolean;
	showContext?: boolean;
	showData?: boolean;
}

interface LogEntry {
	level: LogLevel;
	context: LogContext;
	message: string;
	data?: unknown;
	timestamp: Date;
	contextId?: number;
}

class Logger {
	private _options: LoggerOptions;

	private static _colors = {
		reset: "\x1b[0m",
		bright: "\x1b[1m",
		dim: "\x1b[2m",

		black: "\x1b[30m",
		red: "\x1b[31m",
		green: "\x1b[32m",
		yellow: "\x1b[33m",
		blue: "\x1b[34m",
		magenta: "\x1b[35m",
		cyan: "\x1b[36m",
		white: "\x1b[37m",

		bgRed: "\x1b[41m",
		bgGreen: "\x1b[42m",
		bgYellow: "\x1b[43m",
		bgBlue: "\x1b[44m",
	};

	private static _levelColors: Record<LogLevel, string> = {
		debug: Logger._colors.cyan,
		info: Logger._colors.green,
		warn: Logger._colors.yellow,
		error: Logger._colors.red,
	};

	private static _contextColors: Record<LogContext, string> = {
		client: Logger._colors.magenta,
		server: Logger._colors.blue,
		visual: Logger._colors.green,
		misc: Logger._colors.white,
		main: Logger._colors.yellow,
	};

	constructor(options: LoggerOptions = {}) {
		this._options = {
			useColors: true,
			showTimestamp: true,
			showContext: true,
			...options,
		};
	}

	private _formatTimestamp(date: Date): string {
		return date.toISOString().replace("T", " ").substring(0, 19);
	}

	private _colorize(text: string, color: string): string {
		if (!this._options.useColors) return text;
		return `${color}${text}${Logger._colors.reset}`;
	}

	private _formatLogEntry(entry: LogEntry): string {
		const parts: string[] = [];

		if (this._options.showTimestamp) {
			const timestamp = this._formatTimestamp(entry.timestamp);
			parts.push(this._colorize(`[${timestamp}]`, Logger._colors.dim));
		}

		if (this._options.showContext) {
			const contextColor =
				Logger._contextColors[entry.context] ?? Logger._colors.white;
			let contextText = entry.context.toUpperCase().padEnd(9);
			if (entry.contextId !== undefined && entry.context === "client") {
				contextText =
					`CLIENT:${entry.contextId.toString().padStart(2, "0")}`.padEnd(9);
			}
			parts.push(this._colorize(`[${contextText}]`, contextColor));
		}

		const levelColor = Logger._levelColors[entry.level];
		const levelText = entry.level.toUpperCase().padStart(5);

		parts.push(this._colorize(levelText, levelColor));
		parts.push(entry.message);

		if (
			entry.data !== undefined &&
			(this._options.showData || entry.level === "error")
		) {
			try {
				let processedData = entry.data;

				if (
					entry.data &&
					typeof entry.data === "object" &&
					"type" in entry.data &&
					"data" in entry.data
				) {
					const messageEvent = entry.data as {
						type: string;
						data: string;
						isTrusted?: boolean;
					};
					processedData = {
						type: messageEvent.type,
						data: (() => {
							try {
								return JSON.parse(messageEvent.data);
							} catch {
								return messageEvent.data;
							}
						})(),
					};
				}

				const dataStr =
					typeof processedData === "string"
						? processedData
						: JSON.stringify(processedData, null, 2);
				parts.push(`\n ${dataStr}`);
			} catch (_) {
				parts.push(`\n ${String(entry.data)}`);
			}
		}

		return parts.join(" ");
	}

	private _log(
		level: LogLevel,
		context: LogContext,
		message: string,
		data?: unknown,
		clientId?: number,
	): void {
		const entry: LogEntry = {
			level,
			context,
			message,
			data,
			timestamp: new Date(),
			contextId: clientId,
		};

		const formattedMessage = this._formatLogEntry(entry);

		const consoleMethod =
			level === "error"
				? console.error
				: level === "warn"
					? console.warn
					: console.log;

		consoleMethod(formattedMessage);
	}

	debug(
		context: LogContext,
		message: string,
		data?: unknown,
		id?: number,
	): void {
		this._log("debug", context, message, data, id);
	}

	info(
		context: LogContext,
		message: string,
		data?: unknown,
		id?: number,
	): void {
		this._log("info", context, message, data, id);
	}

	warn(
		context: LogContext,
		message: string,
		data?: unknown,
		id?: number,
	): void {
		this._log("warn", context, message, data, id);
	}

	error(
		context: LogContext,
		message: string,
		data?: unknown,
		id?: number,
	): void {
		this._log("error", context, message, data, id);
	}

	client = (id?: number) => this._createContextLogger("client", id);
	server = this._createContextLogger("server");
	visualizer = this._createContextLogger("visual");
	misc = this._createContextLogger("misc");
	main = this._createContextLogger("main");

	private _createContextLogger(context: LogContext, id?: number) {
		return {
			debug: (message: string, data?: unknown) =>
				this.debug(context, message, data, id),
			info: (message: string, data?: unknown) =>
				this.info(context, message, data, id),
			warn: (message: string, data?: unknown) =>
				this.warn(context, message, data, id),
			error: (message: string, data?: unknown) =>
				this.error(context, message, data, id),
		};
	}

	setOptions(options: Partial<LoggerOptions>): void {
		this._options = { ...this._options, ...options };
	}
}

export const logger = new Logger({ showData: false });

export { Logger };

import SuperJSON from "superjson";
import type { Command, MetricsMessage } from "../types";

export class ClientMetricsCollector {
	private _bytesReceived = 0;
	private _bytesSent = 0;
	private _messageCount = 0;
	private _intervalId: NodeJS.Timeout | null = null;

	public trackMessage(message: Command | Event, direction: "in" | "out") {
		const bytes = new TextEncoder().encode(SuperJSON.stringify(message)).length;
		if (direction === "in") this._bytesReceived += bytes;
		else this._bytesSent += bytes;
		this._messageCount++;
	}

	public startCollection() {
		this._intervalId = setInterval(() => {
			this.sendMetricsToMain();
		}, 1);
	}

	public stopCollection() {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}
	}

	public sendMetricsToMain() {
		process.send?.({
			type: "metrics",
			data: {
				dataType: "throughput",
				processId: `client-${process.env.CLIENT_ID}`,
				clientId: parseInt(process.env.CLIENT_ID || "0", 10),
				bytesReceived: this._bytesReceived,
				bytesSent: this._bytesSent,
				avgMessageSize:
					this._messageCount > 0
						? (this._bytesReceived + this._bytesSent) / this._messageCount
						: 0,
				messageCount: this._messageCount,
				timestamp: Date.now(),
			},
		} as MetricsMessage);
	}
}

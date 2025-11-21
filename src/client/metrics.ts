import SuperJSON from "superjson";
import type { Command, Event, MetricsMessage } from "../types";

export class ClientMetricsCollector {
	private _bytesReceived = 0;
	private _bytesSent = 0;

	public trackMessage(message: Command | Event, direction: "in" | "out") {
		const bytes = new TextEncoder().encode(SuperJSON.stringify(message)).length;
		if (direction === "in") this._bytesReceived += bytes;
		else this._bytesSent += bytes;
	}

	public sendFinalMetrics() {
		process.send?.({
			type: "metrics",
			data: {
				dataType: "throughput",
				processId: `client-${process.env.CLIENT_ID}`,
				clientId: parseInt(process.env.CLIENT_ID || "0", 10),
				bytesReceived: this._bytesReceived,
				bytesSent: this._bytesSent,
				timestamp: Date.now(),
			},
		} as MetricsMessage);
	}
}

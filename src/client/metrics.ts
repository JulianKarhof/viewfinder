import * as microtime from "microtime";
import SuperJSON from "superjson";
import type { Command, Event, MetricsMessage } from "../types";

interface LatencySample {
	clientId: number;
	targetClientId: number;
	clientToClientUs: number;
	clientToServerUs: number;
	serverToClientUs: number;
	operation: string;
	timestamp: number;
}

interface LatencyStats {
	count: number;
	avgClientToClientUs: number;
	minClientToClientUs: number;
	maxClientToClientUs: number;
	avgClientToServerUs: number;
	minClientToServerUs: number;
	maxClientToServerUs: number;
	avgServerToClientUs: number;
	minServerToClientUs: number;
	maxServerToClientUs: number;
}

export class ClientMetricsCollector {
	private _bytesReceived = 0;
	private _bytesSent = 0;
	private _lastReportedBytesReceived = 0;
	private _lastReportedBytesSent = 0;
	private _intervalId?: NodeJS.Timeout;
	private _latencySamples: LatencySample[] = [];
	private _clientId: number;

	public constructor(clientId: number) {
		this._clientId = clientId;
	}

	public trackMessage(message: Command | Event, direction: "in" | "out") {
		const bytes = new TextEncoder().encode(SuperJSON.stringify(message)).length;
		if (direction === "in") {
			this._bytesReceived += bytes;

			if ("origin" in message) {
				const event = message as Event;

				if (event.origin || event.origin === 0) {
					this._latencySamples.push({
						clientId: event.origin || 0,
						targetClientId: this._clientId,
						clientToClientUs: microtime.now() - (event.clientSentAt || 0),
						clientToServerUs:
							(event.serverReceivedAt || 0) - (event.clientSentAt || 0),
						serverToClientUs: microtime.now() - (event.serverSentAt || 0),
						operation: event.type,
						timestamp: Date.now(),
					});
				}
			}
		} else {
			this._bytesSent += bytes;
		}
	}

	public startPeriodicReporting(intervalMs = 1) {
		if (this._intervalId) {
			return;
		}

		this._intervalId = setInterval(() => {
			this._sendMetrics();
		}, intervalMs);
	}

	public stopPeriodicReporting() {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = undefined;
		}
	}

	public sendFinalMetrics() {
		this.stopPeriodicReporting();
		this._sendMetrics();
	}

	private _sendMetrics() {
		const deltaReceived = this._bytesReceived - this._lastReportedBytesReceived;
		const deltaSent = this._bytesSent - this._lastReportedBytesSent;

		process.send?.({
			type: "metrics",
			data: {
				dataType: "throughput",
				processId: `client-${this._clientId}`,
				clientId: this._clientId,
				bytesReceived: deltaReceived,
				bytesSent: deltaSent,
				timestamp: Date.now(),
			},
		} as MetricsMessage);

		this._lastReportedBytesReceived = this._bytesReceived;
		this._lastReportedBytesSent = this._bytesSent;

		if (this._latencySamples.length > 0) {
			const samplesByOperation: Record<string, LatencySample[]> = {};
			for (const sample of this._latencySamples) {
				if (!samplesByOperation[sample.operation]) {
					samplesByOperation[sample.operation] = [];
				}
				samplesByOperation[sample.operation].push(sample);
			}

			for (const [operation, samples] of Object.entries(samplesByOperation)) {
				const stats = this._calculateLatencyStats(samples);
				process.send?.({
					type: "metrics",
					data: {
						dataType: "latency",
						processId: `client-${this._clientId}`,
						clientId: this._clientId,
						targetClientId: this._clientId,
						operation,
						...stats,
						timestamp: Date.now(),
					},
				} as MetricsMessage);
			}

			this._latencySamples = [];
		}
	}

	private _getStats(values: number[]): {
		min: number;
		max: number;
		avg: number;
	} {
		const sum = values.reduce((a, b) => a + b, 0);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const avg = sum / values.length;
		return { min, max, avg };
	}

	private _calculateLatencyStats(
		samples: LatencySample[] = this._latencySamples,
	): LatencyStats {
		const count = samples.length;
		const clientToClientValues = samples.map((s) => s.clientToClientUs);
		const {
			min: minClientToClient,
			max: maxClientToClient,
			avg: avgClientToClient,
		} = this._getStats(clientToClientValues);
		const clientToServerValues = samples.map((s) => s.clientToServerUs);
		const {
			min: minClientToServer,
			max: maxClientToServer,
			avg: avgClientToServer,
		} = this._getStats(clientToServerValues);
		const serverToClientValues = samples.map((s) => s.serverToClientUs);
		const {
			min: minServerToClient,
			max: maxServerToClient,
			avg: avgServerToClient,
		} = this._getStats(serverToClientValues);
		return {
			count,
			avgClientToClientUs: avgClientToClient,
			minClientToClientUs: minClientToClient,
			maxClientToClientUs: maxClientToClient,
			avgClientToServerUs: avgClientToServer,
			minClientToServerUs: minClientToServer,
			maxClientToServerUs: maxClientToServer,
			avgServerToClientUs: avgServerToClient,
			minServerToClientUs: minServerToClient,
			maxServerToClientUs: maxServerToClient,
		};
	}
}

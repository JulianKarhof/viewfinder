import type { MetricsMessage, ServerMetrics } from "../types";
import type { ClientManager } from "./clientManager";

export class ServerMetricsCollector {
	private _intervalId: NodeJS.Timeout | null = null;
	private _lastCpuUsage = process.cpuUsage();

	public constructor(private _clientManager: ClientManager) {}

	public startCollection() {
		this._intervalId = setInterval(() => {
			const currentCpuUsage = process.cpuUsage(this._lastCpuUsage);
			const memUsage = process.memoryUsage();

			const serverMetrics: ServerMetrics = {
				dataType: "serverMetrics",
				timestamp: Date.now(),
				processId: "server",
				cpuPercent: this._calculateCpuPercent(currentCpuUsage),
				memoryMB: memUsage.rss / 1024 / 1024,
				heapUsedMB: memUsage.heapUsed / 1024 / 1024,
				heapTotalMB: memUsage.heapTotal / 1024 / 1024,
				activeConnections: this._clientManager.getClients().length,
				uptime: process.uptime(),
			};

			process.send?.({
				type: "metrics",
				data: serverMetrics,
			} as MetricsMessage);

			this._lastCpuUsage = process.cpuUsage();
		}, 1);
	}

	private _calculateCpuPercent(cpuUsage: NodeJS.CpuUsage): number {
		const totalMicroseconds = cpuUsage.user + cpuUsage.system;
		return totalMicroseconds / 1000 / 100;
	}

	public stopCollection() {
		if (this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}
	}
}

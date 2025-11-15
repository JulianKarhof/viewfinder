import { writeFile } from "node:fs/promises";
import SuperJSON from "superjson";
import type {
	LatencyMetrics,
	MetricsData,
	ServerMetrics,
	ThroughputMetrics,
} from "../types";
import { initializeRandom } from "../utils/seededRandom";

export interface BenchmarkConfig {
	clientCount: number;
}

export interface BenchmarkRun {
	runId: string;
	runIndex: number;
	startTime: string;
	endTime?: string;
	duration?: number;
	config: BenchmarkConfig;
}

export interface BenchmarkSuite {
	suiteId: string;
	totalRuns: number;
	startTime: string;
	endTime?: string;
	config: BenchmarkConfig;
	runs: BenchmarkRun[];
}

export type RunMetricsData = MetricsData & {
	runId: string;
	runIndex: number;
};

export interface MetricsSummary {
	count: number;
	avg: number;
	min: number;
	max: number;
	p50: number;
	p95: number;
	p99: number;
}

export interface ThroughputSummary {
	avgBytesReceivedPerSecond: number;
	avgBytesSentPerSecond: number;
	totalBytesReceived: number;
	totalBytesSent: number;
	byClient: Record<
		number,
		{
			bytesReceived: MetricsSummary;
			bytesSent: MetricsSummary;
		}
	>;
}

export interface ServerMetricsSummary {
	cpu: MetricsSummary;
	memory: MetricsSummary;
	heapUsed: MetricsSummary;
	activeConnections: MetricsSummary;
}

export interface LatencySummary {
	byOperation: Record<string, MetricsSummary>;
	overall: MetricsSummary;
}

export interface BenchmarkSummary {
	throughput: ThroughputSummary;
	serverMetrics: ServerMetricsSummary;
	latency: LatencySummary;
}

export interface BenchmarkResults {
	metadata: BenchmarkSuite;
	rawData: RunMetricsData[];
	summary: BenchmarkSummary;
}

export class BenchmarkCollector {
	private _suiteId: string;
	private _config: BenchmarkConfig;
	private _suite: BenchmarkSuite;
	private _currentRun: BenchmarkRun | null = null;
	private _allRunsData: RunMetricsData[] = [];
	private _currentRunData: RunMetricsData[] = [];

	public constructor(config: BenchmarkConfig) {
		this._suiteId = `benchmark-${Date.now()}`;
		this._config = config;
		this._suite = {
			suiteId: this._suiteId,
			totalRuns: 0,
			startTime: new Date().toISOString(),
			config,
			runs: [],
		};
	}

	public addMetrics(data: MetricsData): void {
		if (!this._currentRun) {
			throw new Error("No active benchmark run. Call startRun() first.");
		}

		const runMetrics: RunMetricsData = {
			...data,
			runId: this._currentRun.runId,
			runIndex: this._currentRun.runIndex,
		};

		this._currentRunData.push(runMetrics);
	}

	public startRun(runIndex: number): void {
		if (this._currentRun) {
			throw new Error(
				"A benchmark run is already active. Call endRun() first.",
			);
		}

		const runId = `${this._suiteId}-run-${runIndex}`;
		this._currentRun = {
			runId,
			runIndex,
			startTime: new Date().toISOString(),
			config: this._config,
		};

		const seed = 42;
		initializeRandom(seed);
		process.env.RANDOM_SEED = String(seed);

		this._currentRunData = [];
		console.log(
			`📊 Started benchmark run ${runIndex} (${runId}) with seed ${seed}`,
		);
	}

	public endRun(): void {
		if (!this._currentRun) {
			throw new Error("No active benchmark run to end.");
		}

		const endTime = new Date().toISOString();
		const startTime = new Date(this._currentRun.startTime).getTime();
		const duration = Date.now() - startTime;

		this._currentRun.endTime = endTime;
		this._currentRun.duration = duration;

		this._allRunsData.push(...this._currentRunData);
		this._suite.runs.push({ ...this._currentRun });

		console.log(
			`✅ Completed run ${this._currentRun.runIndex} in ${duration}ms`,
		);
		this._currentRun = null;
		this._currentRunData = [];
	}

	public completeSuite(): void {
		this._suite.endTime = new Date().toISOString();
		this._suite.totalRuns = this._suite.runs.length;
		console.log(
			`🏁 Completed benchmark suite with ${this._suite.totalRuns} runs`,
		);
	}

	private _getThroughputMetrics(): (RunMetricsData & ThroughputMetrics)[] {
		return this._allRunsData.filter(
			(data): data is RunMetricsData & ThroughputMetrics =>
				data.dataType === "throughput",
		);
	}

	private _getServerMetrics(): (RunMetricsData & ServerMetrics)[] {
		return this._allRunsData.filter(
			(data): data is RunMetricsData & ServerMetrics =>
				data.dataType === "serverMetrics",
		);
	}

	private _getLatencyMetrics(): (RunMetricsData & LatencyMetrics)[] {
		return this._allRunsData.filter(
			(data): data is RunMetricsData & LatencyMetrics =>
				data.dataType === "latency",
		);
	}

	private _calculateSummary(values: number[]): MetricsSummary {
		if (values.length === 0) {
			return { count: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
		}

		const sorted = [...values].sort((a, b) => a - b);
		const count = values.length;
		const sum = values.reduce((a, b) => a + b, 0);

		return {
			count,
			avg: sum / count,
			min: sorted[0],
			max: sorted[count - 1],
			p50: sorted[Math.floor(count * 0.5)],
			p95: sorted[Math.floor(count * 0.95)],
			p99: sorted[Math.floor(count * 0.99)],
		};
	}

	private _generateSummary(): BenchmarkSummary {
		const throughputData = this._getThroughputMetrics();
		const serverData = this._getServerMetrics();
		const latencyData = this._getLatencyMetrics();

		const totalBytesReceived = throughputData.reduce(
			(sum, d) => sum + d.bytesReceived,
			0,
		);
		const totalBytesSent = throughputData.reduce(
			(sum, d) => sum + d.bytesSent,
			0,
		);
		const totalDurationSeconds =
			this._suite.runs.reduce((sum, run) => sum + (run.duration || 0), 0) /
			1000;

		const byClient: Record<
			number,
			{
				bytesReceived: MetricsSummary;
				bytesSent: MetricsSummary;
			}
		> = {};
		const clientIds = [...new Set(throughputData.map((d) => d.clientId))];

		for (const clientId of clientIds) {
			const clientData = throughputData.filter((d) => d.clientId === clientId);
			byClient[clientId] = {
				bytesReceived: this._calculateSummary(
					clientData.map((d) => d.bytesReceived),
				),
				bytesSent: this._calculateSummary(clientData.map((d) => d.bytesSent)),
			};
		}

		const byOperation: Record<string, MetricsSummary> = {};
		const operations = [...new Set(latencyData.map((d) => d.operation))];

		for (const operation of operations) {
			const operationData = latencyData.filter(
				(d) => d.operation === operation,
			);
			byOperation[operation] = this._calculateSummary(
				operationData.map((d) => d.clientToClientUs / 1000),
			);
		}

		return {
			throughput: {
				avgBytesReceivedPerSecond: totalBytesReceived / totalDurationSeconds,
				avgBytesSentPerSecond: totalBytesSent / totalDurationSeconds,
				totalBytesReceived,
				totalBytesSent,
				byClient,
			},
			serverMetrics: {
				cpu: this._calculateSummary(serverData.map((d) => d.cpuPercent)),
				memory: this._calculateSummary(serverData.map((d) => d.memoryMB)),
				heapUsed: this._calculateSummary(serverData.map((d) => d.heapUsedMB)),
				activeConnections: this._calculateSummary(
					serverData.map((d) => d.activeConnections),
				),
			},
			latency: {
				byOperation,
				overall: this._calculateSummary(
					latencyData.map((d) => d.clientToClientUs / 1000),
				),
			},
		};
	}

	public async saveResults(basePath: string): Promise<void> {
		if (this._currentRun) {
			throw new Error(
				"Cannot save results while a run is active. Call endRun() first.",
			);
		}

		this.completeSuite();

		const lastDotIndex = basePath.lastIndexOf(".");
		const extension =
			lastDotIndex > -1 ? basePath.substring(lastDotIndex) : ".json";
		const baseNameWithoutExt =
			lastDotIndex > -1 ? basePath.substring(0, lastDotIndex) : basePath;

		const dir = basePath.substring(0, basePath.lastIndexOf("/"));
		if (dir) {
			await import("node:fs/promises").then((fs) =>
				fs.mkdir(dir, { recursive: true }),
			);
		}

		const throughputData = this._getThroughputMetrics();
		const latencyData = this._getLatencyMetrics();
		const serverData = this._getServerMetrics();
		const summary = this._generateSummary();

		const summaryData = {
			metadata: this._suite,
			summary: summary,
		};

		const throughputPath = `${baseNameWithoutExt}-throughput${extension}`;
		const latencyPath = `${baseNameWithoutExt}-latency${extension}`;
		const serverPath = `${baseNameWithoutExt}-server${extension}`;
		const summaryPath = `${baseNameWithoutExt}-summary${extension}`;

		await Promise.all([
			writeFile(throughputPath, SuperJSON.stringify(throughputData)),
			writeFile(latencyPath, SuperJSON.stringify(latencyData)),
			writeFile(serverPath, SuperJSON.stringify(serverData)),
			writeFile(summaryPath, SuperJSON.stringify(summaryData)),
		]);

		console.log(`💾 Saved benchmark results.`);
	}

	public printSummary(): void {
		const summary = this._generateSummary();

		console.log("\n📊 BENCHMARK SUMMARY");
		console.log("=".repeat(50));
		console.log(`Suite ID: ${this._suiteId}`);
		console.log(`Total Runs: ${this._suite.totalRuns}`);
		console.log(
			`Duration: ${new Date(this._suite.endTime ?? 0).getTime() - new Date(this._suite.startTime).getTime()}ms`,
		);

		console.log("\n📡 THROUGHPUT:");
		console.log(
			`  Avg Received: ${(summary.throughput.avgBytesReceivedPerSecond / 1024).toFixed(2)} KB/s`,
		);
		console.log(
			`  Total Received: ${(summary.throughput.totalBytesReceived / 1024).toFixed(2)} KB`,
		);
		console.log(
			`  Avg Sent: ${(summary.throughput.avgBytesSentPerSecond / 1024).toFixed(2)} KB/s`,
		);
		console.log(
			`  Total Sent: ${(summary.throughput.totalBytesSent / 1024).toFixed(2)} KB`,
		);

		console.log("\n🖥️  SERVER:");
		console.log(
			`  CPU: ${summary.serverMetrics.cpu.avg.toFixed(3)}% (max: ${summary.serverMetrics.cpu.max.toFixed(3)}%)`,
		);
		console.log(
			`  Memory: ${summary.serverMetrics.memory.avg.toFixed(1)} MB (max: ${summary.serverMetrics.memory.max.toFixed(1)} MB)`,
		);

		console.log("\n📶 LATENCY:");
		const overallAvg = summary.latency.overall.avg;
		const overallP95 = summary.latency.overall.p95;
		const overallP99 = summary.latency.overall.p99;
		console.log(
			`  Overall: ${overallAvg.toFixed(2)}ms (p95: ${overallP95.toFixed(2)}ms, p99: ${overallP99.toFixed(2)}ms)`,
		);

		for (const [operation, stats] of Object.entries(
			summary.latency.byOperation,
		)) {
			console.log(
				`  ${operation}: ${stats.avg.toFixed(2)}ms (p95: ${stats.p95.toFixed(2)}ms)`,
			);
		}
		console.log("=".repeat(50));
	}

	public get isRunActive(): boolean {
		return this._currentRun !== null;
	}

	public get currentRunId(): string | null {
		return this._currentRun?.runId || null;
	}

	public get totalMetricsCollected(): number {
		return this._allRunsData.length;
	}
}

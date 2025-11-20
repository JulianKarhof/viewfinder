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
	stdDev: number;
	coefficientOfVariation: number;
	confidenceInterval95: [number, number];
}

export interface ThroughputSummary {
	avgBytesReceivedPerSecond: number;
	avgBytesSentPerSecond: number;
	bytesReceivedPerSecondStats: MetricsSummary;
	bytesSentPerSecondStats: MetricsSummary;
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
			return {
				count: 0,
				avg: 0,
				min: 0,
				max: 0,
				p50: 0,
				p95: 0,
				p99: 0,
				stdDev: 0,
				coefficientOfVariation: 0,
				confidenceInterval95: [0, 0],
			};
		}

		const sorted = [...values].sort((a, b) => a - b);
		const count = values.length;
		const sum = values.reduce((a, b) => a + b, 0);
		const avg = sum / count;

		const variance =
			values.reduce((acc, val) => acc + (val - avg) ** 2, 0) / count;
		const stdDev = Math.sqrt(variance);

		const coefficientOfVariation = avg > 0 ? (stdDev / avg) * 100 : 0;

		// Calculate 95% confidence interval (assuming normal distribution)
		// CI = mean ± (1.96 * standard_error), where standard_error = stdDev / sqrt(n)
		const standardError = stdDev / Math.sqrt(count);
		const marginOfError = 1.96 * standardError;
		const confidenceInterval95: [number, number] = [
			Math.max(0, avg - marginOfError),
			avg + marginOfError,
		];

		return {
			count,
			avg,
			min: sorted[0],
			max: sorted[count - 1],
			p50: sorted[Math.floor(count * 0.5)],
			p95: sorted[Math.floor(count * 0.95)],
			p99: sorted[Math.floor(count * 0.99)],
			stdDev,
			coefficientOfVariation,
			confidenceInterval95,
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

		const latencyByRun: Record<
			string,
			{ latencies: number[]; byOperation: Record<string, number[]> }
		> = {};

		for (const data of latencyData) {
			if (!latencyByRun[data.runId]) {
				latencyByRun[data.runId] = { latencies: [], byOperation: {} };
			}
			const latencyMs = data.clientToClientUs / 1000;
			latencyByRun[data.runId].latencies.push(latencyMs);

			if (!latencyByRun[data.runId].byOperation[data.operation]) {
				latencyByRun[data.runId].byOperation[data.operation] = [];
			}
			latencyByRun[data.runId].byOperation[data.operation].push(latencyMs);
		}

		const avgLatencyPerRun = Object.values(latencyByRun).map((run) => {
			return (
				run.latencies.reduce((sum, lat) => sum + lat, 0) / run.latencies.length
			);
		});

		const byOperation: Record<string, MetricsSummary> = {};
		const operations = [...new Set(latencyData.map((d) => d.operation))];

		for (const operation of operations) {
			const avgLatencyPerRunForOperation = Object.values(latencyByRun)
				.filter(
					(run) =>
						run.byOperation[operation] && run.byOperation[operation].length > 0,
				)
				.map((run) => {
					const opLatencies = run.byOperation[operation];
					return (
						opLatencies.reduce((sum, lat) => sum + lat, 0) / opLatencies.length
					);
				});
			byOperation[operation] = this._calculateSummary(
				avgLatencyPerRunForOperation,
			);
		}

		const throughputByRun: Record<string, { received: number; sent: number }> =
			{};

		for (const data of throughputData) {
			if (!throughputByRun[data.runId]) {
				throughputByRun[data.runId] = { received: 0, sent: 0 };
			}
			throughputByRun[data.runId].received += data.bytesReceived;
			throughputByRun[data.runId].sent += data.bytesSent;
		}

		const bytesReceivedPerRun = Object.values(throughputByRun).map(
			(run) => run.received,
		);
		const bytesSentPerRun = Object.values(throughputByRun).map(
			(run) => run.sent,
		);

		return {
			throughput: {
				avgBytesReceivedPerSecond: totalBytesReceived / totalDurationSeconds,
				avgBytesSentPerSecond: totalBytesSent / totalDurationSeconds,
				totalBytesReceived,
				totalBytesSent,
				bytesReceivedPerSecondStats:
					this._calculateSummary(bytesReceivedPerRun),
				bytesSentPerSecondStats: this._calculateSummary(bytesSentPerRun),
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
				overall: this._calculateSummary(avgLatencyPerRun),
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
			`  Received Variability: CV=${summary.throughput.bytesReceivedPerSecondStats.coefficientOfVariation.toFixed(1)}% CI95=[${(summary.throughput.bytesReceivedPerSecondStats.confidenceInterval95[0] / 1024).toFixed(2)}, ${(summary.throughput.bytesReceivedPerSecondStats.confidenceInterval95[1] / 1024).toFixed(2)}] KB/run`,
		);
		console.log(
			`  Avg Sent: ${(summary.throughput.avgBytesSentPerSecond / 1024).toFixed(2)} KB/s`,
		);
		console.log(
			`  Total Sent: ${(summary.throughput.totalBytesSent / 1024).toFixed(2)} KB`,
		);
		console.log(
			`  Sent Variability: CV=${summary.throughput.bytesSentPerSecondStats.coefficientOfVariation.toFixed(1)}% CI95=[${(summary.throughput.bytesSentPerSecondStats.confidenceInterval95[0] / 1024).toFixed(2)}, ${(summary.throughput.bytesSentPerSecondStats.confidenceInterval95[1] / 1024).toFixed(2)}] KB/run`,
		);

		console.log("\n🖥️  SERVER:");
		console.log(
			`  CPU: ${summary.serverMetrics.cpu.avg.toFixed(3)}% (max: ${summary.serverMetrics.cpu.max.toFixed(3)}%)`,
		);
		console.log(
			`  CPU Variability: CV=${summary.serverMetrics.cpu.coefficientOfVariation.toFixed(1)}% CI95=[${summary.serverMetrics.cpu.confidenceInterval95[0].toFixed(2)}, ${summary.serverMetrics.cpu.confidenceInterval95[1].toFixed(2)}]%`,
		);
		console.log(
			`  Memory: ${summary.serverMetrics.memory.avg.toFixed(1)} MB (max: ${summary.serverMetrics.memory.max.toFixed(1)} MB)`,
		);
		console.log(
			`  Memory Variability: CV=${summary.serverMetrics.memory.coefficientOfVariation.toFixed(1)}% CI95=[${summary.serverMetrics.memory.confidenceInterval95[0].toFixed(1)}, ${summary.serverMetrics.memory.confidenceInterval95[1].toFixed(1)}] MB`,
		);

		console.log("\n📶 LATENCY:");
		const overallAvg = summary.latency.overall.avg;
		const overallP95 = summary.latency.overall.p95;
		const overallP99 = summary.latency.overall.p99;
		const overallCV = summary.latency.overall.coefficientOfVariation;
		const overallCI = summary.latency.overall.confidenceInterval95;

		console.log(
			`  Overall: ${overallAvg.toFixed(2)}ms (p95: ${overallP95.toFixed(2)}ms, p99: ${overallP99.toFixed(2)}ms)`,
		);
		console.log(
			`  Variability: CV=${overallCV.toFixed(1)}% CI95=[${overallCI[0].toFixed(2)}, ${overallCI[1].toFixed(2)}]ms`,
		);

		for (const [operation, stats] of Object.entries(
			summary.latency.byOperation,
		)) {
			console.log(
				`  ${operation}: ${stats.avg.toFixed(2)}ms (p95: ${stats.p95.toFixed(2)}ms, CV: ${stats.coefficientOfVariation.toFixed(1)}%)`,
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

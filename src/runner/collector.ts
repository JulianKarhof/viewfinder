import { writeFile } from "node:fs/promises";
import SuperJSON from "superjson";
import type {
	LatencyMetrics,
	MetricsData,
	ServerMetrics,
	ThroughputMetrics,
} from "../types";
import type {
	BenchmarkConfig,
	BenchmarkRun,
	BenchmarkSuite,
	BenchmarkSummary,
	LatencyByRun,
	MetricsSummary,
	PerRunStats,
	RunMetricsData,
	ScenarioEvent,
	StatisticalComparison,
} from "./types";

export class BenchmarkCollector {
	private _suiteId: string;
	private _config: BenchmarkConfig;
	private _suite: BenchmarkSuite;
	private _currentRun: BenchmarkRun | null = null;
	private _allRunsData: RunMetricsData[] = [];
	private _currentRunData: RunMetricsData[] = [];
	private _currentRunEvents: ScenarioEvent[] = [];

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
			relativeTimestamp: data.timestamp - this._currentRun.startTimeMs,
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
		const startTimeMs = Date.now();
		this._currentRun = {
			runId,
			runIndex,
			startTime: new Date(startTimeMs).toISOString(),
			startTimeMs,
			config: this._config,
		};

		this._currentRunData = [];
		this._currentRunEvents = [];
		console.log(`📊 Started benchmark run ${runIndex} (${runId})`);
	}

	public logEvent(event: string, details?: Record<string, unknown>): void {
		if (!this._currentRun) {
			return;
		}

		const now = Date.now();
		this._currentRunEvents.push({
			timestamp: now - this._currentRun.startTimeMs,
			timestampMs: now,
			event,
			details,
		});
	}

	public endRun(): void {
		if (!this._currentRun) {
			throw new Error("No active benchmark run to end.");
		}

		const endTimeMs = Date.now();
		const endTime = new Date(endTimeMs).toISOString();
		const duration = endTimeMs - this._currentRun.startTimeMs;

		this._currentRun.endTime = endTime;
		this._currentRun.endTimeMs = endTimeMs;
		this._currentRun.duration = duration;

		this._allRunsData.push(...this._currentRunData);

		this._currentRun.events = this._currentRunEvents;
		this._suite.runs.push({ ...this._currentRun });

		console.log(
			`✅ Completed run ${this._currentRun.runIndex} in ${duration}ms`,
		);
		this._currentRun = null;
		this._currentRunData = [];
		this._currentRunEvents = [];
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
		const latencyData = this._getLatencyMetrics();
		const perRunStats = this._generatePerRunStats();

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

		const latencyByRun: LatencyByRun = {};

		for (const data of latencyData) {
			if (!latencyByRun[data.runId]) {
				latencyByRun[data.runId] = {
					latencies: [],
					mins: [],
					maxs: [],
					byOperation: {},
				};
			}

			const avgLatencyMs = data.avgClientToClientUs / 1000;
			const minLatencyMs = data.minClientToClientUs / 1000;
			const maxLatencyMs = data.maxClientToClientUs / 1000;

			latencyByRun[data.runId].latencies.push(avgLatencyMs);
			latencyByRun[data.runId].mins.push(minLatencyMs);
			latencyByRun[data.runId].maxs.push(maxLatencyMs);

			if (!latencyByRun[data.runId].byOperation[data.operation]) {
				latencyByRun[data.runId].byOperation[data.operation] = {
					latencies: [],
					mins: [],
					maxs: [],
				};
			}

			latencyByRun[data.runId].byOperation[data.operation].latencies.push(
				avgLatencyMs,
			);
			latencyByRun[data.runId].byOperation[data.operation].mins.push(
				minLatencyMs,
			);
			latencyByRun[data.runId].byOperation[data.operation].maxs.push(
				maxLatencyMs,
			);
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
						run.byOperation[operation] &&
						run.byOperation[operation].latencies.length > 0,
				)
				.map((run) => {
					const opLatencies = run.byOperation[operation].latencies;
					return (
						opLatencies.reduce((sum, lat) => sum + lat, 0) / opLatencies.length
					);
				});

			byOperation[operation] = this._calculateSummary(
				avgLatencyPerRunForOperation,
			);

			const opMins = Object.values(latencyByRun).flatMap(
				(run) => run.byOperation[operation]?.mins || [],
			);
			const opMaxs = Object.values(latencyByRun).flatMap(
				(run) => run.byOperation[operation]?.maxs || [],
			);

			byOperation[operation].min = Math.min(...opMins);
			byOperation[operation].max = Math.max(...opMaxs);
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

		const avgCpuPerRun = perRunStats.map((run) => run.server.avgCpu);
		const maxCpuPerRun = perRunStats.map((run) => run.server.maxCpu);
		const avgMemoryPerRun = perRunStats.map((run) => run.server.avgMemory);
		const maxMemoryPerRun = perRunStats.map((run) => run.server.maxMemory);

		return {
			throughput: {
				avgBytesReceivedPerSecond: totalBytesReceived / totalDurationSeconds,
				avgBytesSentPerSecond: totalBytesSent / totalDurationSeconds,
				totalBytesReceived,
				totalBytesSent,
				avgBytesReceivedPerRun:
					bytesReceivedPerRun.reduce((sum, v) => sum + v, 0) /
					bytesReceivedPerRun.length,
				avgBytesSentPerRun:
					bytesSentPerRun.reduce((sum, v) => sum + v, 0) /
					bytesSentPerRun.length,
				bytesReceivedPerSecond: this._calculateSummary(bytesReceivedPerRun),
				bytesSentPerSecond: this._calculateSummary(bytesSentPerRun),
				byClient,
			},
			serverMetrics: {
				cpu: this._calculateSummary(avgCpuPerRun),
				cpuMax: this._calculateSummary(maxCpuPerRun),
				memory: this._calculateSummary(avgMemoryPerRun),
				memoryMax: this._calculateSummary(maxMemoryPerRun),
			},
			latency: {
				byOperation,
				overall: (() => {
					const overallSummary = this._calculateSummary(avgLatencyPerRun);
					const allMins = Object.values(latencyByRun).flatMap(
						(run) => run.mins,
					);
					const allMaxs = Object.values(latencyByRun).flatMap(
						(run) => run.maxs,
					);
					overallSummary.min = allMins.reduce(
						(a, b) => Math.min(a, b),
						Infinity,
					);
					overallSummary.max = allMaxs.reduce(
						(a, b) => Math.max(a, b),
						-Infinity,
					);
					return overallSummary;
				})(),
			},
		};
	}

	private _generatePerRunStats(): PerRunStats[] {
		const throughputData = this._getThroughputMetrics();
		const latencyData = this._getLatencyMetrics();
		const serverData = this._getServerMetrics();

		return this._suite.runs.map((run) => {
			const runThroughput = throughputData.filter((d) => d.runId === run.runId);
			const runLatency = latencyData.filter((d) => d.runId === run.runId);
			const runServer = serverData.filter((d) => d.runId === run.runId);

			const bytesReceived = runThroughput.reduce(
				(sum, d) => sum + d.bytesReceived,
				0,
			);
			const bytesSent = runThroughput.reduce((sum, d) => sum + d.bytesSent, 0);

			const latencies = runLatency.map((d) => d.avgClientToClientUs / 1000);
			const latencyStats = this._calculateSummary(latencies);
			const allMins = runLatency.map((d) => d.minClientToClientUs / 1000);
			const allMaxs = runLatency.map((d) => d.maxClientToClientUs / 1000);

			latencyStats.min = allMins.reduce((a, b) => Math.min(a, b), Infinity);
			latencyStats.max = allMaxs.reduce((a, b) => Math.max(a, b), -Infinity);

			const byOperation: Record<
				string,
				{ avg: number; p95: number; p99: number }
			> = {};
			const operations = [...new Set(runLatency.map((d) => d.operation))];

			for (const operation of operations) {
				const opLatencies = runLatency
					.filter((d) => d.operation === operation)
					.map((d) => d.avgClientToClientUs / 1000);
				const opStats = this._calculateSummary(opLatencies);
				const opMins = runLatency
					.filter((d) => d.operation === operation)
					.map((d) => d.minClientToClientUs / 1000);
				const opMaxs = runLatency
					.filter((d) => d.operation === operation)
					.map((d) => d.maxClientToClientUs / 1000);
				opStats.min = opMins.reduce((a, b) => Math.min(a, b), Infinity);
				opStats.max = opMaxs.reduce((a, b) => Math.max(a, b), -Infinity);
				byOperation[operation] = {
					avg: opStats.avg,
					p95: opStats.p95,
					p99: opStats.p99,
				};
			}

			const cpuStats = this._calculateSummary(
				runServer.map((d) => d.cpuPercent),
			);
			const memStats = this._calculateSummary(runServer.map((d) => d.memoryMB));

			const matchedRun = this._suite.runs.find((r) => r.runId === run.runId);
			const runEvents = matchedRun?.events || [];

			return {
				runIndex: run.runIndex,
				runId: run.runId,
				startTimeMs: run.startTimeMs,
				endTimeMs: run.endTimeMs || run.startTimeMs,
				duration: run.duration || 0,
				events: runEvents,
				throughput: {
					bytesReceived,
					bytesSent,
				},
				latency: {
					avg: latencyStats.avg,
					p95: latencyStats.p95,
					p99: latencyStats.p99,
					byOperation,
				},
				server: {
					avgCpu: cpuStats.avg,
					maxCpu: cpuStats.max,
					avgMemory: memStats.avg,
					maxMemory: memStats.max,
				},
			};
		});
	}

	public async saveResults(
		basePath: string,
		comparison?: StatisticalComparison,
	): Promise<void> {
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
		const perRunStats = this._generatePerRunStats();

		const summaryData = {
			metadata: this._suite,
			summary: summary,
			perRunStats,
			comparison,
		};

		const throughputPath = `${baseNameWithoutExt}-throughput${extension}`;
		const latencyPath = `${baseNameWithoutExt}-latency${extension}`;
		const serverPath = `${baseNameWithoutExt}-server${extension}`;
		const summaryPath = `${baseNameWithoutExt}-summary${extension}`;
		const perRunPath = `${baseNameWithoutExt}-per-run${extension}`;

		await Promise.all([
			writeFile(throughputPath, SuperJSON.stringify(throughputData)),
			writeFile(latencyPath, SuperJSON.stringify(latencyData)),
			writeFile(serverPath, SuperJSON.stringify(serverData)),
			writeFile(summaryPath, SuperJSON.stringify(summaryData)),
			writeFile(perRunPath, SuperJSON.stringify(perRunStats)),
		]);

		console.log(`💾 Saved benchmark results.`);
	}

	public printSummary(): void {
		const summary = this._generateSummary();
		const durationMs =
			new Date(this._suite.endTime ?? 0).getTime() -
			new Date(this._suite.startTime).getTime();

		const avgReceivedKBps = (
			summary.throughput.avgBytesReceivedPerSecond / 1024
		).toFixed(2);
		const totalReceivedKB = (
			summary.throughput.avgBytesReceivedPerRun / 1024
		).toFixed(2);
		const receivedCV =
			summary.throughput.bytesReceivedPerSecond.coefficientOfVariation.toFixed(
				1,
			);
		const receivedCI =
			summary.throughput.bytesReceivedPerSecond.confidenceInterval95
				.map((v) => (v / 1024).toFixed(2))
				.join(", ");
		const avgSentKBps = (
			summary.throughput.avgBytesSentPerSecond / 1024
		).toFixed(2);
		const totalSentKB = (summary.throughput.avgBytesSentPerRun / 1024).toFixed(
			2,
		);
		const sentCV =
			summary.throughput.bytesSentPerSecond.coefficientOfVariation.toFixed(1);
		const sentCI = summary.throughput.bytesSentPerSecond.confidenceInterval95
			.map((v) => (v / 1024).toFixed(2))
			.join(", ");

		const cpuAvg = summary.serverMetrics.cpu.avg.toFixed(3);
		const cpuStdDev = summary.serverMetrics.cpu.stdDev.toFixed(3);
		const cpuMaxAvg = summary.serverMetrics.cpuMax.avg.toFixed(3);
		const cpuMaxStdDev = summary.serverMetrics.cpuMax.stdDev.toFixed(3);
		const cpuCV = summary.serverMetrics.cpu.coefficientOfVariation.toFixed(1);
		const cpuCI = summary.serverMetrics.cpu.confidenceInterval95
			.map((v) => v.toFixed(2))
			.join(", ");
		const memAvg = summary.serverMetrics.memory.avg.toFixed(1);
		const memStdDev = summary.serverMetrics.memory.stdDev.toFixed(1);
		const memMaxAvg = summary.serverMetrics.memoryMax.avg.toFixed(1);
		const memMaxStdDev = summary.serverMetrics.memoryMax.stdDev.toFixed(1);
		const memCV =
			summary.serverMetrics.memory.coefficientOfVariation.toFixed(1);
		const memCI = summary.serverMetrics.memory.confidenceInterval95
			.map((v) => v.toFixed(1))
			.join(", ");

		console.log("\n📊 BENCHMARK SUMMARY");
		console.log("=".repeat(50));
		console.log(`Suite ID: ${this._suiteId}`);
		console.log(`Total Runs: ${this._suite.totalRuns}`);
		console.log(`Duration: ${durationMs}ms`);

		console.log("\n📡 THROUGHPUT:");
		console.log(`  Avg Received: ${avgReceivedKBps} KB/s`);
		console.log(`  Avg Received Per Run: ${totalReceivedKB} KB`);
		console.log(
			`  Received Variability: CV=${receivedCV}% CI95=[${receivedCI}] KB/run`,
		);
		console.log(`  Avg Sent: ${avgSentKBps} KB/s`);
		console.log(`  Avg Sent Per Run: ${totalSentKB} KB`);
		console.log(`  Sent Variability: CV=${sentCV}% CI95=[${sentCI}] KB/run`);

		console.log("\n🖥️  SERVER:");
		console.log(`  CPU (avg): ${cpuAvg}% (±${cpuStdDev}%)`);
		console.log(`  CPU (max): ${cpuMaxAvg}% (±${cpuMaxStdDev}%)`);
		console.log(`  CPU Variability: CV=${cpuCV}% CI95=[${cpuCI}]%`);
		console.log(`  Memory (avg): ${memAvg} MB (±${memStdDev} MB)`);
		console.log(`  Memory (max): ${memMaxAvg} MB (±${memMaxStdDev} MB)`);
		console.log(`  Memory Variability: CV=${memCV}% CI95=[${memCI}] MB`);

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

		console.log("  By Operation:");
		console.table(
			Object.entries(summary.latency.byOperation).map(([operation, stats]) => ({
				Operation: operation,
				"Avg (ms)": stats.avg.toFixed(2),
				"P95 (ms)": stats.p95.toFixed(2),
				"CV (%)": stats.coefficientOfVariation.toFixed(1),
			})),
		);
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

	public getPerRunStats(): PerRunStats[] {
		return this._generatePerRunStats();
	}
}

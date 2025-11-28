import type { MetricsData } from "../types";

export interface LatencyByRun {
	[runId: string]: {
		latencies: number[];
		mins: number[];
		maxs: number[];
		byOperation: Record<
			string,
			{ latencies: number[]; mins: number[]; maxs: number[] }
		>;
	};
}

export interface BenchmarkConfig {
	clientCount: number;
}

export interface BenchmarkRun {
	runId: string;
	runIndex: number;
	startTime: string;
	startTimeMs: number;
	endTime?: string;
	endTimeMs?: number;
	duration?: number;
	config: BenchmarkConfig;
	events?: ScenarioEvent[];
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
	relativeTimestamp: number;
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
	bytesReceivedPerSecond: MetricsSummary;
	bytesSentPerSecond: MetricsSummary;
	totalBytesReceived: number;
	totalBytesSent: number;
	avgBytesReceivedPerRun: number;
	avgBytesSentPerRun: number;
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
	cpuMax: MetricsSummary;
	memory: MetricsSummary;
	memoryMax: MetricsSummary;
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

export interface ScenarioEvent {
	timestamp: number;
	timestampMs: number;
	event: string;
	details?: Record<string, unknown>;
}

export interface PerRunStats {
	runIndex: number;
	runId: string;
	startTimeMs: number;
	endTimeMs: number;
	duration: number;
	events: ScenarioEvent[];
	throughput: {
		bytesReceived: number;
		bytesSent: number;
	};
	latency: {
		avg: number;
		p95: number;
		p99: number;
		byOperation: Record<string, { avg: number; p95: number; p99: number }>;
	};
	server: {
		avgCpu: number;
		maxCpu: number;
		avgMemory: number;
		maxMemory: number;
	};
}

export interface TTestResult {
	metric: string;
	group1Mean: number;
	group1StdDev: number;
	group2Mean: number;
	group2StdDev: number;
	difference: number;
	percentDifference: number;
	tStatistic: number;
	pValue: number;
	significant: boolean;
	cohensD: number;
}

export interface StatisticalComparison {
	group1Label: string;
	group2Label: string;
	group1Size: number;
	group2Size: number;
	alphaLevel: number;
	bonferroniCorrected: boolean;
	results: TTestResult[];
}

export interface BenchmarkResults {
	metadata: BenchmarkSuite;
	rawData: RunMetricsData[];
	summary: BenchmarkSummary;
	perRunStats: PerRunStats[];
	comparison?: StatisticalComparison;
}

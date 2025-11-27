import {
	cumulativeStdNormalProbability,
	mean,
	sampleStandardDeviation,
	tTestTwoSample,
} from "simple-statistics";
import type { PerRunStats, StatisticalComparison, TTestResult } from "./types";

export function compareResults(
	group1Stats: PerRunStats[],
	group2Stats: PerRunStats[],
	group1Label: string = "Group 1",
	group2Label: string = "Group 2",
	alphaLevel: number = 0.05,
	bonferroniCorrection: boolean = true,
): StatisticalComparison {
	const metrics = [
		{
			name: "Latency (avg)",
			extract: (stats: PerRunStats) => stats.latency.avg,
		},
		{
			name: "Latency (p95)",
			extract: (stats: PerRunStats) => stats.latency.p95,
		},
		{
			name: "CPU (avg)",
			extract: (stats: PerRunStats) => stats.server.avgCpu,
		},
		{
			name: "CPU (max)",
			extract: (stats: PerRunStats) => stats.server.maxCpu,
		},
		{
			name: "Memory (avg)",
			extract: (stats: PerRunStats) => stats.server.avgMemory,
		},
		{
			name: "Memory (max)",
			extract: (stats: PerRunStats) => stats.server.maxMemory,
		},
	];

	const correctedAlpha = bonferroniCorrection
		? alphaLevel / metrics.length
		: alphaLevel;

	const results = metrics.map((metric) => {
		const sample1 = group1Stats.map(metric.extract);
		const sample2 = group2Stats.map(metric.extract);

		const mean1 = mean(sample1);
		const mean2 = mean(sample2);
		const stdDev1 = sampleStandardDeviation(sample1);
		const stdDev2 = sampleStandardDeviation(sample2);

		const difference = mean1 - mean2;
		const percentDifference = mean2 !== 0 ? (difference / mean2) * 100 : 0;

		const tStatistic = tTestTwoSample(sample1, sample2, 0) ?? 0;
		const absTStat = Math.abs(tStatistic);
		const pValue = 2 * (1 - cumulativeStdNormalProbability(absTStat));

		const pooledStd = Math.sqrt((stdDev1 ** 2 + stdDev2 ** 2) / 2);
		const cohensD = pooledStd !== 0 ? difference / pooledStd : 0;

		const significant = pValue < correctedAlpha;

		return {
			metric: metric.name,
			group1Mean: mean1,
			group1StdDev: stdDev1,
			group2Mean: mean2,
			group2StdDev: stdDev2,
			difference,
			percentDifference,
			tStatistic,
			pValue,
			significant,
			cohensD,
		} as TTestResult;
	});

	return {
		group1Label,
		group2Label,
		group1Size: group1Stats.length,
		group2Size: group2Stats.length,
		alphaLevel: correctedAlpha,
		bonferroniCorrected: bonferroniCorrection,
		results,
	};
}

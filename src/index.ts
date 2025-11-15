import { logger } from "./logger";

import {
	runViewportDisabledBenchmark,
	runViewportEnabledBenchmark,
} from "./marks/viewport-comparison";
import { BenchmarkCollector, type BenchmarkConfig } from "./runner/collector";

const log = logger.misc;

async function main() {
	const config: BenchmarkConfig = {
		clientCount: 4,
	};

	await runViewportComparisonBenchmark(config);
}

async function runViewportComparisonBenchmark(config: BenchmarkConfig) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

	console.log("🔬 Starting Viewport Filtering Comparison Benchmark");
	console.log("=".repeat(50));

	log.info("\n ✅ Running with viewport filtering ENABLED");
	const collectorWithFiltering = new BenchmarkCollector(config);

	collectorWithFiltering.startRun(1);
	try {
		await runViewportEnabledBenchmark(collectorWithFiltering);
		log.info("✅ Viewport filtering enabled benchmark completed");
	} catch (error) {
		log.error("🚨 Viewport filtering enabled benchmark failed:", error);
	} finally {
		collectorWithFiltering.endRun();
	}

	const filenameWithFiltering = `results/viewport-enabled-${timestamp}.json`;
	await collectorWithFiltering.saveResults(filenameWithFiltering);

	log.info("❄️  Cooling down between benchmarks...");
	await new Promise((resolve) => setTimeout(resolve, 2000));

	log.info("\n🚫 Running with viewport filtering DISABLED");
	const collectorWithoutFiltering = new BenchmarkCollector(config);

	collectorWithoutFiltering.startRun(1);
	try {
		await runViewportDisabledBenchmark(collectorWithoutFiltering);
		log.info("✅ Viewport filtering disabled benchmark completed");
	} catch (error) {
		log.error("🚨 Viewport filtering disabled benchmark failed:", error);
	} finally {
		collectorWithoutFiltering.endRun();
	}

	const filenameWithoutFiltering = `results/viewport-disabled-${timestamp}.json`;
	await collectorWithoutFiltering.saveResults(filenameWithoutFiltering);

	console.log("\n📊 VIEWPORT FILTERING COMPARISON RESULTS");
	console.log("=".repeat(50));

	console.log("\n🟢 WITH Viewport Filtering:");
	collectorWithFiltering.printSummary();

	console.log("\n🔴 WITHOUT Viewport Filtering:");
	collectorWithoutFiltering.printSummary();
}

main();

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

	const args = process.argv.slice(2);
	let iterations = 30;

	const iterationsArg = args.find(
		(arg) => arg.startsWith("--iterations=") || arg.startsWith("-i="),
	);
	if (iterationsArg) {
		const value = parseInt(iterationsArg.split("=")[1], 10);
		if (value > 0) {
			iterations = value;
		}
	}

	await runViewportComparisonBenchmark(config, iterations);
}

async function runViewportComparisonBenchmark(
	config: BenchmarkConfig,
	iterations: number,
) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

	console.log("🔬 Starting Viewport Filtering Comparison Benchmark");
	console.log("=".repeat(50));

	log.info("\n ✅ Running with viewport filtering ENABLED");
	const collectorWithFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`\n🏃 Starting iteration ${i}/${iterations} (viewport enabled)`);

		collectorWithFiltering.startRun(i);
		try {
			await runViewportEnabledBenchmark(collectorWithFiltering);
			log.info(`✅ Iteration ${i}/${iterations} completed (viewport enabled)`);
		} catch (error) {
			log.error(
				`🚨 Iteration ${i}/${iterations} failed (viewport enabled):`,
				error,
			);
		} finally {
			collectorWithFiltering.endRun();
		}

		if (i < iterations) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	const filenameWithFiltering = `results/viewport-enabled-${timestamp}.json`;
	await collectorWithFiltering.saveResults(filenameWithFiltering);

	log.info("❄️  Cooling down between benchmark variants...");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	log.info("\n🚫 Running with viewport filtering DISABLED");
	const collectorWithoutFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`\n🏃 Starting iteration ${i}/${iterations} (viewport disabled)`);

		collectorWithoutFiltering.startRun(i);
		try {
			await runViewportDisabledBenchmark(collectorWithoutFiltering);
			log.info(`✅ Iteration ${i}/${iterations} completed (viewport disabled)`);
		} catch (error) {
			log.error(
				`🚨 Iteration ${i}/${iterations} failed (viewport disabled):`,
				error,
			);
		} finally {
			collectorWithoutFiltering.endRun();
		}

		if (i < iterations) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
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

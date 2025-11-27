import { Settings } from "./env";
import { logger } from "./logger";
import { runScenario, type ScenarioKey, scenarios } from "./marks/scenarios";
import { BenchmarkCollector } from "./runner/collector";
import { compareResults } from "./runner/stats";
import type { BenchmarkConfig } from "./runner/types";
import { initializeRandom } from "./utils/seededRandom";

const log = logger.misc;

async function main() {
	const config: BenchmarkConfig = {
		clientCount: 4,
	};

	const args = process.argv.slice(2);
	let iterations = 50;
	let scenarioName = "average";

	const iterationsArg = args.find(
		(arg) => arg.startsWith("--iterations=") || arg.startsWith("-i="),
	);
	if (iterationsArg) {
		const value = parseInt(iterationsArg.split("=")[1], 10);
		if (value > 0) {
			iterations = value;
		}
	}

	const scenarioArg = args.find(
		(arg) => arg.startsWith("--scenario=") || arg.startsWith("-s="),
	);
	if (scenarioArg) {
		scenarioName = scenarioArg.split("=")[1];
	}

	if (args.length > 0 && !args[0].startsWith("-")) {
		scenarioName = args[0];
	}

	await runScenarioBenchmark(config, iterations, scenarioName);
}

async function runScenarioBenchmark(
	config: BenchmarkConfig,
	iterations: number,
	scenarioName: string,
) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

	if (!(scenarioName in scenarios)) {
		console.error(`Unknown scenario: ${scenarioName}`);
		console.log(`Available scenarios: ${Object.keys(scenarios).join(", ")}`);
		process.exit(1);
	}

	const scenario = scenarios[scenarioName as ScenarioKey];
	const displayName = scenario.name;

	console.log(`🔬 Starting ${displayName} Scenario Benchmark`);
	console.log("=".repeat(50));

	const seed = 42;
	initializeRandom(seed);
	process.env.RANDOM_SEED = String(seed);

	console.log("\n🔥 Warming up...");
	const warmupIterations = Settings.isDebugMode ? 2 : 30;
	for (let i = 0; i < warmupIterations; i++) {
		await runScenario(scenarioName as ScenarioKey, null, true);
	}
	console.log("✅ Warmup complete\n");

	log.info("✅ Running with viewport filtering ENABLED");
	const collectorWithFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`🏃 Starting iteration ${i}/${iterations} (viewport enabled)`);

		Bun.gc(true);

		collectorWithFiltering.startRun(i);
		try {
			await runScenario(
				scenarioName as ScenarioKey,
				collectorWithFiltering,
				true,
			);
			log.info(`✅ Iteration ${i}/${iterations} completed (viewport enabled)`);
		} catch (error) {
			log.error(
				`🚨 Iteration ${i}/${iterations} failed (filtering enabled):`,
				error,
			);
		} finally {
			collectorWithFiltering.endRun();
		}

		if (i < iterations) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	collectorWithFiltering.completeSuite();

	log.info("❄️  Cooling down between benchmark variants...");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	log.info("🚫 Running with viewport filtering DISABLED");
	const collectorWithoutFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`🏃 Starting iteration ${i}/${iterations} (filtering disabled)`);

		Bun.gc(true);

		collectorWithoutFiltering.startRun(i);
		try {
			await runScenario(
				scenarioName as ScenarioKey,
				collectorWithoutFiltering,
				false,
			);
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

	console.log(`\n📊 ${displayName.toUpperCase()} SCENARIO RESULTS`);
	console.log("=".repeat(50));

	collectorWithoutFiltering.completeSuite();

	console.log("\n🟢 WITH Viewport Filtering:");
	collectorWithFiltering.printSummary();

	console.log("\n🔴 WITHOUT Viewport Filtering:");
	collectorWithoutFiltering.printSummary();

	const comparison = compareResults(
		collectorWithFiltering.getPerRunStats(),
		collectorWithoutFiltering.getPerRunStats(),
		"WITH Filtering",
		"WITHOUT Filtering",
	);

	const filenameWithFiltering = `results/${scenarioName}-enabled-${timestamp}.json`;
	const filenameWithoutFiltering = `results/${scenarioName}-disabled-${timestamp}.json`;

	await collectorWithFiltering.saveResults(filenameWithFiltering, comparison);
	await collectorWithoutFiltering.saveResults(
		filenameWithoutFiltering,
		comparison,
	);
}

main();

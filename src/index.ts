import { logger } from "./logger";
import { runScenario, type ScenarioKey, scenarios } from "./marks/scenarios";
import { BenchmarkCollector, type BenchmarkConfig } from "./runner/collector";

const log = logger.misc;

async function main() {
	const config: BenchmarkConfig = {
		clientCount: 4,
	};

	const args = process.argv.slice(2);
	let iterations = 30;
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

	log.info("✅ Running with viewport filtering ENABLED");
	const collectorWithFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`🏃 Starting iteration ${i}/${iterations} (viewport enabled)`);

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

	const filenameWithFiltering = `results/${scenarioName}-enabled-${timestamp}.json`;
	await collectorWithFiltering.saveResults(filenameWithFiltering);

	log.info("❄️  Cooling down between benchmark variants...");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	log.info("🚫 Running with viewport filtering DISABLED");
	const collectorWithoutFiltering = new BenchmarkCollector(config);

	for (let i = 1; i <= iterations; i++) {
		log.info(`🏃 Starting iteration ${i}/${iterations} (viewport disabled)`);

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

	const filenameWithoutFiltering = `results/${scenarioName}-disabled-${timestamp}.json`;
	await collectorWithoutFiltering.saveResults(filenameWithoutFiltering);

	console.log(`\n📊 ${displayName.toUpperCase()} SCENARIO RESULTS`);
	console.log("=".repeat(50));

	console.log("\n🟢 WITH Viewport Filtering:");
	collectorWithFiltering.printSummary();

	console.log("\n🔴 WITHOUT Viewport Filtering:");
	collectorWithoutFiltering.printSummary();
}

main();

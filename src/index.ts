import { logger } from "./logger";
import { ProcessRunner } from "./runner";

const log = logger.misc;

async function main() {
	const startTime = Date.now();
	const runner = new ProcessRunner();

	try {
		await runner.startServer();

		await runner.wait();

		await runner.startClients(2);

		await runner.client(1).ping();
		await runner.client(2).ping();

		await runner.wait();

		await runner.client(1).moveWindow({ x: 100, y: 100 });
		await runner.client(2).moveWindow({ x: 200, y: 200 });

		for (let i = 0; i < 5; i++) {
			await runner.wait();
			await runner.client(1).addRandomShapeInViewport();
			await runner.wait();
			await runner.client(2).addRandomShapeInViewport();
		}

		await runner.client(1).moveWindow({ x: 200, y: 200 });
		await runner.client(2).moveWindow({ x: 100, y: 100 });

		await runner.waitForAllProcesses();
		await runner.stopAll();

		const endTime = Date.now();
		const duration = endTime - startTime;
		log.info(
			`✅ Benchmarks completed successfully! Total time: ${duration}ms (${(duration / 1000).toFixed(2)}s)`,
		);
	} catch (error) {
		console.error("Error running processes:", error);
		await runner.stopAll();
		process.exit(1);
	}
}

main();

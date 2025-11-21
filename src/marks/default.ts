import type { BenchmarkCollector } from "../runner/collector";
import { ProcessRunner } from "../runner/runner";

export async function runDefaultBenchmark(
	collector: BenchmarkCollector,
): Promise<void> {
	const runner = new ProcessRunner();

	runner.setCollector(collector);

	try {
		await runner.startServer();
		await runner.wait();

		await runner.startClients(2);
		await runner.wait();

		await runner.client(1).ping();
		await runner.client(2).ping();
		await runner.wait();

		await runner.client(1).moveWindow({ x: 100, y: 100 });
		await runner.client(2).moveWindow({ x: 300, y: 300 });

		for (let i = 0; i < 5000; i++) {
			await runner.wait();
			await runner.client(1).createShapeInViewport();
			await runner.wait();
			await runner.client(2).createShapeInViewport();
		}

		await runner.client(1).moveWindow({ x: 200, y: 200 });
		await runner.client(2).moveWindow({ x: 100, y: 100 });

		await runner.waitForAllProcesses();
		await runner.stopAll();
	} catch (error) {
		await runner.stopAll();
		throw error;
	}
}

import type { BenchmarkCollector } from "../runner/collector";
import { ProcessRunner } from "../runner/runner";
import { seededRandom } from "../utils/seededRandom.js";

export async function runViewportFilteringBenchmark(
	collector: BenchmarkCollector,
	enableViewportFiltering: boolean,
): Promise<void> {
	const runner = new ProcessRunner();

	runner.setCollector(collector);
	runner.setServerConfig({ enableViewportFiltering });

	try {
		await runner.startServer();
		await runner.wait();

		await new Promise((resolve) => setTimeout(resolve, 1000));

		await runner.startClients(4);
		await runner.wait();

		await new Promise((resolve) => setTimeout(resolve, 500));

		await runner.client(1).moveWindow({ x: 0, y: 0 });
		await runner.client(2).moveWindow({ x: 500, y: 0 });
		await runner.client(3).moveWindow({ x: 0, y: 500 });
		await runner.client(4).moveWindow({ x: 500, y: 500 });
		await runner.wait();

		for (let i = 0; i < 1000; i++) {
			await runner.wait();

			await runner.client(1).createShapeInViewport();
			await runner.wait();
			await runner.client(2).createShapeInViewport();
			await runner.wait();
			await runner.client(3).createShapeInViewport();
			await runner.wait();
			await runner.client(4).createShapeInViewport();
		}

		await runner.client(1).moveWindow({ x: 250, y: 250 });
		await runner.client(2).moveWindow({ x: 200, y: 200 });
		await runner.client(3).moveWindow({ x: 300, y: 300 });
		await runner.client(4).moveWindow({ x: 100, y: 100 });
		await runner.wait();

		for (let i = 0; i < 500; i++) {
			await runner.wait();
			await runner.client(1).createShapeInViewport();
			await runner.wait();
			await runner.client(2).createShapeInViewport();
			await runner.wait();
			await runner.client(3).createShapeInViewport();
			await runner.wait();
			await runner.client(4).createShapeInViewport();
		}

		for (let i = 0; i < 100; i++) {
			const clientId = (i % 4) + 1;
			await runner.wait();
			await runner.client(clientId).moveWindow({
				x: seededRandom() * 600,
				y: seededRandom() * 600,
			});
		}

		await runner.waitForAllProcesses();
		await runner.stopAll();
	} catch (error) {
		await runner.stopAll();
		throw error;
	}
}

export async function runViewportEnabledBenchmark(
	collector: BenchmarkCollector,
): Promise<void> {
	return runViewportFilteringBenchmark(collector, true);
}

export async function runViewportDisabledBenchmark(
	collector: BenchmarkCollector,
): Promise<void> {
	return runViewportFilteringBenchmark(collector, false);
}

import { Settings } from "../env";
import type { BenchmarkCollector } from "../runner/collector";
import { ProcessRunner } from "../runner/runner";
import { seededRandom } from "../utils/seededRandom";

const shapeCountMultiplier = Settings.isDebugMode ? 1 : 100;

/**
 * Complete Overlap
 * All clients remain in the same viewport space throughout the benchmark.
 */
export async function runCompleteOverlapScenario(
	collector: BenchmarkCollector,
	enableViewportFiltering: boolean,
): Promise<void> {
	const runner = new ProcessRunner();

	runner.setCollector(collector);
	runner.setServerConfig({ enableViewportFiltering });

	try {
		await runner.startServer();
		await runner.waitForServerReady();

		await runner.startClients(4);
		await runner.waitForAllClientsReady();

		// All clients move to the same viewport area
		const sharedLocation = { x: 200, y: 200 };

		await runner.client(1).moveWindow(sharedLocation);
		await runner.client(2).moveWindow(sharedLocation);
		await runner.client(3).moveWindow(sharedLocation);
		await runner.client(4).moveWindow(sharedLocation);
		await runner.wait();

		// All clients create shapes in the same overlapping space
		for (let i = 0; i < 5 * shapeCountMultiplier; i++) {
			await runner.client(1).createShapeInViewport();
			await runner.client(2).createShapeInViewport();
			await runner.client(3).createShapeInViewport();
			await runner.client(4).createShapeInViewport();
		}

		// Continue adding shapes in the shared space
		for (let i = 0; i < 2 * shapeCountMultiplier; i++) {
			const clientId = (i % 4) + 1;
			await runner.client(clientId).createShapeInViewport();
			await runner.wait();
		}

		await runner.waitForAllProcesses();
		await runner.stopAll();
	} catch (error) {
		await runner.stopAll();
		throw error;
	}
}

/**
 * No Overlap
 * All client viewports are completely separate with no overlap.
 */
export async function runNoOverlapScenario(
	collector: BenchmarkCollector,
	enableViewportFiltering: boolean,
): Promise<void> {
	const runner = new ProcessRunner();

	runner.setCollector(collector);
	runner.setServerConfig({ enableViewportFiltering });

	try {
		await runner.startServer();
		await runner.waitForServerReady();

		await runner.startClients(4);
		await runner.waitForAllClientsReady();

		// Position clients in completely separate areas
		await runner.client(1).moveWindow({ x: 0, y: 0 });
		await runner.client(2).moveWindow({ x: 900, y: 0 });
		await runner.client(3).moveWindow({ x: 0, y: 600 });
		await runner.client(4).moveWindow({ x: 900, y: 600 });
		await runner.wait();

		// Each client creates shapes in their isolated viewports
		for (let i = 0; i < 5 * shapeCountMultiplier; i++) {
			await runner.client(1).createShapeInViewport();
			await runner.wait();
			await runner.client(2).createShapeInViewport();
			await runner.wait();
			await runner.client(3).createShapeInViewport();
			await runner.wait();
			await runner.client(4).createShapeInViewport();
			await runner.wait();
		}

		await runner.waitForAllProcesses();
		await runner.stopAll();
	} catch (error) {
		await runner.stopAll();
		throw error;
	}
}

/**
 * Average Use Case
 * Clients start in separate corners, create objects in isolation,
 * then move existing shapes to center where all viewports converge.
 */
export async function runAverageUseCaseScenario(
	collector: BenchmarkCollector,
	enableViewportFiltering: boolean,
): Promise<void> {
	const runner = new ProcessRunner();

	runner.setCollector(collector);
	runner.setServerConfig({ enableViewportFiltering });

	const createdShapes: { [clientId: number]: string[] } = {
		1: [],
		2: [],
		3: [],
		4: [],
	};

	try {
		await runner.startServer();
		await runner.waitForServerReady();

		await runner.startClients(4);
		await runner.waitForAllClientsReady();

		// Phase 1: Move clients to separate corners of the canvas
		await runner.client(1).moveWindow({ x: 0, y: 0 });
		await runner.client(2).moveWindow({ x: 900, y: 0 });
		await runner.client(3).moveWindow({ x: 0, y: 600 });
		await runner.client(4).moveWindow({ x: 900, y: 600 });
		await runner.wait();

		// Create objects in isolation in each corner
		for (let i = 0; i < 15 * shapeCountMultiplier; i++) {
			const clientId = (i % 4) + 1;

			const result = await runner.client(clientId).createShapeInViewport();

			createdShapes[clientId].push(result.shapeId);
			await runner.wait();
		}

		// Move existing shapes to center
		const centerX = 600;
		const centerY = 400;

		for (let clientId = 1; clientId <= 4; clientId++) {
			const shapesToMove = createdShapes[clientId].slice(
				0,
				5 * shapeCountMultiplier,
			);

			for (let i = 0; i < shapesToMove.length; i++) {
				const shape = shapesToMove[i];
				const newX = centerX + (seededRandom() - 0.5) * 200;
				const newY = centerY + (seededRandom() - 0.5) * 200;

				await runner.client(clientId).moveShape(shape, newX, newY);
				await runner.wait();
			}
		}

		await runner.client(1).moveWindow({
			x: centerX - 150,
			y: centerY - 100,
		});
		await runner.wait();
		await runner.client(2).moveWindow({
			x: centerX - 150,
			y: centerY - 100,
		});
		await runner.wait();
		await runner.client(3).moveWindow({
			x: centerX - 150,
			y: centerY - 100,
		});
		await runner.wait();
		await runner.client(4).moveWindow({
			x: centerX - 150,
			y: centerY - 100,
		});
		await runner.wait();

		for (let i = 0; i < 10 * shapeCountMultiplier; i++) {
			const clientId = (i % 4) + 1;
			await runner.client(clientId).createShapeInViewport();
			await runner.wait();
		}

		await runner.waitForAllProcesses();
		await runner.stopAll();
	} catch (error) {
		await runner.stopAll();
		throw error;
	}
}

export const scenarios = {
	overlap: {
		name: "Complete Overlap",
		run: runCompleteOverlapScenario,
	},
	separate: {
		name: "No Overlap",
		run: runNoOverlapScenario,
	},
	average: {
		name: "Average Use Case",
		run: runAverageUseCaseScenario,
	},
} as const;

export type ScenarioKey = keyof typeof scenarios;

export function runScenario(
	scenarioKey: ScenarioKey,
	collector: BenchmarkCollector,
	enableFiltering: boolean,
): Promise<void> {
	return scenarios[scenarioKey].run(collector, enableFiltering);
}

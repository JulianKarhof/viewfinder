import { ProcessRunner } from "./runner";

async function main() {
	const runner = new ProcessRunner({
		maxConcurrentProcesses: 10,
	});

	try {
		await runner.startServer();

		await new Promise((resolve) => setTimeout(resolve, 2000));

		await runner.startVisualizer();
		await runner.startClients(1);

		await runner.sendPing("client-1");
		for (let i = 1; i < 10; i++) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await runner.sendPing("client-1");
		}

		await runner.waitForAllProcesses();
	} catch (error) {
		console.error("Error running processes:", error);
		await runner.stopAll();
		process.exit(1);
	}
}

main();

import { ProcessRunner } from "./runner";

async function main() {
	const runner = new ProcessRunner();

	try {
		await runner.startServer();

		await runner.wait(1000);

		await runner.startClients(2);

		await runner.sendPing("client-1");
		await runner.sendPing("client-2");

		await runner.wait(1000);

		await runner.sendCommand("client-1", {
			type: "moveWindow",
			location: { x: 100, y: 100 },
		});

		await runner.sendCommand("client-2", {
			type: "moveWindow",
			location: { x: 200, y: 200 },
		});

		for (let i = 1; i < 100; i++) {
			await runner.wait(1000);
			await runner.sendCommand("client-1", {
				type: "sendAction",
				action: {
					shape: {
						id: `shape-${i}`,
						type: "circle",
						x: Math.floor(Math.random() * 1200),
						y: Math.floor(Math.random() * 800),
						radius: 10,
						color: "red",
					},
					timestamp: Date.now(),
					type: "addShape",
				},
			});
			await runner.wait(1000);
			await runner.sendCommand("client-2", {
				type: "sendAction",
				action: {
					shape: {
						id: `shape-${i}`,
						type: "circle",
						x: Math.floor(Math.random() * 1200),
						y: Math.floor(Math.random() * 800),
						radius: 10,
						color: "blue",
					},
					timestamp: Date.now(),
					type: "addShape",
				},
			});
		}

		await runner.sendCommand("client-1", {
			type: "moveWindow",
			location: { x: 300, y: 300 },
		});

		await runner.sendCommand("client-2", {
			type: "moveWindow",
			location: { x: 240, y: 210 },
		});

		await runner.waitForAllProcesses();
	} catch (error) {
		console.error("Error running processes:", error);
		await runner.stopAll();
		process.exit(1);
	}
}

main();

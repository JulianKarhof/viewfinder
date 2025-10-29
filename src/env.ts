class SettingsSingleton {
	private static instance: SettingsSingleton | null = null;

	public readonly isDebugMode: boolean;
	public readonly waitTime: number;

	private constructor() {
		this.isDebugMode =
			process.env.DEBUG === "true" || process.argv.includes("--debug");
		this.waitTime = this.isDebugMode ? 1000 : 0;

		if (this.isDebugMode && !process.env.CLIENT_ID) {
			console.log(`\n ${"=".repeat(60)}`);
			console.log("🐛 DEBUG MODE ENABLED");
			console.log("Remove debug flag for benchmarking!!");
			console.log(`${"=".repeat(60)} \n`);
		}
	}

	public static getInstance(): SettingsSingleton {
		if (SettingsSingleton.instance === null) {
			SettingsSingleton.instance = new SettingsSingleton();
		}
		return SettingsSingleton.instance;
	}
}

export const Settings = SettingsSingleton.getInstance();

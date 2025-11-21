class SettingsSingleton {
	private static _instance: SettingsSingleton | null = null;

	public readonly isDebugMode: boolean;
	public readonly waitTime: number;
	public readonly logLevel: "debug" | "info" | "warn" | "error" = "info";
	public readonly canvasWidth: number = 1200;
	public readonly canvasHeight: number = 800;

	private constructor() {
		this.isDebugMode =
			process.env.DEBUG === "true" || process.argv.includes("--debug");
		this.waitTime = this.isDebugMode ? 500 : 0;
		this.logLevel = this.isDebugMode ? "debug" : "info";

		if (this.isDebugMode && !process.env.IS_CLIENT && !process.env.IS_SERVER) {
			console.log(`\n ${"=".repeat(50)}`);
			console.log("🐛 DEBUG MODE ENABLED");
			console.log("Remove debug flag for benchmarking!!");
			console.log(`${"=".repeat(50)} \n`);
		}
	}

	public static getInstance(): SettingsSingleton {
		if (SettingsSingleton._instance === null) {
			SettingsSingleton._instance = new SettingsSingleton();
		}
		return SettingsSingleton._instance;
	}
}

export const Settings = SettingsSingleton.getInstance();

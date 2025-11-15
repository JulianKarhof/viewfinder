export class SeededRandom {
	private _seed: number;

	public constructor(seed: number) {
		this._seed = seed;
	}

	public next(): number {
		this._seed = (this._seed * 1664525 + 1013904223) % 4294967296;
		return this._seed / 4294967296;
	}

	public nextInt(min: number, max: number): number {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}

	public nextFloat(min: number, max: number): number {
		return this.next() * (max - min) + min;
	}

	public reset(newSeed?: number): void {
		this._seed = newSeed ?? this._seed;
	}
}

let globalRandom: SeededRandom | null = null;

export function initializeRandom(seed: number): void {
	globalRandom = new SeededRandom(seed);
}

export function seededRandom(): number {
	if (!globalRandom) {
		throw new Error(
			"Seeded random not initialized. Call initializeRandom() first.",
		);
	}
	return globalRandom.next();
}

export function seededRandomInt(min: number, max: number): number {
	if (!globalRandom) {
		throw new Error(
			"Seeded random not initialized. Call initializeRandom() first.",
		);
	}
	return globalRandom.nextInt(min, max);
}

export function seededRandomFloat(min: number, max: number): number {
	if (!globalRandom) {
		throw new Error(
			"Seeded random not initialized. Call initializeRandom() first.",
		);
	}
	return globalRandom.nextFloat(min, max);
}

export function resetSeed(seed?: number): void {
	if (!globalRandom) {
		throw new Error(
			"Seeded random not initialized. Call initializeRandom() first.",
		);
	}
	globalRandom.reset(seed);
}

export class Mutex {
	private _locked = false;
	private _waitQueue: Array<() => void> = [];

	public async acquire(): Promise<void> {
		return new Promise((resolve) => {
			if (!this._locked) {
				this._locked = true;
				resolve();
			} else {
				this._waitQueue.push(resolve);
			}
		});
	}

	public release(): void {
		if (this._waitQueue.length > 0) {
			const resolve = this._waitQueue.shift();
			if (resolve) {
				resolve();
			}
		} else {
			this._locked = false;
		}
	}

	public async runExclusive<T>(callback: () => T | Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await callback();
		} finally {
			this.release();
		}
	}

	public isLocked(): boolean {
		return this._locked;
	}

	public getWaitQueueLength(): number {
		return this._waitQueue.length;
	}
}

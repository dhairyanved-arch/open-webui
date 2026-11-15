/**
 * Deterministic pseudo-random toolkit shared by every simulator in the terminal.
 * mulberry32 is small, fast and has good enough equidistribution for Monte Carlo
 * at the 10^4–10^6 draw scale used here.
 */
export class Rng {
	private state: number;
	private spare: number | null = null;

	constructor(seed: number) {
		this.state = seed >>> 0 || 0x9e3779b9;
	}

	/** Uniform in [0, 1). */
	next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform in [lo, hi). */
	range(lo: number, hi: number): number {
		return lo + (hi - lo) * this.next();
	}

	/** Integer in [lo, hi] inclusive. */
	int(lo: number, hi: number): number {
		return Math.floor(this.range(lo, hi + 1));
	}

	/** Standard normal via Marsaglia polar method (caches the spare deviate). */
	gauss(): number {
		if (this.spare !== null) {
			const s = this.spare;
			this.spare = null;
			return s;
		}
		let u = 0;
		let v = 0;
		let s = 0;
		do {
			u = this.next() * 2 - 1;
			v = this.next() * 2 - 1;
			s = u * u + v * v;
		} while (s >= 1 || s === 0);
		const m = Math.sqrt((-2 * Math.log(s)) / s);
		this.spare = v * m;
		return u * m;
	}

	normal(mean: number, sd: number): number {
		return mean + sd * this.gauss();
	}

	/** Log-normal with the given median and log-space sigma. */
	logNormal(median: number, sigma: number): number {
		return median * Math.exp(sigma * this.gauss());
	}

	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.floor(this.next() * items.length)];
	}
}

/** Stable 32-bit hash for deriving per-entity seeds from strings. */
export function hashString(input: string): number {
	let h = 2166136261;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

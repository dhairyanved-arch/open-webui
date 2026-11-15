import { blackScholes, smileVol, type Greeks, type OptionType, type SmileParams } from './blackScholes';

/* Surface domain: strike on X, days-to-expiry on Z, the chosen metric on Y. */

export type SurfaceMetric = 'value' | 'iv' | 'delta' | 'gamma' | 'vega' | 'theta';

export interface SurfaceParams extends SmileParams {
	/** Underlying price right now. */
	spot: number;
	/** Reference level that fixes the strike axis (the desk's opening spot). */
	refSpot: number;
	riskFree: number;
	/** Calendar days of theta decay applied to every expiry. */
	daysElapsed: number;
	optionType: OptionType;
}

export const STRIKE_RANGE: [number, number] = [0.72, 1.28];
export const EXPIRY_RANGE_DAYS: [number, number] = [2, 120];
export const GRID_STRIKES = 73;
export const GRID_EXPIRIES = 49;

/** Scene extents. */
export const SCENE = { halfX: 5.2, halfZ: 3.9, height: 3.5 };

export interface MetricSpec {
	label: string;
	unit: string;
	/** True when the metric can be negative — drawn around a mid-height zero plane. */
	signed: (type: OptionType) => boolean;
	/** Raw metric value for one grid point. */
	raw: (g: Greeks, sigma: number) => number;
	/** Value that maps to full height. */
	full: (refSpot: number) => number;
	/** Compress extreme values smoothly instead of clipping (gamma/theta near expiry). */
	soft: boolean;
	format: (v: number) => string;
}

const fmt = (digits: number) => (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const METRICS: Record<SurfaceMetric, MetricSpec> = {
	value: {
		label: 'Value',
		unit: '₹',
		signed: () => false,
		raw: (g) => g.price,
		full: (ref) => ref * 0.3,
		soft: true,
		format: fmt(1)
	},
	iv: {
		label: 'Implied vol',
		unit: '%',
		signed: () => false,
		raw: (_g, sigma) => sigma * 100,
		full: () => 70,
		soft: true,
		format: fmt(1)
	},
	delta: {
		label: 'Delta',
		unit: 'Δ',
		signed: (type) => type !== 'call',
		raw: (g) => g.delta,
		full: () => 1,
		soft: false,
		format: fmt(3)
	},
	gamma: {
		label: 'Gamma',
		unit: 'Γ ×10⁻⁴',
		signed: () => false,
		raw: (g) => g.gamma * 1e4,
		full: (ref) => (9 / ref) * 1e4,
		soft: true,
		format: fmt(3)
	},
	vega: {
		label: 'Vega',
		unit: '₹ / vol pt',
		signed: () => false,
		raw: (g) => g.vega,
		full: (ref) => ref * 0.0026,
		soft: false,
		format: fmt(2)
	},
	theta: {
		label: 'Theta',
		unit: '₹ / day',
		signed: () => true,
		raw: (g) => g.theta,
		full: (ref) => ref * 0.0011,
		soft: true,
		format: fmt(2)
	}
};

export interface PointEval {
	strike: number;
	daysToExpiry: number;
	/** Days left after theta decay (0 = expired). */
	daysLeft: number;
	sigma: number;
	greeks: Greeks;
}

export function evaluatePoint(p: SurfaceParams, strike: number, daysToExpiry: number): PointEval {
	const daysLeft = Math.max(0, daysToExpiry - p.daysElapsed);
	const T = daysLeft / 365;
	const sigma = smileVol(p.spot, strike, T, p);
	return { strike, daysToExpiry, daysLeft, sigma, greeks: blackScholes(p.spot, strike, T, p.riskFree, sigma, p.optionType) };
}

/** Normalised height in [−1, 1] (signed metrics) or [0, 1]. */
export function normalise(spec: MetricSpec, raw: number, refSpot: number): number {
	const u = raw / spec.full(refSpot);
	if (spec.soft) return Math.tanh(u * 0.9) / Math.tanh(0.9) / 1.35;
	return Math.max(-1.05, Math.min(1.05, u));
}

export function strikeAt(p: Pick<SurfaceParams, 'refSpot'>, fx: number) {
	return p.refSpot * (STRIKE_RANGE[0] + (STRIKE_RANGE[1] - STRIKE_RANGE[0]) * fx);
}

export function expiryAt(fz: number) {
	return EXPIRY_RANGE_DAYS[0] + (EXPIRY_RANGE_DAYS[1] - EXPIRY_RANGE_DAYS[0]) * fz;
}

/** World X for a strike; world Z for an expiry (near expiries toward the camera). */
export function strikeToX(p: Pick<SurfaceParams, 'refSpot'>, strike: number) {
	const fx = (strike / p.refSpot - STRIKE_RANGE[0]) / (STRIKE_RANGE[1] - STRIKE_RANGE[0]);
	return (fx * 2 - 1) * SCENE.halfX;
}

export function expiryToZ(days: number) {
	const fz = (days - EXPIRY_RANGE_DAYS[0]) / (EXPIRY_RANGE_DAYS[1] - EXPIRY_RANGE_DAYS[0]);
	return (1 - fz * 2) * SCENE.halfZ;
}

export function heightToY(u: number, signed: boolean) {
	return signed ? SCENE.height * 0.5 * (1 + u) : SCENE.height * u;
}

export interface SurfaceField {
	/** Normalised heights, row-major: index = iz * GRID_STRIKES + ix. */
	u: Float32Array;
	signed: boolean;
	min: number;
	max: number;
}

/** Evaluate the whole grid. ~3.6k Black-Scholes calls — well under a millisecond budget per frame. */
export function computeField(p: SurfaceParams, metric: SurfaceMetric): SurfaceField {
	const spec = METRICS[metric];
	const signed = spec.signed(p.optionType);
	const u = new Float32Array(GRID_STRIKES * GRID_EXPIRIES);
	let min = Infinity;
	let max = -Infinity;
	for (let iz = 0; iz < GRID_EXPIRIES; iz++) {
		const days = expiryAt(iz / (GRID_EXPIRIES - 1));
		for (let ix = 0; ix < GRID_STRIKES; ix++) {
			const strike = strikeAt(p, ix / (GRID_STRIKES - 1));
			const pt = evaluatePoint(p, strike, days);
			const raw = spec.raw(pt.greeks, pt.sigma);
			if (raw < min) min = raw;
			if (raw > max) max = raw;
			u[iz * GRID_STRIKES + ix] = normalise(spec, raw, p.refSpot);
		}
	}
	return { u, signed, min, max };
}

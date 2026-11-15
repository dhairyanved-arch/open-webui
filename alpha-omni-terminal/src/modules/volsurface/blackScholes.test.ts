import { describe, expect, it } from 'vitest';
import { blackScholes, normCdf, smileVol } from './blackScholes';

describe('Black-Scholes', () => {
	it('matches the textbook value (S=K=100, T=1, r=5%, σ=20%)', () => {
		const c = blackScholes(100, 100, 1, 0.05, 0.2, 'call');
		const p = blackScholes(100, 100, 1, 0.05, 0.2, 'put');
		expect(c.price).toBeCloseTo(10.4506, 3);
		expect(p.price).toBeCloseTo(5.5735, 3);
		expect(c.delta).toBeCloseTo(0.6368, 3);
		expect(c.gamma).toBeCloseTo(0.01876, 4);
		expect(c.vega).toBeCloseTo(0.3752, 3);
		expect(c.theta).toBeCloseTo(-6.414 / 365, 4);
	});

	it('satisfies put-call parity across the grid', () => {
		for (const K of [70, 90, 100, 115, 140]) {
			for (const T of [0.02, 0.25, 1.5]) {
				const c = blackScholes(100, K, T, 0.06, 0.27, 'call').price;
				const p = blackScholes(100, K, T, 0.06, 0.27, 'put').price;
				expect(c - p).toBeCloseTo(100 - K * Math.exp(-0.06 * T), 4);
			}
		}
	});

	it('has Greeks that agree with finite differences', () => {
		const [S, K, T, r, v] = [24700, 25000, 45 / 365, 0.068, 0.16];
		const g = blackScholes(S, K, T, r, v, 'call');
		const h = S * 1e-4;
		const up = blackScholes(S + h, K, T, r, v, 'call').price;
		const dn = blackScholes(S - h, K, T, r, v, 'call').price;
		expect((up - dn) / (2 * h)).toBeCloseTo(g.delta, 4);
		expect((up - 2 * g.price + dn) / (h * h)).toBeCloseTo(g.gamma, 6);
		const dv = blackScholes(S, K, T, r, v + 0.01, 'call').price - g.price;
		expect(dv).toBeCloseTo(g.vega, 0);
		const dt = blackScholes(S, K, T - 1 / 365, r, v, 'call').price - g.price;
		expect(dt / g.theta).toBeCloseTo(1, 1);
	});

	it('collapses to intrinsic value at expiry without NaNs', () => {
		const c = blackScholes(110, 100, 0, 0.05, 0.2, 'call');
		const p = blackScholes(110, 100, 0, 0.05, 0.2, 'put');
		expect(c.price).toBe(10);
		expect(p.price).toBe(0);
		expect(c.gamma).toBe(0);
		expect(Number.isFinite(c.theta)).toBe(true);
	});

	it('builds a straddle as call + put', () => {
		const s = blackScholes(100, 100, 0.5, 0.05, 0.3, 'straddle');
		const c = blackScholes(100, 100, 0.5, 0.05, 0.3, 'call');
		const p = blackScholes(100, 100, 0.5, 0.05, 0.3, 'put');
		expect(s.price).toBeCloseTo(c.price + p.price, 10);
		expect(s.delta).toBeCloseTo(c.delta + p.delta, 10);
	});

	it('has an accurate normal CDF', () => {
		expect(normCdf(0)).toBeCloseTo(0.5, 6);
		expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
		expect(normCdf(-1.2815515655)).toBeCloseTo(0.1, 5);
		expect(normCdf(8)).toBeLessThanOrEqual(1);
		expect(normCdf(-8)).toBeGreaterThanOrEqual(0);
	});
});

describe('Volatility smile', () => {
	const p = { atmIv: 0.16, skew: -0.28, convexity: 0.45 };
	it('returns the ATM vol at the money for the reference tenor', () => {
		expect(smileVol(100, 100, 30 / 365, p)).toBeCloseTo(0.16, 6);
	});
	it('lifts both wings and skews toward puts (an equity-index smirk)', () => {
		const atm = smileVol(100, 100, 30 / 365, p);
		const put = smileVol(100, 90, 30 / 365, p);
		const call = smileVol(100, 110, 30 / 365, p);
		const farCall = smileVol(100, 130, 30 / 365, p);
		expect(put).toBeGreaterThan(atm);
		expect(farCall).toBeGreaterThan(atm);
		// the low point of a put-skewed smile sits above the money, not at it
		expect(call).toBeLessThan(atm);
		expect(put).toBeGreaterThan(call);
	});
	it('stays finite and bounded at extreme strikes and zero tenor', () => {
		for (const K of [1, 50, 100, 400]) {
			const v = smileVol(100, K, 0, p);
			expect(Number.isFinite(v)).toBe(true);
			expect(v).toBeGreaterThan(0);
			expect(v).toBeLessThanOrEqual(2.5);
		}
	});
});

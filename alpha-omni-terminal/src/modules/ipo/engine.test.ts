import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ITERATIONS,
	categoryRules,
	scenarioGrid,
	simulateIpo,
	type IpoInputs
} from './engine';

const base: IpoInputs = {
	issuePrice: 500,
	lotSize: 29,
	gmp: 180,
	subRetail: 24,
	subNII: 60,
	subQIB: 110,
	category: 'retail',
	applications: 4,
	unitsPerApp: 1,
	subscriptionVol: 0.15
};

const variants: Array<[string, Partial<IpoInputs>]> = [
	['hot retail lottery', {}],
	['undersubscribed', { subRetail: 0.6, subNII: 0.4, subQIB: 0.9, gmp: -10, unitsPerApp: 5 }],
	['barely oversubscribed', { subRetail: 1.12, unitsPerApp: 8, applications: 2 }],
	['sNII lottery', { category: 'snii', applications: 3 }],
	['bNII proportionate', { category: 'bnii', subNII: 1.4, unitsPerApp: 3 }],
	['ten applications', { applications: 10, subRetail: 6 }]
];

describe('IPO Monte Carlo — normalisation', () => {
	for (const [name, patch] of variants) {
		it(`sums to exactly 100% of draws (${name})`, () => {
			const r = simulateIpo({ ...base, ...patch }, DEFAULT_ITERATIONS, 7);
			expect(r.iterations).toBe(10_000);

			// allotment distribution
			expect(r.allotment.outcomes.reduce((s, o) => s + o.count, 0)).toBe(r.iterations);
			expect(r.allotment.probSum).toBe(1);
			expect(r.allotment.outcomes.reduce((s, o) => s + o.prob, 0)).toBeCloseTo(1, 12);

			// joint matrix: cells, marginals and grand total
			expect(r.joint.totalCount).toBe(r.iterations);
			expect(r.joint.probSum).toBe(1);
			expect(r.joint.cells.flat().reduce((s, c) => s + c.prob, 0)).toBeCloseTo(1, 12);
			expect(r.joint.rowTotals.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
			expect(r.joint.colTotals.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
			// the "no allotment" column is the complement of P(any allotment)
			expect(r.joint.colTotals[0]).toBeCloseTo(1 - r.allotment.pAny, 12);

			// P&L partition and histogram population
			expect(r.pnl.pProfit + r.pnl.pLoss + r.pnl.pFlat).toBeCloseTo(1, 12);
			expect(r.histogram.bins.reduce((s, b) => s + b.count, 0)).toBe(r.histogram.population);
			if (r.histogram.population > 0) {
				expect(r.histogram.bins.reduce((s, b) => s + b.prob, 0)).toBeCloseTo(1, 12);
			}
		});
	}
});

describe('IPO Monte Carlo — draw mechanics', () => {
	it('fills the whole bid when the book is undersubscribed', () => {
		const r = simulateIpo({ ...base, subRetail: 0.5, subscriptionVol: 0, unitsPerApp: 3, applications: 2 }, 10_000, 3);
		expect(r.allotment.pAny).toBe(1);
		expect(r.allotment.outcomes).toHaveLength(1);
		expect(r.allotment.outcomes[0].lots).toBe(6);
	});

	it('gives at most one lot per application in a retail lottery', () => {
		const r = simulateIpo({ ...base, subRetail: 40, unitsPerApp: 10, applications: 3 }, 10_000, 3);
		expect(Math.max(...r.allotment.outcomes.map((o) => o.lots))).toBeLessThanOrEqual(3);
	});

	it('matches the analytic lottery probability (avg bid ÷ subscription)', () => {
		const sub = 50;
		const r = simulateIpo({ ...base, subRetail: sub, applications: 1, subscriptionVol: 0 }, 200_000, 11);
		// E[a / S] with a ~ U(1.0, 1.3)  →  1.15 / 50 = 2.3%
		expect(r.allotment.perApplication).toBeCloseTo(1.15 / sub, 2);
	});

	it('lowers allotment odds monotonically as subscription rises', () => {
		const probs = [2, 5, 20, 80].map(
			(s) => simulateIpo({ ...base, subRetail: s }, 10_000, 5).allotment.pAny
		);
		for (let i = 1; i < probs.length; i++) expect(probs[i]).toBeLessThan(probs[i - 1]);
	});

	it('sizes NII minimum applications above the ₹2L / ₹10L thresholds', () => {
		const s = categoryRules({ issuePrice: 500, lotSize: 29, category: 'snii' });
		const b = categoryRules({ issuePrice: 500, lotSize: 29, category: 'bnii' });
		expect(s.unitLots * s.lotValue).toBeGreaterThan(200_000);
		expect((s.unitLots - 1) * s.lotValue).toBeLessThanOrEqual(200_000);
		expect(b.unitLots * b.lotValue).toBeGreaterThan(1_000_000);
	});

	it('is deterministic for a given seed and varies across seeds', () => {
		const a = simulateIpo(base, 10_000, 42);
		const b = simulateIpo(base, 10_000, 42);
		const c = simulateIpo(base, 10_000, 43);
		expect(a.pnl.mean).toBe(b.pnl.mean);
		expect(a.pnl.mean).not.toBe(c.pnl.mean);
	});

	it('prices a positive GMP as positive expected P&L and a negative one as a loss', () => {
		expect(simulateIpo({ ...base, gmp: 200 }, 10_000, 9).pnl.mean).toBeGreaterThan(0);
		expect(simulateIpo({ ...base, gmp: -60, subRetail: 0.8 }, 10_000, 9).pnl.mean).toBeLessThan(0);
	});
});

describe('IPO scenario surface', () => {
	it('produces a full grid with odds falling along the subscription axis', () => {
		const grid = scenarioGrid(base, 4000, 21);
		expect(grid).toHaveLength(8);
		for (const row of grid) {
			expect(row).toHaveLength(9);
			expect(row[0].pAllot).toBe(1);
			expect(row[row.length - 1].pAllot).toBeLessThan(row[2].pAllot);
		}
	});
});

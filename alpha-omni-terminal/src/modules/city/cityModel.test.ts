import { describe, expect, it } from 'vitest';
import { generatePortfolio } from '@/data/generators';
import { buildCity, buildingDimensions, parsePortfolio, weatherFor } from './cityModel';

const portfolio = generatePortfolio(20261114);

describe('portfolio city layout', () => {
	const city = buildCity(portfolio);

	it('places every holding exactly once and weights sum to 100%', () => {
		const buildings = city.districts.flatMap((d) => d.buildings);
		expect(buildings).toHaveLength(portfolio.holdings.length);
		expect(new Set(buildings.map((b) => b.holding.id)).size).toBe(portfolio.holdings.length);
		expect(buildings.reduce((s, b) => s + b.weightPct, 0)).toBeCloseTo(100, 8);
		expect(city.districts.reduce((s, d) => s + d.weightPct, 0)).toBeCloseTo(100, 8);
		const cls = city.byClass;
		expect(cls.equity.weightPct + cls.mutual_fund.weightPct + cls.debt.weightPct).toBeCloseTo(100, 8);
	});

	it('scales height and girth monotonically with capital', () => {
		for (const assetClass of ['equity', 'mutual_fund', 'debt'] as const) {
			let prev = buildingDimensions(100_000, assetClass);
			for (const value of [500_000, 1_500_000, 4_000_000]) {
				const next = buildingDimensions(value, assetClass);
				expect(next.height).toBeGreaterThan(prev.height);
				expect(next.width).toBeGreaterThan(prev.width);
				prev = next;
			}
		}
	});

	it('gives each asset class distinct proportions', () => {
		const e = buildingDimensions(2_000_000, 'equity');
		const d = buildingDimensions(2_000_000, 'debt');
		expect(e.height / e.width).toBeGreaterThan(3 * (d.height / d.width));
	});

	it('keeps buildings inside their district and districts apart', () => {
		for (const d of city.districts) {
			for (const b of d.buildings) {
				expect(Math.abs(b.x - d.x) + b.width / 2).toBeLessThanOrEqual(d.width / 2 + 1e-6);
				expect(Math.abs(b.z - d.z) + b.depth / 2).toBeLessThanOrEqual(d.depth / 2 + 1e-6);
			}
		}
		for (let i = 0; i < city.districts.length; i++) {
			for (let j = i + 1; j < city.districts.length; j++) {
				const a = city.districts[i];
				const b = city.districts[j];
				const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-6;
				const overlapZ = Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - 1e-6;
				expect(overlapX && overlapZ).toBe(false);
			}
		}
	});

	it('maps daily moves to weather', () => {
		expect(weatherFor(1.2)).toBe('sun');
		expect(weatherFor(0.1)).toBe('fog');
		expect(weatherFor(-0.9)).toBe('rain');
		expect(weatherFor(-2.6)).toBe('storm');
		const moved = { ...portfolio, holdings: portfolio.holdings.map((h) => ({ ...h, dayChangePct: h.sector === 'Technology' ? -4 : 2 })) };
		const next = buildCity(moved);
		expect(next.districts.find((d) => d.sector === 'Technology')!.weather).toBe('storm');
		expect(next.districts.find((d) => d.sector === 'Banking')!.weather).toBe('sun');
	});

	it('survives an empty or single-holding portfolio', () => {
		expect(buildCity({ currency: 'INR', holdings: [] }).districts).toEqual([]);
		const one = buildCity({ currency: 'INR', holdings: [portfolio.holdings[0]] });
		expect(one.districts).toHaveLength(1);
		expect(Number.isFinite(one.radius)).toBe(true);
	});
});

describe('portfolio JSON parsing', () => {
	it('round-trips the generated portfolio', () => {
		const parsed = parsePortfolio(JSON.stringify(portfolio));
		expect('portfolio' in parsed && parsed.portfolio.holdings).toEqual(portfolio.holdings);
	});
	it('rejects malformed input with a specific message', () => {
		expect(parsePortfolio('{oops')).toHaveProperty('error');
		expect(parsePortfolio('{"holdings": 3}')).toHaveProperty('error');
		const bad = parsePortfolio(JSON.stringify({ holdings: [{ name: 'X', assetClass: 'crypto', value: 1 }] }));
		expect('error' in bad && bad.error).toContain('assetClass');
	});
});

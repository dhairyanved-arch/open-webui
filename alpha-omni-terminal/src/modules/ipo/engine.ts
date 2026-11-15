import { Rng } from '@/lib/rng';
import { clamp } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * IPO Monte Carlo engine
 *
 * Each iteration plays one complete IPO outcome for the applicant:
 *
 *   1. Final book — the live subscription multiples are perturbed with
 *      correlated log-normal shocks (books keep filling until the close).
 *   2. Basis of allotment — the SEBI draw mechanics for the chosen category:
 *        · undersubscribed            → full allotment of the bid
 *        · oversubscribed, but fewer
 *          applicants than lots       → one minimum lot each + proportionate rest
 *        · more applicants than lots  → computerised lottery; winners receive
 *                                       exactly one minimum application
 *      Retail's minimum is one lot. sNII / bNII use the smallest bid above
 *      ₹2 lakh / ₹10 lakh, which is how post-2022 NII allotment works.
 *   3. Listing day — grey-market premium is realised with a demand-dependent
 *      haircut, idiosyncratic noise and an occasional market gap-down.
 *
 * Probabilities are computed as integer counts over the iteration total, so every
 * distribution reported here sums to exactly 100% of the draws.
 * ──────────────────────────────────────────────────────────────────────────── */

export type IpoCategory = 'retail' | 'snii' | 'bnii';

export interface IpoInputs {
	issuePrice: number;
	lotSize: number;
	/** Live grey-market premium, ₹ per share. */
	gmp: number;
	subRetail: number;
	subNII: number;
	subQIB: number;
	category: IpoCategory;
	/** Independent applications (one per PAN). */
	applications: number;
	/** Bid size per application, in multiples of the category minimum. */
	unitsPerApp: number;
	/** Log-sigma of the gap between the live and the final subscription. */
	subscriptionVol: number;
}

export interface CategoryRules {
	label: string;
	/** Lots in one minimum application for this category. */
	unitLots: number;
	/** Largest bid allowed, in units. */
	maxUnits: number;
	lotValue: number;
	/** Range of the market-wide average bid size (in units) used by the draw. */
	avgUnits: [number, number];
}

const RETAIL_CAP = 200_000;
const SNII_CAP = 1_000_000;

export function categoryRules(inputs: Pick<IpoInputs, 'issuePrice' | 'lotSize' | 'category'>): CategoryRules {
	const lotValue = Math.max(1, inputs.issuePrice * inputs.lotSize);
	const retailMaxLots = Math.max(1, Math.floor(RETAIL_CAP / lotValue));
	if (inputs.category === 'retail') {
		return { label: 'Retail', unitLots: 1, maxUnits: retailMaxLots, lotValue, avgUnits: [1.0, 1.3] };
	}
	if (inputs.category === 'snii') {
		const unitLots = retailMaxLots + 1;
		const maxUnits = Math.max(1, Math.floor(SNII_CAP / (unitLots * lotValue)));
		return { label: 'sNII', unitLots, maxUnits, lotValue, avgUnits: [1.0, 1.6] };
	}
	const unitLots = Math.floor(SNII_CAP / lotValue) + 1;
	return { label: 'bNII', unitLots, maxUnits: 5, lotValue, avgUnits: [1.0, 2.2] };
}

export const RETURN_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
	{ label: '> +100%', lo: 1.0, hi: Infinity },
	{ label: '+50 to +100%', lo: 0.5, hi: 1.0 },
	{ label: '+25 to +50%', lo: 0.25, hi: 0.5 },
	{ label: '+10 to +25%', lo: 0.1, hi: 0.25 },
	{ label: '0 to +10%', lo: 0, hi: 0.1 },
	{ label: '−10 to 0%', lo: -0.1, hi: 0 },
	{ label: '< −10%', lo: -Infinity, hi: -0.1 }
];

interface Draws {
	lots: Int32Array;
	/** Applications (out of `applications`) that received shares in each draw. */
	winners: Int32Array;
	ret: Float64Array;
	pnl: Float64Array;
}

/** Demand-weighted GMP realisation: QIB conviction matters most on listing day. */
function demandScore(subQIB: number, subNII: number, subRetail: number) {
	return 0.5 * Math.log1p(subQIB) + 0.3 * Math.log1p(subNII) + 0.2 * Math.log1p(subRetail);
}

function runDraws(inputs: IpoInputs, rules: CategoryRules, iterations: number, rng: Rng): Draws {
	const lots = new Int32Array(iterations);
	const winners = new Int32Array(iterations);
	const ret = new Float64Array(iterations);
	const pnl = new Float64Array(iterations);

	const issue = Math.max(0.01, inputs.issuePrice);
	const g = inputs.gmp / issue;
	const apps = Math.max(1, Math.round(inputs.applications));
	const unitsBid = clamp(Math.round(inputs.unitsPerApp), 1, rules.maxUnits);
	const sigma = Math.max(0, inputs.subscriptionVol);
	const drift = -0.5 * sigma * sigma;
	const isRetail = inputs.category === 'retail';
	const [aLo, aHi] = rules.avgUnits;
	const sharesPerUnit = rules.unitLots * inputs.lotSize;
	const noiseSd = 0.035 + 0.1 * Math.abs(g);

	for (let i = 0; i < iterations; i++) {
		// 1 ── final book: common demand factor + per-book noise (ρ ≈ 0.5)
		const common = rng.gauss();
		const sRetail = inputs.subRetail * Math.exp(drift + sigma * (0.7 * common + 0.714 * rng.gauss()));
		const sNII = inputs.subNII * Math.exp(drift + sigma * (0.7 * common + 0.714 * rng.gauss()));
		const sQIB = inputs.subQIB * Math.exp(drift + sigma * (0.7 * common + 0.714 * rng.gauss()));
		const sCat = isRetail ? sRetail : sNII;

		// 2 ── basis of allotment
		let units = 0;
		let won = apps;
		if (sCat <= 1) {
			units = apps * unitsBid;
		} else {
			// Oversubscription counted in applications rather than shares.
			const byApplications = sCat / rng.range(aLo, aHi);
			if (byApplications <= 1) {
				const fill = (1 - byApplications) / (sCat - byApplications);
				const extra = (unitsBid - 1) * fill;
				const whole = Math.floor(extra);
				const frac = extra - whole;
				for (let a = 0; a < apps; a++) units += 1 + whole + (rng.next() < frac ? 1 : 0);
			} else {
				const p = 1 / byApplications;
				for (let a = 0; a < apps; a++) if (rng.next() < p) units += 1;
				won = units;
			}
		}
		lots[i] = units * rules.unitLots;
		winners[i] = won;

		// 3 ── listing-day return
		const realisation = rng.normal(clamp(0.5 + 0.11 * demandScore(sQIB, sNII, sRetail), 0.45, 1.05), 0.2);
		const gap = rng.next() < 0.07 ? rng.normal(-0.07, 0.05) : 0;
		const r = Math.max(-0.6, g * realisation + rng.normal(0, noiseSd) + gap);
		ret[i] = r;
		pnl[i] = units * sharesPerUnit * issue * r;
	}

	return { lots, winners, ret, pnl };
}

function quantile(sorted: Float64Array, q: number): number {
	if (sorted.length === 0) return 0;
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface AllotmentOutcome {
	lots: number;
	count: number;
	prob: number;
}

export interface JointCell {
	count: number;
	prob: number;
	avgPnl: number;
}

export interface SimResult {
	iterations: number;
	seed: number;
	elapsedMs: number;
	rules: CategoryRules;
	capitalBlocked: number;
	allotment: {
		outcomes: AllotmentOutcome[];
		pAny: number;
		expectedLots: number;
		/** Share of individual applications that received an allotment. */
		perApplication: number;
		/** Σ of outcome probabilities — 1 by construction. */
		probSum: number;
	};
	listing: { mean: number; p5: number; p25: number; p50: number; p75: number; p95: number; pPositive: number };
	pnl: {
		mean: number;
		stdev: number;
		p5: number;
		p50: number;
		p95: number;
		min: number;
		max: number;
		pProfit: number;
		pLoss: number;
		pFlat: number;
		meanIfAllotted: number;
		returnOnBlocked: number;
	};
	histogram: {
		bins: Array<{ x0: number; x1: number; count: number; prob: number }>;
		/** Draws with an allotment — the population the histogram describes. */
		population: number;
	};
	joint: {
		rows: string[];
		cols: Array<{ label: string; loLots: number; hiLots: number }>;
		cells: JointCell[][];
		rowTotals: number[];
		colTotals: number[];
		totalCount: number;
		/** Σ of every cell probability — must equal 1. */
		probSum: number;
	};
}

export const DEFAULT_ITERATIONS = 10_000;

export function simulateIpo(inputs: IpoInputs, iterations = DEFAULT_ITERATIONS, seed = 1): SimResult {
	const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const rules = categoryRules(inputs);
	const { lots, winners, ret, pnl } = runDraws(inputs, rules, iterations, new Rng(seed));
	const apps = Math.max(1, Math.round(inputs.applications));
	const unitsBid = clamp(Math.round(inputs.unitsPerApp), 1, rules.maxUnits);
	const capitalBlocked = apps * unitsBid * rules.unitLots * rules.lotValue;

	/* ── allotment distribution ── */
	const counts = new Map<number, number>();
	let allottedDraws = 0;
	let lotSum = 0;
	let winnerSum = 0;
	for (let i = 0; i < iterations; i++) {
		const l = lots[i];
		winnerSum += winners[i];
		counts.set(l, (counts.get(l) ?? 0) + 1);
		if (l > 0) allottedDraws++;
		lotSum += l;
	}
	const outcomes: AllotmentOutcome[] = [...counts.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([l, count]) => ({ lots: l, count, prob: count / iterations }));
	const outcomeCount = outcomes.reduce((s, o) => s + o.count, 0);

	/* ── listing returns ── */
	const retSorted = Float64Array.from(ret).sort();
	let retSum = 0;
	let retPos = 0;
	for (let i = 0; i < iterations; i++) {
		retSum += ret[i];
		if (ret[i] > 0) retPos++;
	}

	/* ── P&L ── */
	const pnlSorted = Float64Array.from(pnl).sort();
	let pnlSum = 0;
	let pnlSq = 0;
	let profit = 0;
	let loss = 0;
	for (let i = 0; i < iterations; i++) {
		const v = pnl[i];
		pnlSum += v;
		pnlSq += v * v;
		if (v > 0) profit++;
		else if (v < 0) loss++;
	}
	const pnlMean = pnlSum / iterations;
	const pnlVar = Math.max(0, pnlSq / iterations - pnlMean * pnlMean);

	/* ── histogram of P&L, conditional on receiving shares ── */
	const allottedPnl = new Float64Array(allottedDraws);
	let k = 0;
	for (let i = 0; i < iterations; i++) if (lots[i] > 0) allottedPnl[k++] = pnl[i];
	allottedPnl.sort();
	const BIN_COUNT = 30;
	const bins: SimResult['histogram']['bins'] = [];
	if (allottedDraws > 0) {
		let lo = quantile(allottedPnl, 0.005);
		let hi = quantile(allottedPnl, 0.995);
		if (hi - lo < 1) {
			lo -= 1;
			hi += 1;
		}
		const width = (hi - lo) / BIN_COUNT;
		const binCounts = new Array<number>(BIN_COUNT).fill(0);
		for (let i = 0; i < allottedDraws; i++) {
			binCounts[clamp(Math.floor((allottedPnl[i] - lo) / width), 0, BIN_COUNT - 1)]++;
		}
		for (let b = 0; b < BIN_COUNT; b++) {
			bins.push({
				x0: lo + b * width,
				x1: lo + (b + 1) * width,
				count: binCounts[b],
				prob: binCounts[b] / allottedDraws
			});
		}
	}

	/* ── joint matrix: listing-return bucket × lots allotted ── */
	const positive = outcomes.filter((o) => o.lots > 0).map((o) => o.lots);
	const cols: SimResult['joint']['cols'] = [{ label: 'No allotment', loLots: 0, hiLots: 0 }];
	const MAX_POSITIVE_COLS = 5;
	if (positive.length <= MAX_POSITIVE_COLS) {
		for (const l of positive) cols.push({ label: `${l} lot${l === 1 ? '' : 's'}`, loLots: l, hiLots: l });
	} else {
		// Equal-population bands over the distinct positive outcomes.
		const per = positive.length / MAX_POSITIVE_COLS;
		for (let b = 0; b < MAX_POSITIVE_COLS; b++) {
			const loLots = positive[Math.round(b * per)];
			const hiLots = positive[Math.min(positive.length - 1, Math.round((b + 1) * per) - 1)];
			cols.push({ label: loLots === hiLots ? `${loLots} lots` : `${loLots}–${hiLots} lots`, loLots, hiLots });
		}
	}
	const cellCount = RETURN_BUCKETS.map(() => cols.map(() => 0));
	const cellPnl = RETURN_BUCKETS.map(() => cols.map(() => 0));
	for (let i = 0; i < iterations; i++) {
		const r = ret[i];
		let row = RETURN_BUCKETS.length - 1;
		for (let b = 0; b < RETURN_BUCKETS.length; b++) {
			if (r >= RETURN_BUCKETS[b].lo) {
				row = b;
				break;
			}
		}
		const l = lots[i];
		let col = 0;
		if (l > 0) {
			col = cols.length - 1;
			for (let c = 1; c < cols.length; c++) {
				if (l <= cols[c].hiLots) {
					col = c;
					break;
				}
			}
		}
		cellCount[row][col]++;
		cellPnl[row][col] += pnl[i];
	}
	const cells: JointCell[][] = cellCount.map((row, ri) =>
		row.map((count, ci) => ({
			count,
			prob: count / iterations,
			avgPnl: count > 0 ? cellPnl[ri][ci] / count : 0
		}))
	);
	const rowTotals = cellCount.map((row) => row.reduce((s, c) => s + c, 0) / iterations);
	const colTotals = cols.map((_, ci) => cellCount.reduce((s, row) => s + row[ci], 0) / iterations);
	const totalCount = cellCount.reduce((s, row) => s + row.reduce((t, c) => t + c, 0), 0);

	const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();

	return {
		iterations,
		seed,
		elapsedMs: ended - started,
		rules,
		capitalBlocked,
		allotment: {
			outcomes,
			pAny: allottedDraws / iterations,
			expectedLots: lotSum / iterations,
			perApplication: winnerSum / (iterations * apps),
			probSum: outcomeCount / iterations
		},
		listing: {
			mean: retSum / iterations,
			p5: quantile(retSorted, 0.05),
			p25: quantile(retSorted, 0.25),
			p50: quantile(retSorted, 0.5),
			p75: quantile(retSorted, 0.75),
			p95: quantile(retSorted, 0.95),
			pPositive: retPos / iterations
		},
		pnl: {
			mean: pnlMean,
			stdev: Math.sqrt(pnlVar),
			p5: quantile(pnlSorted, 0.05),
			p50: quantile(pnlSorted, 0.5),
			p95: quantile(pnlSorted, 0.95),
			min: pnlSorted[0],
			max: pnlSorted[iterations - 1],
			pProfit: profit / iterations,
			pLoss: loss / iterations,
			pFlat: (iterations - profit - loss) / iterations,
			meanIfAllotted: allottedDraws > 0 ? allottedPnl.reduce((s, v) => s + v, 0) / allottedDraws : 0,
			returnOnBlocked: capitalBlocked > 0 ? pnlMean / capitalBlocked : 0
		},
		histogram: { bins, population: allottedDraws },
		joint: { rows: RETURN_BUCKETS.map((b) => b.label), cols, cells, rowTotals, colTotals, totalCount, probSum: totalCount / iterations }
	};
}

/* ── Scenario surface ─────────────────────────────────────────────────────── */

export interface ScenarioCell {
	subscription: number;
	gmpPct: number;
	pAllot: number;
	expectedPnl: number;
	pnlIfAllotted: number;
}

export const SCENARIO_SUBSCRIPTIONS = [0.5, 1, 2, 5, 10, 25, 50, 100, 200];
export const SCENARIO_GMP_PCTS = [100, 75, 50, 35, 20, 10, 0, -10];

/**
 * Re-runs the simulator across a subscription × GMP grid. The applicant's book is
 * set to each subscription level and the other books scale by the same ratio, so
 * a column is a coherent "how hot is this issue" scenario. Every cell shares one
 * seed (common random numbers) which keeps the surface smooth.
 */
export function scenarioGrid(inputs: IpoInputs, iterations: number, seed: number): ScenarioCell[][] {
	const rules = categoryRules(inputs);
	const baseSub = Math.max(0.01, inputs.category === 'retail' ? inputs.subRetail : inputs.subNII);
	return SCENARIO_GMP_PCTS.map((gmpPct) =>
		SCENARIO_SUBSCRIPTIONS.map((subscription) => {
			const ratio = subscription / baseSub;
			const scenario: IpoInputs = {
				...inputs,
				gmp: (gmpPct / 100) * inputs.issuePrice,
				subRetail: inputs.subRetail * ratio,
				subNII: inputs.subNII * ratio,
				subQIB: inputs.subQIB * ratio
			};
			const { lots, pnl } = runDraws(scenario, rules, iterations, new Rng(seed));
			let allotted = 0;
			let sum = 0;
			for (let i = 0; i < iterations; i++) {
				if (lots[i] > 0) allotted++;
				sum += pnl[i];
			}
			return {
				subscription,
				gmpPct,
				pAllot: allotted / iterations,
				expectedPnl: sum / iterations,
				pnlIfAllotted: allotted > 0 ? sum / allotted : 0
			};
		})
	);
}

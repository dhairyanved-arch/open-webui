import { Rng, hashString } from '@/lib/rng';

/* ────────────────────────────────────────────────────────────────────────────
 * Mock-data universe. Everything the five modules need is derived from a single
 * integer seed, so the whole terminal is reproducible and works with no backend.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface IpoPreset {
	id: string;
	name: string;
	sector: string;
	issuePrice: number;
	lotSize: number;
	gmp: number;
	subRetail: number;
	subNII: number;
	subQIB: number;
	issueSizeCr: number;
	status: string;
}

export type AssetClass = 'equity' | 'mutual_fund' | 'debt';

export interface Holding {
	id: string;
	name: string;
	ticker: string;
	assetClass: AssetClass;
	sector: string;
	/** Current market value in ₹. */
	value: number;
	/** Today's move in percent. */
	dayChangePct: number;
}

export interface Portfolio {
	currency: 'INR';
	holdings: Holding[];
}

export interface Instrument {
	symbol: string;
	name: string;
	basePrice: number;
	tick: number;
	/** Median print size in shares. */
	medianQty: number;
	/** Per-step mid-price volatility in basis points. */
	volBps: number;
}

export interface OptionDesk {
	underlying: string;
	spot: number;
	atmIv: number;
	riskFree: number;
	skew: number;
	convexity: number;
}

export interface AlgoTemplateNode {
	id: string;
	type: string;
	position: { x: number; y: number };
	params: Record<string, string | number>;
}

export interface AlgoTemplateEdge {
	id: string;
	source: string;
	sourceHandle: string;
	target: string;
	targetHandle: string;
}

export interface AlgoTemplate {
	id: string;
	name: string;
	description: string;
	nodes: AlgoTemplateNode[];
	edges: AlgoTemplateEdge[];
}

export interface MockUniverse {
	seed: number;
	ipos: IpoPreset[];
	portfolio: Portfolio;
	instruments: Instrument[];
	optionDesk: OptionDesk;
	algoTemplates: AlgoTemplate[];
}

/* ── IPO pipeline ─────────────────────────────────────────────────────────── */

const IPO_ROSTER: Array<{ name: string; sector: string; heat: number }> = [
	{ name: 'Halcyon Semiconductors', sector: 'Chip Design', heat: 1.0 },
	{ name: 'Vyoma Aerospace', sector: 'Defence & Space', heat: 0.85 },
	{ name: 'Kaveri Green Hydrogen', sector: 'Clean Energy', heat: 0.6 },
	{ name: 'Tessellate AI Labs', sector: 'Enterprise AI', heat: 0.95 },
	{ name: 'Northwind Logistics', sector: 'Supply Chain', heat: 0.3 },
	{ name: 'Saffron Lane Foods', sector: 'Consumer Staples', heat: 0.12 }
];

function roundTo(value: number, step: number) {
	return Math.max(step, Math.round(value / step) * step);
}

export function generateIpos(seed: number): IpoPreset[] {
	const rng = new Rng(seed ^ 0x1f0a);
	const statuses = ['Closes today', 'Day 2 of 3', 'Closes tomorrow', 'Day 3 of 3', 'Day 1 of 3', 'Closes today'];
	return IPO_ROSTER.map((entry, i) => {
		const heat = Math.min(1.15, Math.max(0.03, entry.heat + rng.normal(0, 0.08)));
		const issuePrice = roundTo(rng.range(110, 980), 1);
		// SEBI sizing convention: one retail lot is worth roughly ₹14–15k.
		const lotSize = Math.max(1, Math.round(rng.range(14000, 15000) / issuePrice));
		const gmpPct = heat < 0.2 ? rng.range(-0.04, 0.05) : rng.range(0.12, 0.3) + heat * rng.range(0.25, 0.7);
		const subQIB = +(Math.exp(heat * rng.range(4.2, 5.4)) * rng.range(0.6, 1.3)).toFixed(2);
		const subNII = +(Math.exp(heat * rng.range(3.9, 5.0)) * rng.range(0.5, 1.4)).toFixed(2);
		const subRetail = +(Math.exp(heat * rng.range(2.6, 3.8)) * rng.range(0.5, 1.3)).toFixed(2);
		return {
			id: `ipo-${i}`,
			name: entry.name,
			sector: entry.sector,
			issuePrice,
			lotSize,
			gmp: Math.round(issuePrice * gmpPct),
			subRetail,
			subNII,
			subQIB,
			issueSizeCr: roundTo(rng.range(400, 6200), 25),
			status: statuses[i % statuses.length]
		};
	});
}

/* ── Portfolio ────────────────────────────────────────────────────────────── */

interface HoldingSeed {
	name: string;
	ticker: string;
	assetClass: AssetClass;
	sector: string;
	/** Typical position size in ₹ lakh. */
	size: number;
}

const HOLDING_ROSTER: HoldingSeed[] = [
	{ name: 'Tata Consultancy Services', ticker: 'TCS', assetClass: 'equity', sector: 'Technology', size: 14 },
	{ name: 'Infosys', ticker: 'INFY', assetClass: 'equity', sector: 'Technology', size: 9 },
	{ name: 'Persistent Systems', ticker: 'PERSISTENT', assetClass: 'equity', sector: 'Technology', size: 5 },
	{ name: 'HDFC Bank', ticker: 'HDFCBANK', assetClass: 'equity', sector: 'Banking', size: 16 },
	{ name: 'ICICI Bank', ticker: 'ICICIBANK', assetClass: 'equity', sector: 'Banking', size: 11 },
	{ name: 'Bajaj Finance', ticker: 'BAJFINANCE', assetClass: 'equity', sector: 'Banking', size: 6 },
	{ name: 'Reliance Industries', ticker: 'RELIANCE', assetClass: 'equity', sector: 'Energy', size: 18 },
	{ name: 'NTPC', ticker: 'NTPC', assetClass: 'equity', sector: 'Energy', size: 5 },
	{ name: 'Sun Pharma', ticker: 'SUNPHARMA', assetClass: 'equity', sector: 'Pharma', size: 7 },
	{ name: "Divi's Laboratories", ticker: 'DIVISLAB', assetClass: 'equity', sector: 'Pharma', size: 4 },
	{ name: 'Nifty 50 Index Fund', ticker: 'NIFTY50-IDX', assetClass: 'mutual_fund', sector: 'Index Funds', size: 22 },
	{ name: 'Nifty Next 50 Index Fund', ticker: 'NEXT50-IDX', assetClass: 'mutual_fund', sector: 'Index Funds', size: 9 },
	{ name: 'Flexi Cap Growth Fund', ticker: 'FLEXI-GR', assetClass: 'mutual_fund', sector: 'Active Funds', size: 15 },
	{ name: 'Small Cap Discovery Fund', ticker: 'SMALLCAP-GR', assetClass: 'mutual_fund', sector: 'Active Funds', size: 8 },
	{ name: 'Mid Cap Opportunities Fund', ticker: 'MIDCAP-GR', assetClass: 'mutual_fund', sector: 'Active Funds', size: 10 },
	{ name: 'GoI 7.18% 2033', ticker: 'GS-2033', assetClass: 'debt', sector: 'Sovereign', size: 20 },
	{ name: 'GoI 7.30% 2053', ticker: 'GS-2053', assetClass: 'debt', sector: 'Sovereign', size: 8 },
	{ name: 'AAA PSU Bond Ladder', ticker: 'PSU-AAA', assetClass: 'debt', sector: 'Corporate Credit', size: 12 },
	{ name: 'Corporate Bond Fund', ticker: 'CORP-BOND', assetClass: 'debt', sector: 'Corporate Credit', size: 9 },
	{ name: 'Bank Fixed Deposits', ticker: 'FD-LADDER', assetClass: 'debt', sector: 'Corporate Credit', size: 6 }
];

/** Typical one-day move (in %) per asset class — also used to normalise weather. */
export const CLASS_DAILY_VOL: Record<AssetClass, number> = {
	equity: 1.2,
	mutual_fund: 0.9,
	debt: 0.25
};

/**
 * Draw a fresh set of daily moves. Each sector gets a common factor so the city
 * shows coherent district-level weather, plus idiosyncratic noise per holding.
 * `bias` shifts the whole tape (in sigmas) for bull/bear day presets.
 */
export function drawDayChanges(holdings: Holding[], rng: Rng, bias = 0): Holding[] {
	const sectorFactor = new Map<string, number>();
	const market = rng.normal(bias, 0.45);
	return holdings.map((h) => {
		if (!sectorFactor.has(h.sector)) sectorFactor.set(h.sector, market + rng.normal(0, 1.15));
		const sigma = CLASS_DAILY_VOL[h.assetClass];
		const z = (sectorFactor.get(h.sector) ?? 0) + rng.normal(0, 0.45);
		return { ...h, dayChangePct: +(z * sigma).toFixed(2) };
	});
}

export function generatePortfolio(seed: number): Portfolio {
	const rng = new Rng(seed ^ 0xc17e);
	const base: Holding[] = HOLDING_ROSTER.map((h) => ({
		id: h.ticker.toLowerCase(),
		name: h.name,
		ticker: h.ticker,
		assetClass: h.assetClass,
		sector: h.sector,
		value: roundTo(h.size * 100000 * rng.range(0.7, 1.35), 5000),
		dayChangePct: 0
	}));
	return { currency: 'INR', holdings: drawDayChanges(base, rng) };
}

/* ── Tape universe ────────────────────────────────────────────────────────── */

const INSTRUMENT_ROSTER: Array<Omit<Instrument, 'basePrice'> & { ref: number }> = [
	{ symbol: 'RELIANCE', name: 'Reliance Industries', ref: 2940, tick: 0.05, medianQty: 180, volBps: 1.6 },
	{ symbol: 'HDFCBANK', name: 'HDFC Bank', ref: 1685, tick: 0.05, medianQty: 260, volBps: 1.3 },
	{ symbol: 'TCS', name: 'Tata Consultancy', ref: 4120, tick: 0.05, medianQty: 90, volBps: 1.4 },
	{ symbol: 'INFY', name: 'Infosys', ref: 1890, tick: 0.05, medianQty: 210, volBps: 1.7 },
	{ symbol: 'ICICIBANK', name: 'ICICI Bank', ref: 1265, tick: 0.05, medianQty: 320, volBps: 1.5 },
	{ symbol: 'SBIN', name: 'State Bank of India', ref: 842, tick: 0.05, medianQty: 520, volBps: 1.9 },
	{ symbol: 'TATAMOTORS', name: 'Tata Motors', ref: 978, tick: 0.05, medianQty: 440, volBps: 2.3 },
	{ symbol: 'ADANIENT', name: 'Adani Enterprises', ref: 3115, tick: 0.05, medianQty: 120, volBps: 2.8 }
];

export function generateInstruments(seed: number): Instrument[] {
	const rng = new Rng(seed ^ 0x7a9e);
	return INSTRUMENT_ROSTER.map(({ ref, ...rest }) => ({
		...rest,
		basePrice: roundTo(ref * rng.range(0.94, 1.06), rest.tick)
	}));
}

/* ── Options desk ─────────────────────────────────────────────────────────── */

export function generateOptionDesk(seed: number): OptionDesk {
	const rng = new Rng(seed ^ 0x51ab);
	return {
		underlying: 'NIFTY 50',
		spot: roundTo(rng.range(23800, 25600), 50),
		atmIv: +rng.range(0.13, 0.19).toFixed(3),
		riskFree: 0.068,
		skew: +rng.range(-0.34, -0.2).toFixed(2),
		convexity: +rng.range(0.35, 0.6).toFixed(2)
	};
}

/* ── Algo builder starter graphs ──────────────────────────────────────────── */

export function generateAlgoTemplates(seed: number): AlgoTemplate[] {
	const rng = new Rng(seed ^ hashString('algo'));
	const symbol = rng.pick(['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK']);
	const alt = rng.pick(['INFY', 'TCS', 'SBIN', 'TATAMOTORS']);
	return [
		{
			id: 'exhaustion-fade',
			name: 'Exhaustion Fade',
			description: 'Short an overbought spike on climactic volume; cover when momentum resets.',
			nodes: [
				{ id: 'n1', type: 'market_data', position: { x: 0, y: 150 }, params: { symbol, timeframe: '5m' } },
				{ id: 'n2', type: 'rsi', position: { x: 280, y: 0 }, params: { period: 14, op: '>', threshold: 70 } },
				{ id: 'n3', type: 'volume_spike', position: { x: 280, y: 200 }, params: { lookback: 20, multiple: 2 } },
				{ id: 'n4', type: 'and', position: { x: 560, y: 110 }, params: {} },
				{
					id: 'n5',
					type: 'enter_short',
					position: { x: 830, y: 70 },
					params: { sizePct: 10, stopLossPct: 0.8, takeProfitPct: 1.6 }
				},
				{ id: 'n6', type: 'rsi', position: { x: 280, y: 370 }, params: { period: 14, op: '<', threshold: 45 } },
				{ id: 'n7', type: 'exit_position', position: { x: 830, y: 400 }, params: {} }
			],
			edges: [
				{ id: 'e1', source: 'n1', sourceHandle: 'data', target: 'n2', targetHandle: 'data' },
				{ id: 'e2', source: 'n1', sourceHandle: 'data', target: 'n3', targetHandle: 'data' },
				{ id: 'e3', source: 'n2', sourceHandle: 'signal', target: 'n4', targetHandle: 'a' },
				{ id: 'e4', source: 'n3', sourceHandle: 'signal', target: 'n4', targetHandle: 'b' },
				{ id: 'e5', source: 'n4', sourceHandle: 'signal', target: 'n5', targetHandle: 'trigger' },
				{ id: 'e6', source: 'n1', sourceHandle: 'data', target: 'n6', targetHandle: 'data' },
				{ id: 'e7', source: 'n6', sourceHandle: 'signal', target: 'n7', targetHandle: 'trigger' }
			]
		},
		{
			id: 'trend-rider',
			name: 'Trend Rider',
			description: 'Go long on an EMA cross confirmed by price above VWAP inside the liquid session.',
			nodes: [
				{ id: 'n1', type: 'market_data', position: { x: 0, y: 170 }, params: { symbol: alt, timeframe: '15m' } },
				{
					id: 'n2',
					type: 'ma_cross',
					position: { x: 275, y: 0 },
					params: { kind: 'EMA', fast: 9, slow: 21, direction: 'bullish' }
				},
				{ id: 'n3', type: 'price_vwap', position: { x: 275, y: 225 }, params: { side: 'above' } },
				{ id: 'n4', type: 'time_window', position: { x: 275, y: 390 }, params: { start: '09:30', end: '14:45' } },
				{ id: 'n5', type: 'and', position: { x: 550, y: 110 }, params: {} },
				{ id: 'n6', type: 'and', position: { x: 550, y: 300 }, params: {} },
				{
					id: 'n7',
					type: 'enter_long',
					position: { x: 825, y: 250 },
					params: { sizePct: 15, stopLossPct: 1.2, takeProfitPct: 3 }
				}
			],
			edges: [
				{ id: 'e1', source: 'n1', sourceHandle: 'data', target: 'n2', targetHandle: 'data' },
				{ id: 'e2', source: 'n1', sourceHandle: 'data', target: 'n3', targetHandle: 'data' },
				{ id: 'e3', source: 'n1', sourceHandle: 'data', target: 'n4', targetHandle: 'data' },
				{ id: 'e4', source: 'n2', sourceHandle: 'signal', target: 'n5', targetHandle: 'a' },
				{ id: 'e5', source: 'n3', sourceHandle: 'signal', target: 'n5', targetHandle: 'b' },
				{ id: 'e6', source: 'n5', sourceHandle: 'signal', target: 'n6', targetHandle: 'a' },
				{ id: 'e7', source: 'n4', sourceHandle: 'signal', target: 'n6', targetHandle: 'b' },
				{ id: 'e8', source: 'n6', sourceHandle: 'signal', target: 'n7', targetHandle: 'trigger' }
			]
		}
	];
}

export function generateUniverse(seed: number): MockUniverse {
	return {
		seed,
		ipos: generateIpos(seed),
		portfolio: generatePortfolio(seed),
		instruments: generateInstruments(seed),
		optionDesk: generateOptionDesk(seed),
		algoTemplates: generateAlgoTemplates(seed)
	};
}

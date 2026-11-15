import { CLASS_DAILY_VOL, type AssetClass, type Holding, type Portfolio } from '@/data/generators';
import { hashString } from '@/lib/rng';

/* ────────────────────────────────────────────────────────────────────────────
 * Portfolio → city layout. Pure and deterministic.
 *
 *   capital allocation → building height and girth
 *   asset class        → architectural style and proportions
 *   sector             → district (a paved block of related holdings)
 *   daily % change     → weather over the district
 * ──────────────────────────────────────────────────────────────────────────── */

export type Weather = 'sun' | 'fog' | 'rain' | 'storm';

export interface BuildingSpec {
	holding: Holding;
	/** World position of the footprint centre. */
	x: number;
	z: number;
	width: number;
	depth: number;
	height: number;
	weightPct: number;
	/** Stable per-holding seed for façade variation. */
	seed: number;
}

export interface DistrictSpec {
	sector: string;
	assetClass: AssetClass;
	x: number;
	z: number;
	width: number;
	depth: number;
	value: number;
	weightPct: number;
	/** Value-weighted day change, %. */
	dayChangePct: number;
	/** Day change in units of the asset class's typical daily move. */
	sigmaMove: number;
	weather: Weather;
	maxHeight: number;
	buildings: BuildingSpec[];
}

export interface ClassSummary {
	value: number;
	weightPct: number;
	dayChangePct: number;
}

export interface CityLayout {
	districts: DistrictSpec[];
	total: number;
	dayPnl: number;
	dayChangePct: number;
	/** Radius of the circle that encloses every district. */
	radius: number;
	byClass: Record<AssetClass, ClassSummary>;
}

export const CLASS_META: Record<AssetClass, { label: string; color: string; architecture: string }> = {
	equity: { label: 'Equities', color: '#4de3ff', architecture: 'Slender glass towers with spires' },
	mutual_fund: { label: 'Mutual funds', color: '#a78bfa', architecture: 'Stepped setback towers' },
	debt: { label: 'Debt', color: '#ffb224', architecture: 'Low colonnaded halls' }
};

export const WEATHER_META: Record<Weather, { label: string; rule: string; color: string }> = {
	sun: { label: 'Sun', rule: '≥ +0.5σ', color: '#ffd166' },
	fog: { label: 'Fog', rule: 'within ±0.5σ', color: '#aeb7c6' },
	rain: { label: 'Rain', rule: '≤ −0.5σ', color: '#5aa9ff' },
	storm: { label: 'Storm', rule: '≤ −2σ', color: '#ff2d55' }
};

/** Proportions per style: equities reach up, debt spreads out. */
const STYLE: Record<AssetClass, { height: number; girth: number }> = {
	equity: { height: 1.0, girth: 0.82 },
	mutual_fund: { height: 0.78, girth: 1.0 },
	debt: { height: 0.36, girth: 1.5 }
};

/** ₹25 lakh is the reference position: one "unit" of capital. */
const REFERENCE_VALUE = 2_500_000;
const CLASS_ORDER: AssetClass[] = ['equity', 'mutual_fund', 'debt'];
const LOT_GAP = 0.75;
const DISTRICT_MARGIN = 0.9;
const STREET = 1.7;
const ROW_LIMIT = 27;

export function weatherFor(sigmaMove: number): Weather {
	if (sigmaMove >= 0.5) return 'sun';
	if (sigmaMove <= -2) return 'storm';
	if (sigmaMove <= -0.5) return 'rain';
	return 'fog';
}

export function buildingDimensions(value: number, assetClass: AssetClass) {
	const units = Math.min(3, Math.max(0.015, value / REFERENCE_VALUE));
	const style = STYLE[assetClass];
	const height = style.height * (0.55 + 9.6 * Math.pow(units, 0.7));
	const width = style.girth * (0.85 + 1.75 * Math.sqrt(units));
	return { height, width, depth: width * (assetClass === 'debt' ? 0.72 : 1) };
}

export function buildCity(portfolio: Portfolio): CityLayout {
	const holdings = portfolio.holdings.filter((h) => h.value > 0);
	const total = holdings.reduce((s, h) => s + h.value, 0);
	const dayPnl = holdings.reduce((s, h) => s + (h.value * h.dayChangePct) / 100, 0);

	const byClass = Object.fromEntries(
		CLASS_ORDER.map((c) => {
			const members = holdings.filter((h) => h.assetClass === c);
			const value = members.reduce((s, h) => s + h.value, 0);
			const pnl = members.reduce((s, h) => s + (h.value * h.dayChangePct) / 100, 0);
			return [c, { value, weightPct: total ? (value / total) * 100 : 0, dayChangePct: value ? (pnl / value) * 100 : 0 }];
		})
	) as Record<AssetClass, ClassSummary>;

	// group by sector, keeping first-seen order within each asset class
	const groups = new Map<string, Holding[]>();
	for (const cls of CLASS_ORDER) {
		for (const h of holdings) {
			if (h.assetClass !== cls) continue;
			const key = `${cls}|${h.sector}`;
			const list = groups.get(key);
			if (list) list.push(h);
			else groups.set(key, [h]);
		}
	}

	/* each district: buildings on a small grid, tallest at the back */
	const districts: DistrictSpec[] = [];
	for (const [key, members] of groups) {
		const [cls, sector] = key.split('|') as [AssetClass, string];
		const dims = members.map((h) => ({ h, ...buildingDimensions(h.value, h.assetClass) })).sort((a, b) => b.height - a.height);
		const cols = Math.ceil(Math.sqrt(dims.length));
		const rows = Math.ceil(dims.length / cols);
		const cellW = Math.max(...dims.map((d) => d.width)) + LOT_GAP;
		const cellD = Math.max(...dims.map((d) => d.depth)) + LOT_GAP;
		const width = cols * cellW + DISTRICT_MARGIN * 2 - LOT_GAP;
		const depth = rows * cellD + DISTRICT_MARGIN * 2 - LOT_GAP;
		const value = members.reduce((s, h) => s + h.value, 0);
		const pnl = members.reduce((s, h) => s + (h.value * h.dayChangePct) / 100, 0);
		const dayChangePct = value ? (pnl / value) * 100 : 0;
		const sigmaMove = dayChangePct / CLASS_DAILY_VOL[cls];

		const buildings: BuildingSpec[] = dims.map((d, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			// centre partially-filled rows
			const inRow = Math.min(cols, dims.length - row * cols);
			const rowOffset = ((cols - inRow) * cellW) / 2;
			return {
				holding: d.h,
				x: -width / 2 + DISTRICT_MARGIN + cellW * col + (cellW - LOT_GAP) / 2 + rowOffset,
				z: -depth / 2 + DISTRICT_MARGIN + cellD * row + (cellD - LOT_GAP) / 2,
				width: d.width,
				depth: d.depth,
				height: d.height,
				weightPct: total ? (d.h.value / total) * 100 : 0,
				seed: hashString(d.h.id)
			};
		});

		districts.push({
			sector,
			assetClass: cls,
			x: 0,
			z: 0,
			width,
			depth,
			value,
			weightPct: total ? (value / total) * 100 : 0,
			dayChangePct,
			sigmaMove,
			weather: weatherFor(sigmaMove),
			maxHeight: Math.max(...buildings.map((b) => b.height)),
			buildings
		});
	}

	/* shelf-pack districts into streets, one asset class after another */
	const shelves: DistrictSpec[][] = [];
	let current: DistrictSpec[] = [];
	let currentWidth = 0;
	for (const d of districts) {
		const next = currentWidth + (current.length ? STREET : 0) + d.width;
		if (current.length && next > ROW_LIMIT) {
			shelves.push(current);
			current = [];
			currentWidth = 0;
		}
		currentWidth += (current.length ? STREET : 0) + d.width;
		current.push(d);
	}
	if (current.length) shelves.push(current);

	const shelfDepths = shelves.map((row) => Math.max(...row.map((d) => d.depth)));
	const cityDepth = shelfDepths.reduce((s, d) => s + d, 0) + STREET * Math.max(0, shelves.length - 1);
	let z = -cityDepth / 2;
	shelves.forEach((row, ri) => {
		const rowWidth = row.reduce((s, d) => s + d.width, 0) + STREET * (row.length - 1);
		let x = -rowWidth / 2;
		for (const d of row) {
			d.x = x + d.width / 2;
			d.z = z + shelfDepths[ri] / 2;
			for (const b of d.buildings) {
				b.x += d.x;
				b.z += d.z;
			}
			x += d.width + STREET;
		}
		z += shelfDepths[ri] + STREET;
	});

	let radius = 6;
	for (const d of districts) {
		radius = Math.max(radius, Math.hypot(Math.abs(d.x) + d.width / 2, Math.abs(d.z) + d.depth / 2));
	}

	return { districts, total, dayPnl, dayChangePct: total ? (dayPnl / total) * 100 : 0, radius, byClass };
}

/** Parse and validate a user-edited portfolio JSON document. */
export function parsePortfolio(text: string): { portfolio: Portfolio } | { error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return { error: `Not valid JSON — ${(err as Error).message}` };
	}
	const list = (raw as { holdings?: unknown })?.holdings;
	if (!Array.isArray(list)) return { error: 'Expected an object with a "holdings" array.' };
	if (list.length === 0) return { error: 'The portfolio needs at least one holding.' };
	if (list.length > 60) return { error: 'Keep it to 60 holdings or fewer so the city stays readable.' };
	const holdings: Holding[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < list.length; i++) {
		const h = list[i] as Record<string, unknown>;
		const where = `holdings[${i}]`;
		if (!h || typeof h !== 'object') return { error: `${where} must be an object.` };
		const name = String(h.name ?? '').trim();
		if (!name) return { error: `${where} needs a "name".` };
		const assetClass = h.assetClass;
		if (assetClass !== 'equity' && assetClass !== 'mutual_fund' && assetClass !== 'debt') {
			return { error: `${where}.assetClass must be "equity", "mutual_fund" or "debt".` };
		}
		const value = Number(h.value);
		if (!Number.isFinite(value) || value < 0) return { error: `${where}.value must be a non-negative number (₹).` };
		const dayChangePct = Number(h.dayChangePct ?? 0);
		if (!Number.isFinite(dayChangePct) || Math.abs(dayChangePct) > 50) return { error: `${where}.dayChangePct must be between −50 and 50.` };
		const ticker = String(h.ticker ?? name).trim().toUpperCase();
		let id = String(h.id ?? ticker).trim().toLowerCase() || `holding-${i}`;
		while (seen.has(id)) id += '-x';
		seen.add(id);
		holdings.push({ id, name, ticker, assetClass, sector: String(h.sector ?? 'Other').trim() || 'Other', value, dayChangePct });
	}
	return { portfolio: { currency: 'INR', holdings } };
}

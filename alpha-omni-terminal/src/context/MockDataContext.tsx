import * as React from 'react';
import { Rng } from '@/lib/rng';
import {
	drawDayChanges,
	generateUniverse,
	type Holding,
	type Instrument,
	type MockUniverse,
	type Portfolio
} from '@/data/generators';

/* ── Live quote store ─────────────────────────────────────────────────────────
 * The ticker tape updates about once a second. It lives outside React state and
 * is read through useSyncExternalStore so a quote tick re-renders only the tape,
 * never the module that happens to be mounted. */

export interface Quote {
	symbol: string;
	price: number;
	changePct: number;
}

const INDEX_QUOTES: Array<{ symbol: string; ref: number; vol: number }> = [
	{ symbol: 'NIFTY 50', ref: 24680, vol: 0.9 },
	{ symbol: 'BANKNIFTY', ref: 52140, vol: 1.2 },
	{ symbol: 'SENSEX', ref: 81250, vol: 0.9 },
	{ symbol: 'INDIA VIX', ref: 14.2, vol: 6 },
	{ symbol: 'USDINR', ref: 84.1, vol: 0.15 }
];

export class QuoteStore {
	private quotes: Quote[];
	private open: number[];
	private vol: number[];
	private listeners = new Set<() => void>();
	private rng: Rng;

	constructor(seed: number, instruments: Instrument[]) {
		this.rng = new Rng(seed ^ 0x71c4);
		const rows = [
			...INDEX_QUOTES.map((q) => ({ symbol: q.symbol, price: q.ref * this.rng.range(0.985, 1.015), vol: q.vol })),
			...instruments.map((i) => ({ symbol: i.symbol, price: i.basePrice, vol: i.volBps }))
		];
		this.vol = rows.map((r) => r.vol);
		// Start the session somewhere other than flat so the tape reads as live.
		this.open = rows.map((r, i) => r.price / (1 + (this.rng.normal(0, this.vol[i]) * 0.9) / 100));
		this.quotes = rows.map((r, i) => ({
			symbol: r.symbol,
			price: r.price,
			changePct: (r.price / this.open[i] - 1) * 100
		}));
	}

	tick() {
		this.quotes = this.quotes.map((q, i) => {
			const price = q.price * (1 + (this.rng.gauss() * this.vol[i]) / 2200);
			return { symbol: q.symbol, price, changePct: (price / this.open[i] - 1) * 100 };
		});
		this.listeners.forEach((l) => l());
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.quotes;
}

/* ── Context ──────────────────────────────────────────────────────────────── */

interface MockDataValue {
	seed: number;
	universe: MockUniverse;
	/** Regenerate every dataset from a new seed. */
	reseed: () => void;
	portfolio: Portfolio;
	updateHolding: (id: string, patch: Partial<Pick<Holding, 'value' | 'dayChangePct'>>) => void;
	replacePortfolio: (portfolio: Portfolio) => void;
	/** Redraw today's moves. `bias` is in sigmas: +1.4 bull day, −1.4 bear day. */
	shockMarket: (bias?: number) => void;
	resetPortfolio: () => void;
	quotes: QuoteStore;
}

const MockDataContext = React.createContext<MockDataValue | null>(null);

const DEFAULT_SEED = 20261114;

export function MockDataProvider({ children }: { children: React.ReactNode }) {
	const [seed, setSeed] = React.useState(DEFAULT_SEED);
	const universe = React.useMemo(() => generateUniverse(seed), [seed]);
	const [portfolio, setPortfolio] = React.useState<Portfolio>(universe.portfolio);
	const shockCounter = React.useRef(0);

	// A reseed replaces the portfolio along with everything else.
	React.useEffect(() => {
		setPortfolio(universe.portfolio);
	}, [universe]);

	const quotes = React.useMemo(() => new QuoteStore(seed, universe.instruments), [seed, universe.instruments]);

	React.useEffect(() => {
		const id = window.setInterval(() => quotes.tick(), 1100);
		return () => window.clearInterval(id);
	}, [quotes]);

	const reseed = React.useCallback(() => {
		setSeed((s) => (Math.imul(s, 1664525) + 1013904223) >>> 0);
	}, []);

	const updateHolding = React.useCallback<MockDataValue['updateHolding']>((id, patch) => {
		setPortfolio((p) => ({
			...p,
			holdings: p.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h))
		}));
	}, []);

	const shockMarket = React.useCallback(
		(bias = 0) => {
			shockCounter.current += 1;
			const rng = new Rng((seed ^ 0xbeef) + shockCounter.current * 7919);
			setPortfolio((p) => ({ ...p, holdings: drawDayChanges(p.holdings, rng, bias) }));
		},
		[seed]
	);

	const resetPortfolio = React.useCallback(() => setPortfolio(universe.portfolio), [universe]);

	const value = React.useMemo<MockDataValue>(
		() => ({
			seed,
			universe,
			reseed,
			portfolio,
			updateHolding,
			replacePortfolio: setPortfolio,
			shockMarket,
			resetPortfolio,
			quotes
		}),
		[seed, universe, reseed, portfolio, updateHolding, shockMarket, resetPortfolio, quotes]
	);

	return <MockDataContext.Provider value={value}>{children}</MockDataContext.Provider>;
}

export function useMockData() {
	const ctx = React.useContext(MockDataContext);
	if (!ctx) throw new Error('useMockData must be used within MockDataProvider.');
	return ctx;
}

export function useQuotes(): Quote[] {
	const { quotes } = useMockData();
	return React.useSyncExternalStore(quotes.subscribe, quotes.getSnapshot);
}

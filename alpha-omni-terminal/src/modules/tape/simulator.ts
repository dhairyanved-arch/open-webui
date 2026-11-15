import type { Instrument } from '@/data/generators';
import { Rng } from '@/lib/rng';

/* ────────────────────────────────────────────────────────────────────────────
 * Market microstructure simulator.
 *
 * Every symbol keeps a ten-level limit order book around a random-walking mid.
 * Ordinary flow arrives as a Poisson stream of small marketable orders that
 * execute against the book. On top of that the simulator injects institutional
 * activity in two shapes:
 *   block — one very large print that walks several book levels
 *   sweep — a parent order sliced into rapid same-side child prints
 * Each trade carries its true `origin`, which the UI never uses for detection —
 * it exists only so the detector can be scored against ground truth.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Side = 'B' | 'S';
export type Origin = 'flow' | 'block' | 'sweep';

export interface Trade {
	id: number;
	ts: number;
	symbol: string;
	side: Side;
	/** Volume-weighted execution price. */
	price: number;
	qty: number;
	notional: number;
	/** Execution cost against the pre-trade mid, in basis points. */
	slippageBps: number;
	/** Book levels consumed. */
	levels: number;
	origin: Origin;
	/** Shared by all child prints of one injected institutional order. */
	parentId: number | null;
}

export interface BookLevel {
	price: number;
	qty: number;
}

export interface BookSnapshot {
	symbol: string;
	mid: number;
	last: number;
	lastSide: Side;
	spreadBps: number;
	bids: BookLevel[];
	asks: BookLevel[];
}

const LEVELS = 10;

interface Pending {
	due: number;
	side: Side;
	qty: number;
	parentId: number;
}

interface SymbolState {
	inst: Instrument;
	mid: number;
	spreadTicks: number;
	bidQty: number[];
	askQty: number[];
	last: number;
	lastSide: Side;
	/** Slow-moving buy/sell pressure in [-1, 1]. */
	pressure: number;
	pending: Pending[];
}

export interface SimulatorOptions {
	/** Mean ordinary prints per symbol per second. */
	flowRate?: number;
	/** Mean injected institutional orders per second across the universe. */
	blockRate?: number;
}

export class TapeSimulator {
	now: number;
	private rng: Rng;
	private states: SymbolState[];
	private bySymbol = new Map<string, SymbolState>();
	private nextTradeId = 1;
	private nextParentId = 1;
	private flowRate: number;
	private blockRate: number;

	constructor(instruments: Instrument[], seed: number, startTs = 0, options: SimulatorOptions = {}) {
		this.rng = new Rng(seed ^ 0x7a9e11);
		this.now = startTs;
		this.flowRate = options.flowRate ?? 1.5;
		this.blockRate = options.blockRate ?? 0.2;
		this.states = instruments.map((inst) => {
			const state: SymbolState = {
				inst,
				mid: inst.basePrice,
				spreadTicks: 1,
				bidQty: [],
				askQty: [],
				last: inst.basePrice,
				lastSide: 'B',
				pressure: 0,
				pending: []
			};
			for (let i = 0; i < LEVELS; i++) {
				state.bidQty.push(this.levelTarget(inst, i));
				state.askQty.push(this.levelTarget(inst, i));
			}
			this.bySymbol.set(inst.symbol, state);
			return state;
		});
	}

	get symbols(): string[] {
		return this.states.map((s) => s.inst.symbol);
	}

	private levelTarget(inst: Instrument, level: number) {
		return Math.max(1, Math.round(inst.medianQty * (2.5 + level * 1.5) * this.rng.range(0.6, 1.4)));
	}

	private bestBid(s: SymbolState) {
		const t = s.inst.tick;
		return Math.floor((s.mid - (s.spreadTicks * t) / 2) / t + 1e-9) * t;
	}

	/** Execute a marketable order against the book and return the print. */
	private execute(s: SymbolState, side: Side, qty: number, ts: number, origin: Origin, parentId: number | null): Trade {
		const t = s.inst.tick;
		const bid = this.bestBid(s);
		const ask = bid + s.spreadTicks * t;
		const depth = side === 'B' ? s.askQty : s.bidQty;
		const touch = side === 'B' ? ask : bid;
		const dir = side === 'B' ? 1 : -1;
		const midBefore = (bid + ask) / 2;

		let remaining = qty;
		let cost = 0;
		let levels = 0;
		for (let i = 0; i < LEVELS && remaining > 0; i++) {
			const take = Math.min(remaining, depth[i]);
			if (take <= 0) continue;
			cost += take * (touch + dir * i * t);
			depth[i] -= take;
			remaining -= take;
			levels = i + 1;
		}
		if (remaining > 0) {
			// Displayed depth exhausted: the rest fills against hidden liquidity further out.
			cost += remaining * (touch + dir * (LEVELS + 2) * t);
			levels = LEVELS;
		}
		const price = cost / qty;
		const slippageBps = (dir * (price - midBefore) * 1e4) / midBefore;

		// Permanent impact: the mid follows aggressive size.
		const impactTicks = Math.max(0, levels - 1) * 0.55;
		s.mid += dir * impactTicks * t;
		s.last = price;
		s.lastSide = side;

		return {
			id: this.nextTradeId++,
			ts,
			symbol: s.inst.symbol,
			side,
			price,
			qty,
			notional: price * qty,
			slippageBps,
			levels,
			origin,
			parentId
		};
	}

	private injectInstitution() {
		const s = this.rng.pick(this.states);
		const side: Side = this.rng.chance(0.5 + s.pressure * 0.25) ? 'B' : 'S';
		const parentId = this.nextParentId++;
		if (this.rng.chance(0.55)) {
			const qty = Math.round(s.inst.medianQty * this.rng.range(35, 140));
			s.pending.push({ due: this.now + this.rng.range(0, 60), side, qty, parentId: -parentId });
		} else {
			const children = this.rng.int(4, 9);
			let due = this.now + this.rng.range(0, 60);
			for (let i = 0; i < children; i++) {
				s.pending.push({ due, side, qty: Math.round(s.inst.medianQty * this.rng.range(6, 16)), parentId });
				due += this.rng.range(40, 170);
			}
		}
	}

	/** Advance the simulated clock by `dtMs` and return the prints, oldest first. */
	step(dtMs: number): Trade[] {
		const start = this.now;
		const end = start + dtMs;
		const trades: Trade[] = [];
		const scale = Math.sqrt(dtMs / 100);

		if (this.rng.chance(Math.min(0.9, (this.blockRate * dtMs) / 1000))) this.injectInstitution();
		this.now = end;

		for (const s of this.states) {
			const { inst } = s;
			// mid random walk with mean-reverting order-flow pressure
			s.pressure = s.pressure * 0.985 + this.rng.gauss() * 0.06;
			s.pressure = Math.max(-1, Math.min(1, s.pressure));
			s.mid *= 1 + ((this.rng.gauss() * inst.volBps + s.pressure * inst.volBps * 0.35) / 1e4) * scale;
			s.mid = Math.max(inst.tick * 20, s.mid);
			if (this.rng.chance(0.04 * scale)) s.spreadTicks = this.rng.chance(0.75) ? 1 : 2;

			// liquidity replenishes toward its resting shape
			for (let i = 0; i < LEVELS; i++) {
				s.bidQty[i] += (this.levelTarget(inst, i) - s.bidQty[i]) * 0.22;
				s.askQty[i] += (this.levelTarget(inst, i) - s.askQty[i]) * 0.22;
				s.bidQty[i] = Math.max(1, Math.round(s.bidQty[i]));
				s.askQty[i] = Math.max(1, Math.round(s.askQty[i]));
			}

			// ordinary flow: Poisson arrivals, log-normal sizes
			let arrivals = 0;
			const lambda = (this.flowRate * dtMs) / 1000;
			let p = Math.exp(-lambda);
			let cumulative = p;
			const u = this.rng.next();
			while (u > cumulative && arrivals < 12) {
				arrivals++;
				p *= lambda / arrivals;
				cumulative += p;
			}
			for (let k = 0; k < arrivals; k++) {
				const side: Side = this.rng.chance(0.5 + s.pressure * 0.3) ? 'B' : 'S';
				const qty = Math.max(1, Math.round(this.rng.logNormal(inst.medianQty, 0.9)));
				trades.push(this.execute(s, side, qty, start + this.rng.next() * dtMs, 'flow', null));
			}

			// institutional child orders that have come due
			if (s.pending.length) {
				const due = s.pending.filter((o) => o.due <= end);
				if (due.length) {
					s.pending = s.pending.filter((o) => o.due > end);
					for (const o of due) {
						const single = o.parentId < 0;
						trades.push(this.execute(s, o.side, o.qty, Math.max(start, o.due), single ? 'block' : 'sweep', Math.abs(o.parentId)));
					}
				}
			}
		}

		trades.sort((a, b) => a.ts - b.ts || a.id - b.id);
		return trades;
	}

	book(symbol: string): BookSnapshot | null {
		const s = this.bySymbol.get(symbol);
		if (!s) return null;
		const t = s.inst.tick;
		const bid = this.bestBid(s);
		const ask = bid + s.spreadTicks * t;
		const mid = (bid + ask) / 2;
		return {
			symbol,
			mid,
			last: s.last,
			lastSide: s.lastSide,
			spreadBps: ((ask - bid) / mid) * 1e4,
			bids: s.bidQty.map((qty, i) => ({ price: bid - i * t, qty })),
			asks: s.askQty.map((qty, i) => ({ price: ask + i * t, qty }))
		};
	}
}

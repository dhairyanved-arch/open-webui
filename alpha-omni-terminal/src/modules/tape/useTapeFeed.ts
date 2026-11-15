import * as React from 'react';
import type { Instrument } from '@/data/generators';
import { BlockDetector, Scorekeeper, type BlockDeal, type DetectionScore } from './detector';
import { TapeSimulator, type BookSnapshot, type Trade } from './simulator';

export interface TapeRow {
	trade: Trade;
	z: number;
	blockId: string | null;
	kind: 'BLOCK' | 'SWEEP' | null;
}

export interface FeedStats {
	prints: number;
	/** Smoothed prints per (simulated) second. */
	rate: number;
	/** Decayed aggressor notional, for the imbalance bar. */
	buyFlow: number;
	sellFlow: number;
	/** Running signed notional, sampled once per tick. */
	delta: number[];
	blockNotional: number;
	score: DetectionScore;
}

export interface FeedState {
	rows: TapeRow[];
	blocks: BlockDeal[];
	book: BookSnapshot | null;
	stats: FeedStats;
}

const TICK_MS = 110;
const MAX_ROWS = 90;
const MAX_BLOCKS = 40;
const DELTA_POINTS = 180;

const EMPTY_SCORE: DetectionScore = { injected: 0, caught: 0, reported: 0, genuine: 0, recall: 1, precision: 1 };

const emptyState = (): FeedState => ({
	rows: [],
	blocks: [],
	book: null,
	stats: { prints: 0, rate: 0, buyFlow: 0, sellFlow: 0, delta: [], blockNotional: 0, score: EMPTY_SCORE }
});

interface FeedOptions {
	instruments: Instrument[];
	seed: number;
	paused: boolean;
	speed: number;
	zThreshold: number;
	focusSymbol: string;
}

/**
 * Drives the simulator + detector on a fixed interval. All hot state lives in a
 * ref-held engine; React receives one immutable snapshot per tick, so there is
 * exactly one render per tick no matter how many prints arrive.
 */
export function useTapeFeed({ instruments, seed, paused, speed, zThreshold, focusSymbol }: FeedOptions): FeedState {
	const [state, setState] = React.useState<FeedState>(emptyState);

	// Latest control values, readable from the interval without re-subscribing.
	const controls = React.useRef({ paused, speed, zThreshold, focusSymbol });
	controls.current = { paused, speed, zThreshold, focusSymbol };

	const engine = React.useRef<{
		sim: TapeSimulator;
		detector: BlockDetector;
		score: Scorekeeper;
		rows: TapeRow[];
		blocks: BlockDeal[];
		stats: FeedStats;
		cumDelta: number;
	} | null>(null);

	React.useEffect(() => {
		const e = {
			sim: new TapeSimulator(instruments, seed, Date.now()),
			detector: new BlockDetector({ zThreshold: controls.current.zThreshold }),
			score: new Scorekeeper(),
			rows: [] as TapeRow[],
			blocks: [] as BlockDeal[],
			stats: emptyState().stats,
			cumDelta: 0
		};
		engine.current = e;

		const snapshot = () => {
			setState({
				rows: e.rows.slice(),
				blocks: e.blocks.slice(),
				book: e.sim.book(controls.current.focusSymbol),
				stats: { ...e.stats, delta: e.stats.delta.slice(), score: e.score.score() }
			});
		};

		const advance = (dtMs: number) => {
			e.detector.config.zThreshold = controls.current.zThreshold;
			const trades = e.sim.step(dtMs);
			let buy = 0;
			let sell = 0;
			for (const trade of trades) {
				e.score.observe(trade);
				const detection = e.detector.ingest(trade);
				const row: TapeRow = { trade, z: detection.z, blockId: null, kind: null };
				e.rows.unshift(row);
				if (trade.side === 'B') buy += trade.notional;
				else sell += trade.notional;

				const block = detection.block;
				if (block) {
					e.score.report(block);
					const snapshotBlock = { ...block, tradeIds: block.tradeIds.slice() };
					const at = e.blocks.findIndex((b) => b.id === block.id);
					if (at >= 0) {
						e.stats.blockNotional += block.notional - e.blocks[at].notional;
						e.blocks[at] = snapshotBlock;
					} else {
						e.stats.blockNotional += block.notional;
						e.blocks.unshift(snapshotBlock);
					}
					// Tag every member print, including earlier children of a sweep.
					const members = new Set(block.tradeIds);
					for (let i = 0; i < e.rows.length; i++) {
						const r = e.rows[i];
						if (members.has(r.trade.id) && r.blockId !== block.id) {
							e.rows[i] = { ...r, blockId: block.id, kind: block.kind };
						}
					}
				}
			}
			if (e.rows.length > MAX_ROWS) e.rows.length = MAX_ROWS;
			if (e.blocks.length > MAX_BLOCKS) e.blocks.length = MAX_BLOCKS;

			const s = e.stats;
			s.prints += trades.length;
			s.rate = s.rate === 0 ? (trades.length * 1000) / dtMs : s.rate * 0.9 + ((trades.length * 1000) / dtMs) * 0.1;
			s.buyFlow = s.buyFlow * 0.96 + buy;
			s.sellFlow = s.sellFlow * 0.96 + sell;
			e.cumDelta += buy - sell;
			s.delta.push(e.cumDelta);
			if (s.delta.length > DELTA_POINTS) s.delta.shift();
		};

		// Pre-roll ~25 simulated seconds so every symbol's size baseline is warm and the
		// tape opens full. Scoring restarts afterwards: orders injected while the
		// detector was still learning are not a fair test of it.
		for (let i = 0; i < 230; i++) advance(TICK_MS);
		e.score = new Scorekeeper();
		e.blocks.length = 0;
		e.rows = e.rows.map((r) => (r.kind ? { ...r, kind: null, blockId: null } : r));
		e.stats = { ...emptyState().stats, rate: e.stats.rate, delta: [] };
		e.cumDelta = 0;
		snapshot();

		const id = window.setInterval(() => {
			if (controls.current.paused) return;
			advance(TICK_MS * controls.current.speed);
			snapshot();
		}, TICK_MS);

		return () => {
			window.clearInterval(id);
			engine.current = null;
		};
	}, [instruments, seed]);

	// Changing the focused symbol while paused should still refresh the ladder.
	React.useEffect(() => {
		const e = engine.current;
		if (e) setState((prev) => ({ ...prev, book: e.sim.book(focusSymbol) }));
	}, [focusSymbol]);

	return state;
}

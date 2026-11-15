import type { Side, Trade } from './simulator';

/* ────────────────────────────────────────────────────────────────────────────
 * Institutional block-deal detector.
 *
 * Works only from what a real tape exposes: symbol, side, size, price, slippage
 * and time. Two complementary rules:
 *
 *   1. Outlier prints. Each symbol keeps an exponentially-weighted baseline of
 *      log trade size. A print is a BLOCK when its z-score clears the threshold,
 *      or when it is clearly large AND paid unusual slippage (walked the book).
 *      Flagged prints are excluded from the baseline so one whale cannot
 *      normalise the next.
 *
 *   2. Clusters. Institutions slice parent orders, so each child can look
 *      unremarkable. Elevated same-side prints in one symbol are chained while
 *      they arrive within the cluster window; once a chain has enough prints and
 *      enough combined size it is reported as a SWEEP and keeps growing as more
 *      children land.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DetectorConfig {
	/** z-score of log size above which a single print is a block. */
	zThreshold: number;
	/** Slippage (bps) that marks a moderately large print as a block. */
	slippageBps: number;
	/** Max gap between chained prints, ms. */
	clusterWindowMs: number;
	/** Prints needed before a chain is reported. */
	clusterMinPrints: number;
	/** Combined size needed, as a multiple of the symbol's typical print. */
	clusterMultiple: number;
	/** z-score a print needs to join a chain. */
	clusterMemberZ: number;
	/** Prints per symbol before detection switches on. */
	warmup: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
	zThreshold: 3.2,
	slippageBps: 2.5,
	clusterWindowMs: 900,
	clusterMinPrints: 3,
	clusterMultiple: 22,
	clusterMemberZ: 1.25,
	warmup: 25
};

export interface BlockDeal {
	id: string;
	kind: 'BLOCK' | 'SWEEP';
	symbol: string;
	side: Side;
	qty: number;
	notional: number;
	vwap: number;
	/** Worst slippage among member prints, bps. */
	slippageBps: number;
	prints: number;
	startTs: number;
	endTs: number;
	/** Size z-score: the print's own for a block, the aggregate's for a sweep. */
	score: number;
	tradeIds: number[];
}

export interface Detection {
	/** z-score of this print's size against its symbol baseline. */
	z: number;
	/** Block created or extended by this print, if any. */
	block: BlockDeal | null;
	isNew: boolean;
}

interface Baseline {
	n: number;
	mean: number;
	variance: number;
}

interface Chain {
	members: Trade[];
	lastTs: number;
	block: BlockDeal | null;
}

const ALPHA = 0.03;
const MIN_SIGMA = 0.35;

export class BlockDetector {
	config: DetectorConfig;
	private baselines = new Map<string, Baseline>();
	private chains = new Map<string, Chain>();
	private seq = 0;

	constructor(config: Partial<DetectorConfig> = {}) {
		this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
	}

	private aggregate(block: BlockDeal, members: Trade[], sigma: number, mean: number) {
		let qty = 0;
		let notional = 0;
		let slip = 0;
		for (const m of members) {
			qty += m.qty;
			notional += m.notional;
			slip = Math.max(slip, m.slippageBps);
		}
		block.qty = qty;
		block.notional = notional;
		block.vwap = notional / qty;
		block.slippageBps = slip;
		block.prints = members.length;
		block.startTs = members[0].ts;
		block.endTs = members[members.length - 1].ts;
		block.score = (Math.log(qty) - mean) / sigma;
		block.tradeIds = members.map((m) => m.id);
	}

	ingest(trade: Trade): Detection {
		const cfg = this.config;
		const logQty = Math.log(Math.max(1, trade.qty));
		let base = this.baselines.get(trade.symbol);
		if (!base) {
			base = { n: 0, mean: logQty, variance: 0.81 };
			this.baselines.set(trade.symbol, base);
		}
		const sigma = Math.max(MIN_SIGMA, Math.sqrt(base.variance));
		const z = (logQty - base.mean) / sigma;
		const warm = base.n >= cfg.warmup;

		const isOutlier = warm && (z >= cfg.zThreshold || (z >= cfg.zThreshold * 0.6 && trade.slippageBps >= cfg.slippageBps));

		// Baseline learns from ordinary flow only (and from everything during warm-up,
		// with early samples weighted more heavily so it converges quickly).
		if (!isOutlier && (!warm || z < cfg.zThreshold * 0.8)) {
			const alpha = base.n < cfg.warmup ? Math.max(ALPHA, 1 / (base.n + 1)) : ALPHA;
			const delta = logQty - base.mean;
			base.mean += alpha * delta;
			base.variance = (1 - alpha) * (base.variance + alpha * delta * delta);
		}
		base.n++;

		if (!warm) return { z, block: null, isNew: false };

		if (isOutlier) {
			const block: BlockDeal = {
				id: `blk-${++this.seq}`,
				kind: 'BLOCK',
				symbol: trade.symbol,
				side: trade.side,
				qty: trade.qty,
				notional: trade.notional,
				vwap: trade.price,
				slippageBps: trade.slippageBps,
				prints: 1,
				startTs: trade.ts,
				endTs: trade.ts,
				score: z,
				tradeIds: [trade.id]
			};
			return { z, block, isNew: true };
		}

		// ── cluster rule ──
		if (z < cfg.clusterMemberZ) return { z, block: null, isNew: false };

		const key = `${trade.symbol}|${trade.side}`;
		let chain = this.chains.get(key);
		if (!chain || trade.ts - chain.lastTs > cfg.clusterWindowMs) {
			chain = { members: [], lastTs: trade.ts, block: null };
			this.chains.set(key, chain);
		}
		chain.members.push(trade);
		chain.lastTs = trade.ts;

		if (chain.block) {
			this.aggregate(chain.block, chain.members, sigma, base.mean);
			return { z, block: chain.block, isNew: false };
		}

		const combined = chain.members.reduce((s, m) => s + m.qty, 0);
		if (chain.members.length >= cfg.clusterMinPrints && combined >= cfg.clusterMultiple * Math.exp(base.mean)) {
			const block: BlockDeal = {
				id: `swp-${++this.seq}`,
				kind: 'SWEEP',
				symbol: trade.symbol,
				side: trade.side,
				qty: 0,
				notional: 0,
				vwap: 0,
				slippageBps: 0,
				prints: 0,
				startTs: 0,
				endTs: 0,
				score: 0,
				tradeIds: []
			};
			this.aggregate(block, chain.members, sigma, base.mean);
			chain.block = block;
			return { z, block, isNew: true };
		}
		return { z, block: null, isNew: false };
	}
}

/* ── scoring against simulator ground truth ───────────────────────────────── */

export interface DetectionScore {
	injected: number;
	caught: number;
	reported: number;
	genuine: number;
	recall: number;
	precision: number;
}

/**
 * Tracks how the detector is doing against the simulator's hidden labels.
 * An injected order counts as caught when any reported block contains one of its
 * prints; a reported block is genuine when it contains at least one injected print.
 */
export class Scorekeeper {
	private injected = new Set<number>();
	private caught = new Set<number>();
	private parentOfTrade = new Map<number, number>();
	private blockGenuine = new Map<string, boolean>();

	observe(trade: Trade) {
		if (trade.parentId !== null) {
			this.injected.add(trade.parentId);
			this.parentOfTrade.set(trade.id, trade.parentId);
			if (this.parentOfTrade.size > 4000) {
				// bounded memory: forget the oldest labels
				const drop = this.parentOfTrade.keys().next().value;
				if (drop !== undefined) this.parentOfTrade.delete(drop);
			}
		}
	}

	report(block: BlockDeal) {
		let genuine = false;
		for (const id of block.tradeIds) {
			const parent = this.parentOfTrade.get(id);
			if (parent !== undefined) {
				genuine = true;
				this.caught.add(parent);
			}
		}
		this.blockGenuine.set(block.id, genuine || (this.blockGenuine.get(block.id) ?? false));
	}

	score(): DetectionScore {
		const reported = this.blockGenuine.size;
		let genuine = 0;
		this.blockGenuine.forEach((g) => {
			if (g) genuine++;
		});
		return {
			injected: this.injected.size,
			caught: this.caught.size,
			reported,
			genuine,
			recall: this.injected.size ? this.caught.size / this.injected.size : 1,
			precision: reported ? genuine / reported : 1
		};
	}
}

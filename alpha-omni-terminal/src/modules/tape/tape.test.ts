import { describe, expect, it } from 'vitest';
import { generateInstruments } from '@/data/generators';
import { BlockDetector, Scorekeeper } from './detector';
import { TapeSimulator } from './simulator';

const instruments = generateInstruments(20261114);

function run(seconds: number, seed: number, config = {}) {
	const sim = new TapeSimulator(instruments, seed);
	const detector = new BlockDetector(config);
	const score = new Scorekeeper();
	let prints = 0;
	const blocks = new Map<string, { kind: string; prints: number }>();
	for (let t = 0; t < seconds * 10; t++) {
		for (const trade of sim.step(100)) {
			prints++;
			score.observe(trade);
			const d = detector.ingest(trade);
			if (d.block) {
				score.report(d.block);
				blocks.set(d.block.id, { kind: d.block.kind, prints: d.block.prints });
			}
		}
	}
	return { sim, prints, blocks, score: score.score() };
}

describe('tape simulator', () => {
	it('streams prints with sane microstructure', () => {
		const sim = new TapeSimulator(instruments, 5);
		let last = -Infinity;
		let count = 0;
		for (let i = 0; i < 300; i++) {
			for (const t of sim.step(100)) {
				count++;
				expect(t.ts).toBeGreaterThanOrEqual(last);
				last = t.ts;
				expect(t.qty).toBeGreaterThan(0);
				expect(Number.isFinite(t.price)).toBe(true);
				expect(t.notional).toBeCloseTo(t.price * t.qty, 6);
				expect(t.slippageBps).toBeGreaterThan(0); // aggressors always pay at least half the spread
			}
		}
		// ~1.5 prints/s per symbol over 30 s
		expect(count).toBeGreaterThan(instruments.length * 30);
		expect(count).toBeLessThan(instruments.length * 30 * 3);
	});

	it('keeps a coherent, uncrossed book', () => {
		const sim = new TapeSimulator(instruments, 9);
		for (let i = 0; i < 200; i++) sim.step(100);
		for (const symbol of sim.symbols) {
			const book = sim.book(symbol)!;
			expect(book.bids).toHaveLength(10);
			expect(book.asks).toHaveLength(10);
			expect(book.asks[0].price).toBeGreaterThan(book.bids[0].price);
			for (let i = 1; i < 10; i++) {
				expect(book.bids[i].price).toBeLessThan(book.bids[i - 1].price);
				expect(book.asks[i].price).toBeGreaterThan(book.asks[i - 1].price);
			}
		}
	});

	it('is reproducible from its seed', () => {
		const a = new TapeSimulator(instruments, 77);
		const b = new TapeSimulator(instruments, 77);
		for (let i = 0; i < 50; i++) expect(a.step(100)).toEqual(b.step(100));
	});
});

describe('block-deal detector', () => {
	it('recovers injected institutional orders with high recall and precision', () => {
		for (const seed of [1, 2, 3]) {
			const { score } = run(600, seed);
			expect(score.injected).toBeGreaterThan(60);
			expect(score.recall).toBeGreaterThan(0.85);
			expect(score.precision).toBeGreaterThan(0.85);
		}
	});

	it('reports both single blocks and clustered sweeps', () => {
		const { blocks } = run(300, 4);
		const kinds = [...blocks.values()];
		expect(kinds.some((b) => b.kind === 'BLOCK')).toBe(true);
		const sweeps = kinds.filter((b) => b.kind === 'SWEEP');
		expect(sweeps.length).toBeGreaterThan(0);
		for (const s of sweeps) expect(s.prints).toBeGreaterThanOrEqual(3);
	});

	it('stays quiet on ordinary flow with no institutions present', () => {
		const sim = new TapeSimulator(instruments, 11, 0, { blockRate: 0 });
		const detector = new BlockDetector();
		let prints = 0;
		let flagged = 0;
		for (let t = 0; t < 6000; t++) {
			for (const trade of sim.step(100)) {
				prints++;
				if (detector.ingest(trade).isNew) flagged++;
			}
		}
		expect(prints).toBeGreaterThan(5000);
		expect(flagged / prints).toBeLessThan(0.004);
	});

	it('flags more as sensitivity rises', () => {
		const strict = run(300, 6, { zThreshold: 4.2 }).blocks.size;
		const loose = run(300, 6, { zThreshold: 2.4 }).blocks.size;
		expect(loose).toBeGreaterThan(strict);
	});
});

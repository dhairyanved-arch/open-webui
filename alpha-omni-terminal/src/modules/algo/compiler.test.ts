import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { generateAlgoTemplates } from '@/data/generators';
import { compileGraph, type GraphEdge, type GraphNode } from './compiler';
import { NODE_DEFS, defaultParams } from './nodeCatalog';

const templates = generateAlgoTemplates(20261114);
const fade = templates[0];

const hasPandas = spawnSync('python3', ['-c', 'import pandas, numpy'], { encoding: 'utf8' }).status === 0;

function runPython(source: string) {
	return spawnSync('python3', ['-'], { input: source, encoding: 'utf8', timeout: 60_000 });
}

/** A graph that uses every node type in the catalogue at least once. */
function kitchenSink(): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const nodes: GraphNode[] = [{ id: 'md', type: 'market_data', params: { symbol: 'SBIN', timeframe: '5m' }, position: { x: 0, y: 0 } }];
	const edges: GraphEdge[] = [];
	const indicators = NODE_DEFS.filter((d) => d.category === 'indicator');
	indicators.forEach((def, i) => {
		nodes.push({ id: `i${i}`, type: def.type, params: defaultParams(def.type), position: { x: 200, y: i * 80 } });
		edges.push({ source: 'md', sourceHandle: 'data', target: `i${i}`, targetHandle: 'data' });
	});
	// fold all indicators together with alternating AND / OR, then negate one branch
	let prev = 'i0';
	indicators.slice(1).forEach((_, k) => {
		const id = `g${k}`;
		nodes.push({ id, type: k % 2 ? 'or' : 'and', params: {}, position: { x: 400, y: k * 80 } });
		edges.push({ source: prev, sourceHandle: 'signal', target: id, targetHandle: 'a' });
		edges.push({ source: `i${k + 1}`, sourceHandle: 'signal', target: id, targetHandle: 'b' });
		prev = id;
	});
	nodes.push({ id: 'neg', type: 'not', params: {}, position: { x: 600, y: 0 } });
	edges.push({ source: 'i0', sourceHandle: 'signal', target: 'neg', targetHandle: 'in' });
	const actions: Array<[string, string, string]> = [
		['a1', 'enter_long', prev],
		['a2', 'enter_short', 'i1'],
		['a3', 'exit_position', 'neg'],
		['a4', 'alert', 'i2']
	];
	actions.forEach(([id, type, src], k) => {
		nodes.push({ id, type, params: defaultParams(type), position: { x: 800, y: k * 100 } });
		edges.push({ source: src, sourceHandle: 'signal', target: id, targetHandle: 'trigger' });
	});
	return { nodes, edges };
}

describe('graph compiler', () => {
	it('compiles the starter template into the expected rules', () => {
		const out = compileGraph(fade.name, fade.nodes, fade.edges);
		expect(out.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
		expect(out.rules.map((r) => r.action)).toEqual(['ENTER_SHORT', 'EXIT']);
		expect(out.rules[0].when).toBe('RSI(14) > 70 AND Volume > 2× SMA(20)');
		expect(out.rules[1].when).toBe('RSI(14) < 45');
		expect(out.python).toContain('rsi_1 = rsi(');
		expect(out.python).toContain('and_1 = rsi_1 & volume_spike_1');
	});

	it('emits JSON that round-trips and mirrors the canvas', () => {
		const out = compileGraph(fade.name, fade.nodes, fade.edges);
		const spec = JSON.parse(out.json);
		expect(spec.schema).toBe('aot.strategy/v1');
		expect(spec.graph.nodes).toHaveLength(fade.nodes.length);
		expect(spec.graph.edges).toHaveLength(fade.edges.length);
		expect(spec.rules[0].condition.op).toBe('AND');
		expect(spec.rules[0].stop_loss_pct).toBe(0.8);
	});

	it('reflects a parameter edit immediately', () => {
		const edited = fade.nodes.map((n) => (n.id === 'n2' ? { ...n, params: { ...n.params, threshold: 82 } } : n));
		const out = compileGraph(fade.name, edited, fade.edges);
		expect(out.rules[0].when).toContain('RSI(14) > 82');
		expect(out.python).toContain('> 82');
		expect(JSON.parse(out.json).rules[0].when).toContain('82');
	});

	it('only ships the helper functions a graph actually uses', () => {
		const out = compileGraph(fade.name, fade.nodes, fade.edges);
		expect(out.python).toContain('def rsi(');
		expect(out.python).not.toContain('def macd(');
		expect(out.python).not.toContain('def vwap(');
	});

	it('degrades gracefully on a half-wired graph', () => {
		const nodes: GraphNode[] = [
			{ id: 'a', type: 'rsi', params: defaultParams('rsi') },
			{ id: 'b', type: 'and', params: {} },
			{ id: 'c', type: 'enter_long', params: defaultParams('enter_long') },
			{ id: 'd', type: 'alert', params: defaultParams('alert') }
		];
		const edges: GraphEdge[] = [
			{ source: 'a', sourceHandle: 'signal', target: 'b', targetHandle: 'a' },
			{ source: 'b', sourceHandle: 'signal', target: 'c', targetHandle: 'trigger' }
		];
		const out = compileGraph('WIP', nodes, edges);
		const levels = out.diagnostics.map((d) => d.level);
		expect(levels).toContain('error'); // RSI has no market data
		expect(levels).toContain('warning'); // AND.b and Alert unwired
		expect(out.rules).toHaveLength(2);
		expect(() => JSON.parse(out.json)).not.toThrow();
	});

	it('reports a cycle instead of recursing forever', () => {
		const nodes: GraphNode[] = [
			{ id: 'x', type: 'and', params: {} },
			{ id: 'y', type: 'or', params: {} },
			{ id: 'z', type: 'enter_long', params: defaultParams('enter_long') }
		];
		const edges: GraphEdge[] = [
			{ source: 'x', sourceHandle: 'signal', target: 'y', targetHandle: 'a' },
			{ source: 'y', sourceHandle: 'signal', target: 'x', targetHandle: 'a' },
			{ source: 'y', sourceHandle: 'signal', target: 'z', targetHandle: 'trigger' }
		];
		const out = compileGraph('Loop', nodes, edges);
		expect(out.diagnostics.some((d) => d.level === 'error' && d.message.includes('loop'))).toBe(true);
	});

	it('compiles an empty canvas to a valid, rule-less script', () => {
		const out = compileGraph('Blank', [], []);
		expect(out.rules).toEqual([]);
		expect(out.diagnostics).toEqual([]);
		expect(JSON.parse(out.json).rules).toEqual([]);
	});
});

describe.skipIf(!hasPandas)('generated Python actually runs', () => {
	const cases: Array<[string, GraphNode[], GraphEdge[]]> = [
		...templates.map((t) => [t.name, t.nodes, t.edges] as [string, GraphNode[], GraphEdge[]]),
		['Kitchen sink (every node type)', kitchenSink().nodes, kitchenSink().edges],
		['Half-wired', [{ id: 'a', type: 'rsi', params: defaultParams('rsi') }, { id: 'c', type: 'enter_long', params: defaultParams('enter_long') }], [{ source: 'a', sourceHandle: 'signal', target: 'c', targetHandle: 'trigger' }]],
		['Blank', [], []]
	];
	for (const [name, nodes, edges] of cases) {
		it(`executes end to end: ${name}`, () => {
			const { python } = compileGraph(name, nodes, edges);
			const run = runPython(python);
			expect(run.stderr).toBe('');
			expect(run.status).toBe(0);
			expect(run.stdout).toContain(name);
			expect(run.stdout).toContain('trades');
		}, 90_000);
	}
});

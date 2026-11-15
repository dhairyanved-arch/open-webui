import { create } from 'zustand';
import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	type Connection,
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
	type XYPosition
} from '@xyflow/react';
import type { AlgoTemplate } from '@/data/generators';
import { NODE_DEF_BY_TYPE, PORT_COLOR, defaultParams, portType, type ParamValue, type Params } from './nodeCatalog';

export type StrategyNodeData = { kind: string; params: Params };
export type StrategyFlowNode = Node<StrategyNodeData, 'strategy'>;

interface AlgoState {
	name: string;
	/** Mock-universe seed the current graph was loaded from (null until first load). */
	sourceSeed: number | null;
	nodes: StrategyFlowNode[];
	edges: Edge[];
	setName: (name: string) => void;
	onNodesChange: (changes: NodeChange<StrategyFlowNode>[]) => void;
	onEdgesChange: (changes: EdgeChange[]) => void;
	onConnect: (connection: Connection) => void;
	addNode: (kind: string, position: XYPosition) => string;
	updateParam: (nodeId: string, key: string, value: ParamValue) => void;
	removeNode: (nodeId: string) => void;
	loadTemplate: (template: AlgoTemplate, seed: number) => void;
	clear: () => void;
}

/** Wires are coloured by what flows through them; signal wires animate. */
function decorateEdge<T extends { source: string; sourceHandle?: string | null }>(edge: T, nodes: StrategyFlowNode[]): T & Partial<Edge> {
	const source = nodes.find((n) => n.id === edge.source);
	const type = source ? portType(source.data.kind, edge.sourceHandle, 'source') : null;
	const color = type ? PORT_COLOR[type] : '#888';
	return {
		...edge,
		animated: type === 'signal',
		style: { stroke: color, strokeOpacity: 0.85 }
	};
}

function nextId(nodes: StrategyFlowNode[]) {
	let max = 0;
	for (const n of nodes) {
		const m = /^n(\d+)$/.exec(n.id);
		if (m) max = Math.max(max, Number(m[1]));
	}
	return `n${max + 1}`;
}

export const useAlgoStore = create<AlgoState>((set, get) => ({
	name: 'Untitled strategy',
	sourceSeed: null,
	nodes: [],
	edges: [],

	setName: (name) => set({ name }),

	onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),

	onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

	onConnect: (connection) => {
		const { nodes, edges } = get();
		// An input accepts a single wire: a new connection replaces the old one.
		const pruned = edges.filter((e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle));
		set({ edges: addEdge(decorateEdge({ ...connection, id: `e-${connection.source}-${connection.target}-${connection.targetHandle}` }, nodes), pruned) });
	},

	addNode: (kind, position) => {
		const id = nextId(get().nodes);
		if (!NODE_DEF_BY_TYPE[kind]) return id;
		const node: StrategyFlowNode = { id, type: 'strategy', position, data: { kind, params: defaultParams(kind) } };
		set({ nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }] });
		return id;
	},

	updateParam: (nodeId, key, value) =>
		set({
			nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n))
		}),

	removeNode: (nodeId) =>
		set({
			nodes: get().nodes.filter((n) => n.id !== nodeId),
			edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
		}),

	loadTemplate: (template, seed) => {
		const nodes: StrategyFlowNode[] = template.nodes.map((n) => ({
			id: n.id,
			type: 'strategy',
			position: { ...n.position },
			data: { kind: n.type, params: { ...defaultParams(n.type), ...n.params } }
		}));
		const edges: Edge[] = template.edges.map((e) => decorateEdge({ ...e }, nodes));
		set({ name: template.name, sourceSeed: seed, nodes, edges });
	},

	clear: () => set({ nodes: [], edges: [], name: 'Untitled strategy' })
}));

/** Would wiring source → target close a loop? (target already reaches source) */
export function createsCycle(edges: Edge[], source: string, target: string): boolean {
	if (source === target) return true;
	const out = new Map<string, string[]>();
	for (const e of edges) {
		const list = out.get(e.source);
		if (list) list.push(e.target);
		else out.set(e.source, [e.target]);
	}
	const stack = [target];
	const seen = new Set<string>();
	while (stack.length) {
		const id = stack.pop()!;
		if (id === source) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const next of out.get(id) ?? []) stack.push(next);
	}
	return false;
}

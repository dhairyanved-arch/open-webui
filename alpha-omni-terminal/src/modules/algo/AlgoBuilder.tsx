import * as React from 'react';
import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Connection,
	type Edge,
	type IsValidConnection
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Braces, Check, CircleAlert, CircleCheck, Copy, Eraser, FileCode2, GripVertical, Info, TriangleAlert } from 'lucide-react';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { ModuleHeader } from '@/components/fx/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMockData } from '@/context/MockDataContext';
import { cn } from '@/lib/utils';
import { CodeView } from './CodeView';
import { StrategyNode } from './StrategyNode';
import { compileGraph, type Diagnostic } from './compiler';
import { CATEGORY_META, NODE_DEFS, NODE_DEF_BY_TYPE, portType, type NodeCategory } from './nodeCatalog';
import { createsCycle, useAlgoStore, type StrategyFlowNode } from './store';

const DND_MIME = 'application/x-aot-node';
const nodeTypes = { strategy: StrategyNode };
const CATEGORY_ORDER: NodeCategory[] = ['source', 'indicator', 'logic', 'action'];

/* ── palette ──────────────────────────────────────────────────────────────── */

function Palette({ onAdd }: { onAdd: (kind: string) => void }) {
	return (
		<div className="thin-scroll flex h-full flex-col gap-3 overflow-y-auto px-3 pb-3">
			{CATEGORY_ORDER.map((category) => {
				const meta = CATEGORY_META[category];
				return (
					<div key={category}>
						<div className="mb-1.5 flex items-baseline justify-between">
							<span className="kicker" style={{ color: meta.color }}>
								{meta.label}
							</span>
							<span className="text-[9.5px] text-muted-foreground/70">{meta.description}</span>
						</div>
						<div className="flex flex-col gap-1">
							{NODE_DEFS.filter((d) => d.category === category).map((def) => {
								const Icon = def.icon;
								return (
									<button
										key={def.type}
										type="button"
										draggable
										data-testid={`palette-${def.type}`}
										onDragStart={(event) => {
											event.dataTransfer.setData(DND_MIME, def.type);
											event.dataTransfer.effectAllowed = 'move';
										}}
										onClick={() => onAdd(def.type)}
										title={`${def.blurb} — drag onto the canvas or click to add`}
										className="group flex cursor-grab items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5 text-left transition-colors outline-none hover:border-white/20 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
									>
										<span
											className="grid size-6 shrink-0 place-items-center rounded-md"
											style={{ background: `${meta.color}1f`, color: meta.color }}
										>
											<Icon className="size-3.5" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[12px] leading-tight font-medium text-foreground">{def.title}</span>
											<span className="block truncate text-[10px] leading-tight text-muted-foreground">{def.blurb}</span>
										</span>
										<GripVertical className="size-3.5 shrink-0 text-white/15 transition-colors group-hover:text-white/40" />
									</button>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/* ── diagnostics ──────────────────────────────────────────────────────────── */

const DIAG_STYLE: Record<Diagnostic['level'], { icon: typeof Info; cls: string }> = {
	error: { icon: CircleAlert, cls: 'text-bear' },
	warning: { icon: TriangleAlert, cls: 'text-primary' },
	info: { icon: Info, cls: 'text-muted-foreground' }
};

function Diagnostics({ items, onFocus }: { items: Diagnostic[]; onFocus: (nodeId: string) => void }) {
	if (items.length === 0) {
		return (
			<div className="flex items-center gap-2 px-4 py-2.5 text-[11.5px] text-bull">
				<CircleCheck className="size-3.5" /> Graph is fully wired — every action has a complete condition.
			</div>
		);
	}
	return (
		<ul className="thin-scroll max-h-28 overflow-y-auto px-2 py-1.5">
			{items.map((d, i) => {
				const { icon: Icon, cls } = DIAG_STYLE[d.level];
				return (
					<li key={i}>
						<button
							type="button"
							disabled={!d.nodeId}
							onClick={() => d.nodeId && onFocus(d.nodeId)}
							className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[11.5px] leading-snug text-foreground/85 outline-none enabled:hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							<Icon className={cn('mt-0.5 size-3.5 shrink-0', cls)} />
							<span>{d.message}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/* ── workspace ────────────────────────────────────────────────────────────── */

function Workspace() {
	const { universe, seed } = useMockData();
	const nodes = useAlgoStore((s) => s.nodes);
	const edges = useAlgoStore((s) => s.edges);
	const name = useAlgoStore((s) => s.name);
	const sourceSeed = useAlgoStore((s) => s.sourceSeed);
	const { onNodesChange, onEdgesChange, onConnect, addNode, loadTemplate, clear, setName } = useAlgoStore.getState();

	const flow = useReactFlow<StrategyFlowNode, Edge>();
	const canvasRef = React.useRef<HTMLDivElement>(null);
	const [tab, setTab] = React.useState<'python' | 'json'>('python');
	const [copied, setCopied] = React.useState(false);
	const [activeTemplate, setActiveTemplate] = React.useState(universe.algoTemplates[0].id);

	// First visit (or a reseed of the mock universe) loads the starter graph. The
	// graph lives in a store, so it survives navigating to other modules and back.
	React.useEffect(() => {
		if (sourceSeed !== seed) {
			loadTemplate(universe.algoTemplates[0], seed);
			setActiveTemplate(universe.algoTemplates[0].id);
			requestAnimationFrame(() => flow.fitView({ padding: 0.07, duration: 300 }));
		}
	}, [seed, sourceSeed, universe, loadTemplate, flow]);

	// Compile on every change. Deferred so dragging a node stays at full frame rate.
	const graph = React.useMemo(
		() => ({
			nodes: nodes.map((n) => ({ id: n.id, type: n.data.kind, params: n.data.params, position: n.position })),
			edges: edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle }))
		}),
		[nodes, edges]
	);
	const deferredGraph = React.useDeferredValue(graph);
	const compiled = React.useMemo(() => compileGraph(name, deferredGraph.nodes, deferredGraph.edges), [name, deferredGraph]);

	const isValidConnection = React.useCallback<IsValidConnection<Edge>>((candidate: Connection | Edge) => {
		const state = useAlgoStore.getState();
		const source = state.nodes.find((n) => n.id === candidate.source);
		const target = state.nodes.find((n) => n.id === candidate.target);
		if (!source || !target || source.id === target.id) return false;
		const out = portType(source.data.kind, candidate.sourceHandle, 'source');
		const into = portType(target.data.kind, candidate.targetHandle, 'target');
		if (!out || out !== into) return false;
		return !createsCycle(state.edges, source.id, target.id);
	}, []);

	const onDrop = (event: React.DragEvent) => {
		const kind = event.dataTransfer.getData(DND_MIME);
		if (!kind || !NODE_DEF_BY_TYPE[kind]) return;
		event.preventDefault();
		const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
		addNode(kind, { x: position.x - 114, y: position.y - 24 });
	};

	const addAtCentre = (kind: string) => {
		const rect = canvasRef.current?.getBoundingClientRect();
		if (!rect) return;
		const jitter = (nodes.length % 5) * 26;
		const centre = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
		addNode(kind, { x: centre.x - 114 + jitter, y: centre.y - 80 + jitter });
	};

	const focusNode = (nodeId: string) => {
		const node = flow.getNode(nodeId);
		if (!node) return;
		flow.setCenter(node.position.x + 114, node.position.y + 80, { zoom: 1.1, duration: 400 });
		onNodesChange(nodes.map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === nodeId })));
	};

	const source = tab === 'python' ? compiled.python : compiled.json;
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(source);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		} catch {
			setCopied(false);
		}
	};

	const errors = compiled.diagnostics.filter((d) => d.level === 'error').length;
	const warnings = compiled.diagnostics.filter((d) => d.level === 'warning').length;

	return (
		<div className="flex h-full flex-col gap-4 p-5">
			<ModuleHeader
				index="03"
				domain="Systematic"
				title="Node-Based Algo Builder"
				lede="Drag conditions onto the infinite canvas and wire them into actions. The graph compiles on every edit into a strategy spec and a runnable pandas backtest — no code written by hand."
				actions={
					<>
						{universe.algoTemplates.map((t) => (
							<Button
								key={t.id}
								variant={activeTemplate === t.id ? 'accent' : 'outline'}
								size="sm"
								title={t.description}
								onClick={() => {
									loadTemplate(t, seed);
									setActiveTemplate(t.id);
									requestAnimationFrame(() => flow.fitView({ padding: 0.07, duration: 300 }));
								}}
							>
								{t.name}
							</Button>
						))}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								clear();
								setActiveTemplate('');
							}}
						>
							<Eraser /> Clear
						</Button>
					</>
				}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[212px_minmax(0,1fr)_minmax(340px,28%)]">
				<GlassPanel kicker="Palette" title="Logic nodes" flush still className="max-xl:h-64">
					<Palette onAdd={addAtCentre} />
				</GlassPanel>

				<GlassPanel flush still className="relative min-h-[420px] overflow-hidden">
					<div ref={canvasRef} className="absolute inset-0" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))} onDrop={onDrop}>
						<ReactFlow<StrategyFlowNode, Edge>
							colorMode="dark"
							nodes={nodes}
							edges={edges}
							nodeTypes={nodeTypes}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							isValidConnection={isValidConnection}
							fitView
							fitViewOptions={{ padding: 0.07 }}
							minZoom={0.15}
							maxZoom={2}
							deleteKeyCode={['Backspace', 'Delete']}
							connectionRadius={28}
							defaultEdgeOptions={{ type: 'default' }}
						>
							<Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(255 255 255 / 0.13)" />
							<Controls showInteractive={false} position="bottom-left" />
							<MiniMap
								pannable
								zoomable
								position="bottom-right"
								style={{ width: 150, height: 96 }}
								nodeColor={(n) => CATEGORY_META[NODE_DEF_BY_TYPE[(n as StrategyFlowNode).data.kind]?.category ?? 'logic'].color}
								nodeStrokeWidth={0}
								nodeBorderRadius={6}
							/>
						</ReactFlow>
					</div>

					<div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
						<div className="hud pointer-events-auto flex items-center gap-2 rounded-lg py-1 pr-1 pl-3">
							<span className="kicker">Strategy</span>
							<Input
								aria-label="Strategy name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="h-7 w-52 border-transparent bg-transparent font-sans text-[13px] font-medium shadow-none"
							/>
						</div>
						<div className="hud flex items-center gap-3 rounded-lg px-3 py-1.5 text-[10.5px] text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<span className="inline-block h-0.5 w-4 rounded-full bg-accent" /> bars
							</span>
							<span className="flex items-center gap-1.5">
								<span className="inline-block h-0.5 w-4 rounded-full bg-primary" /> signal
							</span>
						</div>
					</div>

					{nodes.length === 0 && (
						<div className="pointer-events-none absolute inset-0 grid place-items-center">
							<div className="max-w-xs text-center">
								<div className="font-serif text-2xl text-foreground/90 italic">An empty canvas</div>
								<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Drag a Market Data node in from the palette, wire it into a condition, then into an action. Or load
									one of the starter strategies above.
								</p>
							</div>
						</div>
					)}
				</GlassPanel>

				<GlassPanel
					flush
					still
					className="min-h-[420px] overflow-hidden"
					kicker="Compiled output"
					title="Live script"
					actions={
						errors > 0 ? (
							<Badge variant="bear">
								{errors} error{errors === 1 ? '' : 's'}
							</Badge>
						) : warnings > 0 ? (
							<Badge variant="primary">
								{warnings} warning{warnings === 1 ? '' : 's'}
							</Badge>
						) : (
							<Badge variant="bull">valid</Badge>
						)
					}
					bodyClassName="flex flex-col"
				>
					<div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2.5">
						<Tabs value={tab} onValueChange={(v) => setTab(v as 'python' | 'json')}>
							<TabsList>
								<TabsTrigger value="python">
									<FileCode2 /> Python
								</TabsTrigger>
								<TabsTrigger value="json">
									<Braces /> JSON
								</TabsTrigger>
							</TabsList>
						</Tabs>
						<div className="flex items-center gap-2">
							<span className="num text-[10.5px] whitespace-nowrap text-muted-foreground">
								{compiled.rules.length} rule{compiled.rules.length === 1 ? '' : 's'} · {source.split('\n').length} lines
							</span>
							<Button variant="outline" size="icon-sm" onClick={copy} aria-label="Copy output to clipboard">
								{copied ? <Check className="text-bull" /> : <Copy />}
							</Button>
						</div>
					</div>
					{compiled.rules.length > 0 && (
						<div className="thin-scroll max-h-24 shrink-0 overflow-y-auto border-y border-white/[0.06] bg-black/20 px-4 py-2">
							{compiled.rules.map((r) => (
								<div key={r.id} className="num flex gap-2 py-0.5 text-[11px] leading-snug">
									<span
										className={cn(
											'shrink-0 font-medium',
											r.action === 'ENTER_LONG' ? 'text-bull' : r.action === 'ENTER_SHORT' ? 'text-bear' : 'text-accent'
										)}
									>
										{r.action}
									</span>
									<span className="text-muted-foreground">when</span>
									<span className="text-foreground/90">{r.when}</span>
								</div>
							))}
						</div>
					)}
					<div className="min-h-0 flex-1">
						<CodeView source={source} language={tab} />
					</div>
					<div className="shrink-0 border-t border-white/[0.06]">
						<Diagnostics items={compiled.diagnostics} onFocus={focusNode} />
					</div>
				</GlassPanel>
			</div>
		</div>
	);
}

export default function AlgoBuilder() {
	return (
		<ReactFlowProvider>
			<Workspace />
		</ReactFlowProvider>
	);
}

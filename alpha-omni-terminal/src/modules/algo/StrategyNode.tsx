import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_META, NODE_DEF_BY_TYPE, PORT_COLOR, type ParamDef, type ParamValue, type PortDef } from './nodeCatalog';
import { useAlgoStore, type StrategyFlowNode } from './store';

const fieldClass =
	'nodrag num h-7 w-full min-w-0 rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20';

function ParamField({ nodeId, def, value }: { nodeId: string; def: ParamDef; value: ParamValue }) {
	const updateParam = useAlgoStore((s) => s.updateParam);
	const id = `${nodeId}-${def.key}`;
	return (
		<label htmlFor={id} className={cn('flex min-w-0 flex-col gap-0.5', def.wide && 'col-span-2')}>
			<span className="text-[9.5px] tracking-wide text-muted-foreground uppercase">{def.label}</span>
			{def.kind === 'select' ? (
				<select
					id={id}
					aria-label={def.label}
					className={cn(fieldClass, 'cursor-pointer appearance-none pr-1')}
					value={String(value)}
					onChange={(e) => updateParam(nodeId, def.key, e.target.value)}
				>
					{def.options?.map((o) => (
						<option key={o.value} value={o.value} className="bg-[#0c1017]">
							{o.label}
						</option>
					))}
				</select>
			) : def.kind === 'number' ? (
				<input
					id={id}
					aria-label={def.label}
					type="number"
					className={fieldClass}
					value={String(value)}
					min={def.min}
					max={def.max}
					step={def.step}
					onChange={(e) => {
						const raw = e.target.value;
						updateParam(nodeId, def.key, raw === '' || Number.isNaN(Number(raw)) ? raw : Number(raw));
					}}
				/>
			) : (
				<input
					id={id}
					aria-label={def.label}
					type="text"
					spellCheck={false}
					className={fieldClass}
					value={String(value)}
					onChange={(e) => updateParam(nodeId, def.key, e.target.value)}
				/>
			)}
		</label>
	);
}

function PortRow({ input, output }: { input?: PortDef; output?: PortDef }) {
	return (
		<div className="relative flex h-6 items-center justify-between px-3 text-[10px] text-muted-foreground">
			<span>
				{input && (
					<>
						<Handle
							type="target"
							position={Position.Left}
							id={input.id}
							style={{ borderColor: PORT_COLOR[input.type] }}
							aria-label={`${input.label} input`}
						/>
						{input.label}
					</>
				)}
			</span>
			<span>
				{output && (
					<>
						{output.label}
						<Handle
							type="source"
							position={Position.Right}
							id={output.id}
							style={{ borderColor: PORT_COLOR[output.type], background: PORT_COLOR[output.type] }}
							aria-label={`${output.label} output`}
						/>
					</>
				)}
			</span>
		</div>
	);
}

function StrategyNodeView({ id, data, selected }: NodeProps<StrategyFlowNode>) {
	const removeNode = useAlgoStore((s) => s.removeNode);
	const def = NODE_DEF_BY_TYPE[data.kind];
	if (!def) return null;
	const meta = CATEGORY_META[def.category];
	const Icon = def.icon;
	const rows = Math.max(def.inputs.length, def.outputs.length);

	return (
		<div
			className={cn(
				'group w-[228px] rounded-xl border bg-[rgb(11_15_21/0.94)] shadow-[0_18px_50px_-20px_rgb(0_0_0/0.9)] backdrop-blur-md transition-[border-color,box-shadow] duration-150',
				selected ? 'border-white/40' : 'border-white/10 hover:border-white/20'
			)}
			style={selected ? { boxShadow: `0 0 0 1px ${meta.color}66, 0 0 34px -8px ${meta.color}88` } : undefined}
		>
			<div
				className="flex items-center gap-2 rounded-t-xl border-b border-white/[0.07] px-3 py-2"
				style={{ background: `linear-gradient(90deg, ${meta.color}26, transparent 85%)` }}
			>
				<span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `${meta.color}22`, color: meta.color }}>
					<Icon className="size-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[12px] leading-tight font-medium text-foreground">{def.title}</div>
					<div className="text-[9px] leading-tight tracking-[0.16em] uppercase" style={{ color: meta.color }}>
						{meta.label}
					</div>
				</div>
				<button
					type="button"
					aria-label={`Delete ${def.title} node`}
					onClick={() => removeNode(id)}
					className="nodrag grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity outline-none group-hover:opacity-100 hover:bg-bear/20 hover:text-bear focus-visible:opacity-100"
				>
					<X className="size-3" />
				</button>
			</div>

			<div className="py-1.5">
				{Array.from({ length: rows }, (_, i) => (
					<PortRow key={i} input={def.inputs[i]} output={def.outputs[i]} />
				))}
			</div>

			{def.params.length > 0 && (
				<div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/[0.06] px-3 pt-2 pb-2.5">
					{def.params.map((p) => (
						<ParamField key={p.key} nodeId={id} def={p} value={data.params[p.key] ?? p.default} />
					))}
				</div>
			)}

			<div className="num truncate rounded-b-xl border-t border-white/[0.06] bg-black/30 px-3 py-1.5 text-[10px] text-muted-foreground" title={def.summary(data.params)}>
				{def.summary(data.params)}
			</div>
		</div>
	);
}

export const StrategyNode = React.memo(StrategyNodeView);

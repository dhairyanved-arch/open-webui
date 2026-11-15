import {
	Activity,
	ArrowDownRight,
	ArrowUpRight,
	Ban,
	Bell,
	ChartCandlestick,
	ChartNoAxesColumn,
	Clock,
	Database,
	Gauge,
	LogOut,
	Merge,
	Percent,
	Spline,
	Split,
	Waves,
	type LucideIcon
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
 * Node catalogue for the visual strategy builder.
 *
 * Two wire types exist:
 *   data   — an OHLCV frame flowing out of a Market Data node
 *   signal — a boolean series (true on bars where a condition holds)
 * Indicators turn data into signals, logic gates combine signals, and actions
 * consume a signal as their trigger.
 * ──────────────────────────────────────────────────────────────────────────── */

export type PortType = 'data' | 'signal';
export type ParamValue = string | number;
export type Params = Record<string, ParamValue>;
export type NodeCategory = 'source' | 'indicator' | 'logic' | 'action';

export interface ParamDef {
	key: string;
	label: string;
	kind: 'number' | 'select' | 'text';
	default: ParamValue;
	options?: Array<{ value: string; label: string }>;
	min?: number;
	max?: number;
	step?: number;
	/** Field spans the full node width. */
	wide?: boolean;
}

export interface PortDef {
	id: string;
	label: string;
	type: PortType;
}

export interface NodeDef {
	type: string;
	title: string;
	category: NodeCategory;
	icon: LucideIcon;
	blurb: string;
	inputs: PortDef[];
	outputs: PortDef[];
	params: ParamDef[];
	/** Human-readable expression shown on the node and in the compiled rule. */
	summary: (p: Params) => string;
}

export const CATEGORY_META: Record<NodeCategory, { label: string; color: string; description: string }> = {
	source: { label: 'Data', color: '#4de3ff', description: 'Where bars come from' },
	indicator: { label: 'Conditions', color: '#ffb224', description: 'Data in, true/false out' },
	logic: { label: 'Logic', color: '#a78bfa', description: 'Combine conditions' },
	action: { label: 'Actions', color: '#00ff9c', description: 'What to do when true' }
};

export const PORT_COLOR: Record<PortType, string> = {
	data: '#4de3ff',
	signal: '#ffb224'
};

const DATA_IN: PortDef[] = [{ id: 'data', label: 'bars', type: 'data' }];
const SIGNAL_OUT: PortDef[] = [{ id: 'signal', label: 'signal', type: 'signal' }];
const TRIGGER_IN: PortDef[] = [{ id: 'trigger', label: 'trigger', type: 'signal' }];

const COMPARE_OPTIONS = [
	{ value: '>', label: '>' },
	{ value: '<', label: '<' },
	{ value: 'crosses_above', label: 'crosses above' },
	{ value: 'crosses_below', label: 'crosses below' }
];

const opText = (op: ParamValue) =>
	op === 'crosses_above' ? 'crosses above' : op === 'crosses_below' ? 'crosses below' : String(op);

const RISK_PARAMS: ParamDef[] = [
	{ key: 'sizePct', label: 'Size %', kind: 'number', default: 10, min: 1, max: 100, step: 1 },
	{ key: 'stopLossPct', label: 'Stop %', kind: 'number', default: 1, min: 0, max: 50, step: 0.1 },
	{ key: 'takeProfitPct', label: 'Target %', kind: 'number', default: 2, min: 0, max: 100, step: 0.1 }
];

export const NODE_DEFS: NodeDef[] = [
	{
		type: 'market_data',
		title: 'Market Data',
		category: 'source',
		icon: Database,
		blurb: 'OHLCV bars for one symbol',
		inputs: [],
		outputs: [{ id: 'data', label: 'bars', type: 'data' }],
		params: [
			{ key: 'symbol', label: 'Symbol', kind: 'text', default: 'NIFTY' },
			{
				key: 'timeframe',
				label: 'Timeframe',
				kind: 'select',
				default: '5m',
				options: ['1m', '5m', '15m', '1h', '1d'].map((v) => ({ value: v, label: v }))
			}
		],
		summary: (p) => `${String(p.symbol).toUpperCase()} · ${p.timeframe}`
	},
	{
		type: 'rsi',
		title: 'RSI',
		category: 'indicator',
		icon: Gauge,
		blurb: 'RSI > 70, RSI < 30 …',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'period', label: 'Period', kind: 'number', default: 14, min: 2, max: 200, step: 1 },
			{ key: 'threshold', label: 'Threshold', kind: 'number', default: 70, min: 0, max: 100, step: 1 },
			{ key: 'op', label: 'Condition', kind: 'select', default: '>', options: COMPARE_OPTIONS, wide: true }
		],
		summary: (p) => `RSI(${p.period}) ${opText(p.op)} ${p.threshold}`
	},
	{
		type: 'volume_spike',
		title: 'Volume Spike',
		category: 'indicator',
		icon: ChartNoAxesColumn,
		blurb: 'Volume above a multiple of its average',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'lookback', label: 'Lookback', kind: 'number', default: 20, min: 2, max: 500, step: 1 },
			{ key: 'multiple', label: 'Multiple ×', kind: 'number', default: 2, min: 1, max: 20, step: 0.1 }
		],
		summary: (p) => `Volume > ${p.multiple}× SMA(${p.lookback})`
	},
	{
		type: 'ma_cross',
		title: 'MA Cross',
		category: 'indicator',
		icon: Spline,
		blurb: 'Fast average crosses the slow one',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'fast', label: 'Fast', kind: 'number', default: 9, min: 1, max: 400, step: 1 },
			{ key: 'slow', label: 'Slow', kind: 'number', default: 21, min: 2, max: 800, step: 1 },
			{
				key: 'kind',
				label: 'Average',
				kind: 'select',
				default: 'EMA',
				options: [
					{ value: 'EMA', label: 'EMA' },
					{ value: 'SMA', label: 'SMA' }
				]
			},
			{
				key: 'direction',
				label: 'Cross',
				kind: 'select',
				default: 'bullish',
				options: [
					{ value: 'bullish', label: 'bullish' },
					{ value: 'bearish', label: 'bearish' }
				]
			}
		],
		summary: (p) => `${p.kind}(${p.fast}) crosses ${p.direction === 'bullish' ? 'above' : 'below'} ${p.kind}(${p.slow})`
	},
	{
		type: 'macd',
		title: 'MACD',
		category: 'indicator',
		icon: Activity,
		blurb: 'Signal-line cross or histogram sign',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'fast', label: 'Fast', kind: 'number', default: 12, min: 1, max: 200, step: 1 },
			{ key: 'slow', label: 'Slow', kind: 'number', default: 26, min: 2, max: 400, step: 1 },
			{ key: 'signal', label: 'Signal', kind: 'number', default: 9, min: 1, max: 100, step: 1 },
			{
				key: 'mode',
				label: 'Condition',
				kind: 'select',
				default: 'bullish_cross',
				wide: true,
				options: [
					{ value: 'bullish_cross', label: 'bullish cross' },
					{ value: 'bearish_cross', label: 'bearish cross' },
					{ value: 'hist_positive', label: 'histogram > 0' },
					{ value: 'hist_negative', label: 'histogram < 0' }
				]
			}
		],
		summary: (p) => {
			const tag = `MACD(${p.fast},${p.slow},${p.signal})`;
			if (p.mode === 'bullish_cross') return `${tag} bullish cross`;
			if (p.mode === 'bearish_cross') return `${tag} bearish cross`;
			return `${tag} histogram ${p.mode === 'hist_positive' ? '> 0' : '< 0'}`;
		}
	},
	{
		type: 'bollinger',
		title: 'Bollinger Break',
		category: 'indicator',
		icon: Waves,
		blurb: 'Close outside the bands',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'period', label: 'Period', kind: 'number', default: 20, min: 2, max: 400, step: 1 },
			{ key: 'width', label: 'Std dev', kind: 'number', default: 2, min: 0.5, max: 5, step: 0.1 },
			{
				key: 'side',
				label: 'Break',
				kind: 'select',
				default: 'above_upper',
				wide: true,
				options: [
					{ value: 'above_upper', label: 'above upper band' },
					{ value: 'below_lower', label: 'below lower band' }
				]
			}
		],
		summary: (p) => `Close ${p.side === 'above_upper' ? '> upper' : '< lower'} BB(${p.period}, ${p.width}σ)`
	},
	{
		type: 'price_vwap',
		title: 'Price vs VWAP',
		category: 'indicator',
		icon: ChartCandlestick,
		blurb: 'Close above or below session VWAP',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{
				key: 'side',
				label: 'Close is',
				kind: 'select',
				default: 'above',
				wide: true,
				options: [
					{ value: 'above', label: 'above VWAP' },
					{ value: 'below', label: 'below VWAP' }
				]
			}
		],
		summary: (p) => `Close ${p.side === 'above' ? '>' : '<'} VWAP`
	},
	{
		type: 'price_change',
		title: 'Price Change',
		category: 'indicator',
		icon: Percent,
		blurb: 'N-bar move beyond a threshold',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'bars', label: 'Bars', kind: 'number', default: 5, min: 1, max: 500, step: 1 },
			{ key: 'pct', label: 'Move %', kind: 'number', default: 1.5, min: -50, max: 50, step: 0.1 },
			{
				key: 'op',
				label: 'Condition',
				kind: 'select',
				default: '>',
				wide: true,
				options: [
					{ value: '>', label: 'greater than' },
					{ value: '<', label: 'less than' }
				]
			}
		],
		summary: (p) => `Δ${p.bars} bars ${p.op} ${p.pct}%`
	},
	{
		type: 'time_window',
		title: 'Session Window',
		category: 'indicator',
		icon: Clock,
		blurb: 'True only between two clock times',
		inputs: DATA_IN,
		outputs: SIGNAL_OUT,
		params: [
			{ key: 'start', label: 'From', kind: 'text', default: '09:30' },
			{ key: 'end', label: 'Until', kind: 'text', default: '15:00' }
		],
		summary: (p) => `Time in ${p.start}–${p.end}`
	},
	{
		type: 'and',
		title: 'AND',
		category: 'logic',
		icon: Merge,
		blurb: 'Both inputs true',
		inputs: [
			{ id: 'a', label: 'A', type: 'signal' },
			{ id: 'b', label: 'B', type: 'signal' }
		],
		outputs: SIGNAL_OUT,
		params: [],
		summary: () => 'A AND B'
	},
	{
		type: 'or',
		title: 'OR',
		category: 'logic',
		icon: Split,
		blurb: 'Either input true',
		inputs: [
			{ id: 'a', label: 'A', type: 'signal' },
			{ id: 'b', label: 'B', type: 'signal' }
		],
		outputs: SIGNAL_OUT,
		params: [],
		summary: () => 'A OR B'
	},
	{
		type: 'not',
		title: 'NOT',
		category: 'logic',
		icon: Ban,
		blurb: 'Invert a signal',
		inputs: [{ id: 'in', label: 'in', type: 'signal' }],
		outputs: SIGNAL_OUT,
		params: [],
		summary: () => 'NOT in'
	},
	{
		type: 'enter_long',
		title: 'Enter Long',
		category: 'action',
		icon: ArrowUpRight,
		blurb: 'Buy when triggered',
		inputs: TRIGGER_IN,
		outputs: [],
		params: RISK_PARAMS,
		summary: (p) => `BUY ${p.sizePct}% · SL ${p.stopLossPct}% · TP ${p.takeProfitPct}%`
	},
	{
		type: 'enter_short',
		title: 'Enter Short',
		category: 'action',
		icon: ArrowDownRight,
		blurb: 'Sell short when triggered',
		inputs: TRIGGER_IN,
		outputs: [],
		params: RISK_PARAMS,
		summary: (p) => `SELL ${p.sizePct}% · SL ${p.stopLossPct}% · TP ${p.takeProfitPct}%`
	},
	{
		type: 'exit_position',
		title: 'Exit Position',
		category: 'action',
		icon: LogOut,
		blurb: 'Flatten when triggered',
		inputs: TRIGGER_IN,
		outputs: [],
		params: [],
		summary: () => 'Close any open position'
	},
	{
		type: 'alert',
		title: 'Alert',
		category: 'action',
		icon: Bell,
		blurb: 'Notify without trading',
		inputs: TRIGGER_IN,
		outputs: [],
		params: [{ key: 'message', label: 'Message', kind: 'text', default: 'Setup triggered', wide: true }],
		summary: (p) => `Notify: “${p.message}”`
	}
];

export const NODE_DEF_BY_TYPE: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((d) => [d.type, d]));

export function defaultParams(type: string): Params {
	const def = NODE_DEF_BY_TYPE[type];
	if (!def) return {};
	return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export function portType(nodeType: string, handleId: string | null | undefined, side: 'source' | 'target'): PortType | null {
	const def = NODE_DEF_BY_TYPE[nodeType];
	if (!def) return null;
	const ports = side === 'source' ? def.outputs : def.inputs;
	return ports.find((p) => p.id === handleId)?.type ?? null;
}

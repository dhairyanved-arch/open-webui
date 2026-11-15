import { NODE_DEF_BY_TYPE, type Params } from './nodeCatalog';

/* ────────────────────────────────────────────────────────────────────────────
 * Graph compiler: visual node graph → strategy JSON + runnable Python.
 *
 * The compiler is a pure function of (name, nodes, edges). It walks back from
 * every action node through its trigger wire, building a boolean expression
 * tree, and emits Python statements in dependency order as it goes. Incomplete
 * graphs still compile: an unwired input becomes a constant-false signal and a
 * diagnostic explains why, so the output panes never go blank mid-edit.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface GraphNode {
	id: string;
	type: string;
	params: Params;
	position?: { x: number; y: number };
}

export interface GraphEdge {
	source: string;
	sourceHandle?: string | null;
	target: string;
	targetHandle?: string | null;
}

export interface Diagnostic {
	level: 'error' | 'warning' | 'info';
	nodeId?: string;
	message: string;
}

export type Condition =
	| { op: 'AND' | 'OR'; args: Condition[] }
	| { op: 'NOT'; arg: Condition }
	| { indicator: string; params: Params; source: string | null }
	| { const: false; reason: string };

export interface CompiledRule {
	id: string;
	name: string;
	action: string;
	when: string;
	condition: Condition;
	risk: Record<string, number | string>;
}

export interface CompileResult {
	json: string;
	python: string;
	diagnostics: Diagnostic[];
	rules: CompiledRule[];
}

const ACTION_CODE: Record<string, string> = {
	enter_long: 'ENTER_LONG',
	enter_short: 'ENTER_SHORT',
	exit_position: 'EXIT',
	alert: 'ALERT'
};

const DEFAULT_FRAME = { symbol: 'NIFTY', timeframe: '5m' };

const num = (v: unknown, fallback: number) => {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
};
const int = (v: unknown, fallback: number) => Math.max(1, Math.round(num(v, fallback)));
const pyNum = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
const pyStr = (s: unknown) => JSON.stringify(String(s));
const cleanSymbol = (s: unknown) => String(s ?? '').trim().toUpperCase() || DEFAULT_FRAME.symbol;
const cleanTime = (s: unknown, fallback: string) => (/^\d{1,2}:\d{2}$/.test(String(s).trim()) ? String(s).trim().padStart(5, '0') : fallback);

function identifier(text: string) {
	const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
	return /^[a-z_]/.test(id) ? id : `f_${id}`;
}

/* ── Python helper library: only the functions a graph uses are emitted ───── */

const HELPERS: Record<string, { deps: string[]; code: string }> = {
	rsi: {
		deps: [],
		code: `def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    return 100 - 100 / (1 + gain / loss.replace(0, np.nan))`
	},
	ema: {
		deps: [],
		code: `def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()`
	},
	sma: {
		deps: [],
		code: `def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window).mean()`
	},
	macd: {
		deps: ['ema'],
		code: `def macd(close: pd.Series, fast: int, slow: int, signal: int):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig`
	},
	bollinger: {
		deps: [],
		code: `def bollinger(close: pd.Series, period: int, width: float):
    mid = close.rolling(period).mean()
    dev = close.rolling(period).std(ddof=0)
    return mid, mid + width * dev, mid - width * dev`
	},
	vwap: {
		deps: [],
		code: `def vwap(df: pd.DataFrame) -> pd.Series:
    typical = (df["high"] + df["low"] + df["close"]) / 3
    day = df.index.normalize()
    return (typical * df["volume"]).groupby(day).cumsum() / df["volume"].groupby(day).cumsum()`
	},
	crosses_above: {
		deps: [],
		code: `def crosses_above(a: pd.Series, b) -> pd.Series:
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    return (a > b) & (a.shift(1) <= b.shift(1))`
	},
	crosses_below: {
		deps: [],
		code: `def crosses_below(a: pd.Series, b) -> pd.Series:
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    return (a < b) & (a.shift(1) >= b.shift(1))`
	},
	in_session: {
		deps: [],
		code: `def in_session(index: pd.DatetimeIndex, start: str, end: str) -> pd.Series:
    clock = index.strftime("%H:%M")
    return pd.Series((clock >= start) & (clock <= end), index=index)`
	}
};
const HELPER_ORDER = ['ema', 'sma', 'rsi', 'macd', 'bollinger', 'vwap', 'crosses_above', 'crosses_below', 'in_session'];

const RUNTIME = `def load_ohlcv(symbol: str, timeframe: str, bars: int = 3000) -> pd.DataFrame:
    """Synthetic OHLCV so this file runs anywhere. Swap in your broker or vendor feed."""
    minutes = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440}[timeframe]
    rng = np.random.default_rng(zlib.crc32(f"{symbol}@{timeframe}".encode()))
    if minutes >= 1440:
        index = pd.bdate_range("2021-01-01", periods=bars)
    else:
        per_day = max(1, 375 // minutes)
        days = pd.bdate_range("2025-01-01", periods=bars // per_day + 1)
        opens = [day + pd.Timedelta(minutes=9 * 60 + 15 + i * minutes) for day in days for i in range(per_day)]
        index = pd.DatetimeIndex(opens[:bars])
    step = 0.0009 * np.sqrt(minutes / 5)
    close = 1000 * np.exp(np.cumsum(rng.normal(0, step, len(index))))
    open_ = np.r_[close[0], close[:-1]]
    wick = np.abs(rng.normal(0, step / 2, len(index)))
    high = np.maximum(open_, close) * (1 + wick)
    low = np.minimum(open_, close) * (1 - wick)
    volume = rng.lognormal(10, 0.6, len(index)) * (1 + 0.6 * np.abs(close / open_ - 1) / step)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=index)


def backtest(prices: pd.DataFrame, signals: pd.DataFrame, capital: float = 1_000_000.0) -> dict:
    """Bar-close event loop: one position at a time, stop and target checked intrabar."""
    rules = {rule["name"]: rule for rule in RULES}
    cash, qty, entry, side = capital, 0.0, 0.0, 0
    active, opened = None, None
    trades, alerts, equity = [], 0, []
    for ts, bar in prices.iterrows():
        row = signals.loc[ts]
        if side != 0:
            stop = active.get("stop_loss_pct", 0) / 100
            target = active.get("take_profit_pct", 0) / 100
            hit_stop = stop > 0 and (bar["low"] <= entry * (1 - stop) if side > 0 else bar["high"] >= entry * (1 + stop))
            hit_target = target > 0 and (bar["high"] >= entry * (1 + target) if side > 0 else bar["low"] <= entry * (1 - target))
            exit_price = None
            if hit_stop:
                exit_price = entry * (1 - side * stop)
            elif hit_target:
                exit_price = entry * (1 + side * target)
            elif any(row[name] for name, rule in rules.items() if rule["action"] == "EXIT"):
                exit_price = bar["close"]
            if exit_price is not None:
                pnl = side * qty * (exit_price - entry)
                cash += pnl
                trades.append({"opened": opened, "closed": ts, "side": "LONG" if side > 0 else "SHORT", "pnl": pnl})
                side, qty, active = 0, 0.0, None
        if side == 0:
            for name, rule in rules.items():
                if rule["action"] in ("ENTER_LONG", "ENTER_SHORT") and row[name]:
                    side = 1 if rule["action"] == "ENTER_LONG" else -1
                    entry, opened, active = bar["close"], ts, rule
                    qty = cash * rule["size_pct"] / 100 / entry
                    break
        alerts += sum(bool(row[name]) for name, rule in rules.items() if rule["action"] == "ALERT")
        equity.append(cash + side * qty * (bar["close"] - entry))
    curve = pd.Series(equity, index=prices.index, dtype=float)
    wins = [t for t in trades if t["pnl"] > 0]
    return {
        "trades": len(trades),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "net_pnl": float(curve.iloc[-1] - capital) if len(curve) else 0.0,
        "max_drawdown": float((curve / curve.cummax() - 1).min()) if len(curve) else 0.0,
        "alerts": int(alerts),
    }


if __name__ == "__main__":
    frames = {u["key"]: load_ohlcv(u["symbol"], u["timeframe"]) for u in UNIVERSE}
    signals = build_signals(frames)
    report = backtest(frames[PRIMARY], signals)
    print(STRATEGY_NAME)
    for key, value in report.items():
        print(f"  {key:>13}: {value:,.4f}" if isinstance(value, float) else f"  {key:>13}: {value}")`;

/* ── compiler ─────────────────────────────────────────────────────────────── */

interface Frame {
	key: string;
	symbol: string;
	timeframe: string;
	varName: string;
}

interface Signal {
	condition: Condition;
	text: string;
	/** Python variable holding the boolean series. */
	py: string;
	/** Market-data node this signal ultimately reads from. */
	source: string | null;
}

export function describeCondition(c: Condition, top = true): string {
	if ('const' in c) return 'FALSE';
	if ('indicator' in c) return NODE_DEF_BY_TYPE[c.indicator]?.summary(c.params) ?? c.indicator;
	if (c.op === 'NOT') return `NOT ${describeCondition(c.arg, false)}`;
	const body = c.args.map((a) => describeCondition(a, false)).join(` ${c.op} `);
	return top ? body : `(${body})`;
}

export function compileGraph(name: string, nodes: GraphNode[], edges: GraphEdge[]): CompileResult {
	const diagnostics: Diagnostic[] = [];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const title = (n: GraphNode) => NODE_DEF_BY_TYPE[n.type]?.title ?? n.type;

	// input wiring: "<target>:<handle>" → source node id
	const incoming = new Map<string, string>();
	for (const e of edges) {
		if (byId.has(e.source) && byId.has(e.target)) incoming.set(`${e.target}:${e.targetHandle ?? ''}`, e.source);
	}

	/* frames ── one per distinct symbol@timeframe */
	const frames = new Map<string, Frame>();
	const frameOfNode = new Map<string, Frame>();
	const usedVarNames = new Set<string>();
	const frameFor = (symbol: string, timeframe: string) => {
		const key = `${symbol}@${timeframe}`;
		let frame = frames.get(key);
		if (!frame) {
			let varName = identifier(`${symbol}_${timeframe}`);
			while (usedVarNames.has(varName)) varName += '_';
			usedVarNames.add(varName);
			frame = { key, symbol, timeframe, varName };
			frames.set(key, frame);
		}
		return frame;
	};
	for (const n of nodes) {
		if (n.type !== 'market_data') continue;
		frameOfNode.set(n.id, frameFor(cleanSymbol(n.params.symbol), String(n.params.timeframe || DEFAULT_FRAME.timeframe)));
	}
	if (frames.size === 0) {
		frameFor(DEFAULT_FRAME.symbol, DEFAULT_FRAME.timeframe);
		if (nodes.length > 0) {
			diagnostics.push({ level: 'warning', message: 'No Market Data node — the script falls back to NIFTY 5m bars.' });
		}
	}
	const fallbackFrame = [...frames.values()][0];

	/* signals ── memoised post-order walk, emitting Python as dependencies resolve */
	const lines: string[] = [];
	const helpers = new Set<string>();
	const signals = new Map<string, Signal>();
	const reached = new Set<string>();
	const counters = new Map<string, number>();
	const nextVar = (type: string) => {
		const k = (counters.get(type) ?? 0) + 1;
		counters.set(type, k);
		return `${type}_${k}`;
	};
	const need = (helper: string) => {
		if (helpers.has(helper)) return;
		helpers.add(helper);
		HELPERS[helper].deps.forEach(need);
	};
	const falseSignal = (varHint: string, reason: string, frame: Frame): Signal => {
		const py = nextVar(varHint);
		lines.push(`${py} = pd.Series(False, index=${frame.varName}.index)  # ${reason}`);
		return { condition: { const: false, reason }, text: 'FALSE', py, source: null };
	};

	const compileSignal = (nodeId: string, stack: string[]): Signal => {
		const cached = signals.get(nodeId);
		if (cached) return cached;
		const node = byId.get(nodeId)!;
		reached.add(nodeId);

		if (stack.includes(nodeId)) {
			diagnostics.push({ level: 'error', nodeId, message: `${title(node)} is part of a loop — signals cannot feed back into themselves.` });
			return falseSignal('loop', 'cycle in graph', fallbackFrame);
		}
		const nextStack = [...stack, nodeId];
		let result: Signal;

		if (node.type === 'and' || node.type === 'or') {
			const parts = ['a', 'b'].map((handle) => {
				const src = incoming.get(`${nodeId}:${handle}`);
				if (!src) {
					diagnostics.push({ level: 'warning', nodeId, message: `${title(node)} input ${handle.toUpperCase()} is not connected — treated as false.` });
					return falseSignal('unwired', `${node.type.toUpperCase()} input ${handle.toUpperCase()} not connected`, fallbackFrame);
				}
				return compileSignal(src, nextStack);
			});
			const py = nextVar(node.type);
			lines.push(`${py} = ${parts[0].py} ${node.type === 'and' ? '&' : '|'} ${parts[1].py}`);
			result = {
				condition: { op: node.type === 'and' ? 'AND' : 'OR', args: parts.map((p) => p.condition) },
				text: '',
				py,
				source: parts[0].source ?? parts[1].source
			};
		} else if (node.type === 'not') {
			const src = incoming.get(`${nodeId}:in`);
			const inner = src
				? compileSignal(src, nextStack)
				: (diagnostics.push({ level: 'warning', nodeId, message: 'NOT has no input — treated as NOT false (always true).' }),
					falseSignal('unwired', 'NOT input not connected', fallbackFrame));
			const py = nextVar('not');
			lines.push(`${py} = ~${inner.py}`);
			result = { condition: { op: 'NOT', arg: inner.condition }, text: '', py, source: inner.source };
		} else if (NODE_DEF_BY_TYPE[node.type]?.category !== 'indicator') {
			diagnostics.push({ level: 'error', nodeId, message: `${title(node)} does not produce a signal and cannot drive a condition.` });
			result = falseSignal('invalid', `${title(node)} is not a signal`, fallbackFrame);
		} else {
			// indicator: needs a data wire from a Market Data node
			const src = incoming.get(`${nodeId}:data`);
			const frame = src ? frameOfNode.get(src) : undefined;
			if (!frame) {
				diagnostics.push({ level: 'error', nodeId, message: `${title(node)} is not wired to a Market Data node.` });
				result = falseSignal(node.type, `${title(node)} has no market data`, fallbackFrame);
			} else {
				reached.add(src!);
				const py = nextVar(node.type);
				emitIndicator(node, py, frame.varName, lines, need);
				result = {
					condition: { indicator: node.type, params: { ...node.params }, source: frame.key },
					text: '',
					py,
					source: src!
				};
			}
		}
		result.text = describeCondition(result.condition);
		signals.set(nodeId, result);
		return result;
	};

	/* rules ── one per action node, in canvas order (top-left first) */
	const actions = nodes
		.filter((n) => NODE_DEF_BY_TYPE[n.type]?.category === 'action')
		.sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0));

	const rules: CompiledRule[] = [];
	const ruleSignals: Signal[] = [];
	for (const action of actions) {
		reached.add(action.id);
		const src = incoming.get(`${action.id}:trigger`);
		let signal: Signal;
		if (!src) {
			diagnostics.push({ level: 'warning', nodeId: action.id, message: `${title(action)} has no trigger wired — it will never fire.` });
			signal = falseSignal('unwired', `${title(action)} has no trigger`, fallbackFrame);
		} else {
			signal = compileSignal(src, [action.id]);
		}
		const risk: Record<string, number | string> = {};
		if (action.type === 'enter_long' || action.type === 'enter_short') {
			risk.size_pct = num(action.params.sizePct, 10);
			risk.stop_loss_pct = num(action.params.stopLossPct, 0);
			risk.take_profit_pct = num(action.params.takeProfitPct, 0);
		} else if (action.type === 'alert') {
			risk.message = String(action.params.message ?? '');
		}
		rules.push({
			id: action.id,
			name: nextVar(action.type),
			action: ACTION_CODE[action.type] ?? action.type.toUpperCase(),
			when: signal.text,
			condition: signal.condition,
			risk
		});
		ruleSignals.push(signal);
	}

	if (nodes.length > 0 && actions.length === 0) {
		diagnostics.push({ level: 'warning', message: 'No action node yet — add Enter Long, Enter Short, Exit or Alert to turn conditions into orders.' });
	}
	for (const n of nodes) {
		if (!NODE_DEF_BY_TYPE[n.type]) {
			diagnostics.push({ level: 'error', nodeId: n.id, message: `Unknown node type "${n.type}".` });
		} else if (!reached.has(n.id) && actions.length > 0) {
			diagnostics.push({ level: 'info', nodeId: n.id, message: `${title(n)} does not reach an action, so it is left out of the script.` });
		}
	}

	/* primary frame: whatever the first rule trades on */
	const primarySource = ruleSignals.map((s) => s.source).find((s): s is string => Boolean(s));
	const primary = (primarySource && frameOfNode.get(primarySource)) || fallbackFrame;
	const usedFrames = [...frames.values()];

	/* ── JSON ── */
	const spec = {
		schema: 'aot.strategy/v1',
		name,
		universe: usedFrames.map((f) => ({ key: f.key, symbol: f.symbol, timeframe: f.timeframe })),
		primary: primary.key,
		rules: rules.map((r) => ({ id: r.id, action: r.action, when: r.when, ...r.risk, condition: r.condition })),
		graph: {
			nodes: nodes.map((n) => ({
				id: n.id,
				type: n.type,
				params: n.params,
				position: n.position ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : undefined
			})),
			edges: edges.map((e) => ({
				from: `${e.source}.${e.sourceHandle ?? 'out'}`,
				to: `${e.target}.${e.targetHandle ?? 'in'}`
			}))
		},
		diagnostics
	};

	/* ── Python ── */
	const ruleDoc = rules.length
		? rules.map((r) => `  ${r.action.padEnd(11)} when  ${r.when}`).join('\n')
		: '  (no rules yet — wire a condition into an action node)';
	const helperCode = HELPER_ORDER.filter((h) => helpers.has(h)).map((h) => HELPERS[h].code);
	const rulesPy = rules.map((r) => {
		const fields = [`"name": ${pyStr(r.name)}`, `"action": ${pyStr(r.action)}`, `"when": ${pyStr(r.when)}`];
		for (const [k, v] of Object.entries(r.risk)) fields.push(`"${k}": ${typeof v === 'number' ? pyNum(v) : pyStr(v)}`);
		return `    {${fields.join(', ')}},`;
	});

	const python = [
		`"""`,
		name,
		`Generated by Asymmetric Alpha Omni-Terminal — Node-Based Algo Builder.`,
		`This file is rewritten on every graph edit: change the graph, not the code.`,
		``,
		`Rules`,
		ruleDoc,
		`"""`,
		`from __future__ import annotations`,
		``,
		`import zlib`,
		``,
		`import numpy as np`,
		`import pandas as pd`,
		``,
		`STRATEGY_NAME = ${pyStr(name)}`,
		`PRIMARY = ${pyStr(primary.key)}`,
		``,
		`UNIVERSE = [`,
		...usedFrames.map((f) => `    {"key": ${pyStr(f.key)}, "symbol": ${pyStr(f.symbol)}, "timeframe": ${pyStr(f.timeframe)}},`),
		`]`,
		``,
		`RULES = [`,
		...rulesPy,
		`]`,
		``,
		...(helperCode.length ? ['', ...helperCode.flatMap((code) => [code, '', ''])] : ['']),
		`def build_signals(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:`,
		`    """One boolean column per rule, aligned to the primary frame."""`,
		...usedFrames.map((f) => `    ${f.varName} = frames[${pyStr(f.key)}]`),
		``,
		...lines.map((l) => `    ${l}`),
		...(lines.length ? [``] : []),
		`    signals = pd.DataFrame(index=${primary.varName}.index)`,
		...rules.map((r, i) => `    signals[${pyStr(r.name)}] = ${ruleSignals[i].py}`),
		`    return signals.fillna(False).astype(bool)`,
		``,
		``,
		RUNTIME,
		``
	].join('\n');

	return { json: JSON.stringify(spec, null, 2), python, diagnostics, rules };
}

function emitIndicator(node: GraphNode, py: string, df: string, lines: string[], need: (helper: string) => void) {
	const p = node.params;
	const close = `${df}["close"]`;
	switch (node.type) {
		case 'rsi': {
			need('rsi');
			const series = `rsi(${close}, ${int(p.period, 14)})`;
			const level = pyNum(num(p.threshold, 70));
			if (p.op === 'crosses_above' || p.op === 'crosses_below') {
				need(String(p.op));
				lines.push(`${py} = ${p.op}(${series}, ${level})`);
			} else {
				lines.push(`${py} = ${series} ${p.op === '<' ? '<' : '>'} ${level}`);
			}
			return;
		}
		case 'volume_spike':
			lines.push(`${py} = ${df}["volume"] > ${pyNum(num(p.multiple, 2))} * ${df}["volume"].rolling(${int(p.lookback, 20)}).mean()`);
			return;
		case 'ma_cross': {
			const fn = p.kind === 'SMA' ? 'sma' : 'ema';
			const cross = p.direction === 'bearish' ? 'crosses_below' : 'crosses_above';
			need(fn);
			need(cross);
			lines.push(`${py} = ${cross}(${fn}(${close}, ${int(p.fast, 9)}), ${fn}(${close}, ${int(p.slow, 21)}))`);
			return;
		}
		case 'macd': {
			need('macd');
			lines.push(`${py}_line, ${py}_sig, ${py}_hist = macd(${close}, ${int(p.fast, 12)}, ${int(p.slow, 26)}, ${int(p.signal, 9)})`);
			if (p.mode === 'hist_positive') lines.push(`${py} = ${py}_hist > 0`);
			else if (p.mode === 'hist_negative') lines.push(`${py} = ${py}_hist < 0`);
			else {
				const cross = p.mode === 'bearish_cross' ? 'crosses_below' : 'crosses_above';
				need(cross);
				lines.push(`${py} = ${cross}(${py}_line, ${py}_sig)`);
			}
			return;
		}
		case 'bollinger':
			need('bollinger');
			lines.push(`${py}_mid, ${py}_upper, ${py}_lower = bollinger(${close}, ${int(p.period, 20)}, ${pyNum(num(p.width, 2))})`);
			lines.push(p.side === 'below_lower' ? `${py} = ${close} < ${py}_lower` : `${py} = ${close} > ${py}_upper`);
			return;
		case 'price_vwap':
			need('vwap');
			lines.push(`${py} = ${close} ${p.side === 'below' ? '<' : '>'} vwap(${df})`);
			return;
		case 'price_change':
			lines.push(`${py} = ${close}.pct_change(${int(p.bars, 5)}) * 100 ${p.op === '<' ? '<' : '>'} ${pyNum(num(p.pct, 1.5))}`);
			return;
		case 'time_window':
			need('in_session');
			lines.push(`${py} = in_session(${df}.index, ${pyStr(cleanTime(p.start, '09:15'))}, ${pyStr(cleanTime(p.end, '15:30'))})`);
			return;
		default:
			lines.push(`${py} = pd.Series(False, index=${df}.index)  # unsupported node "${node.type}"`);
	}
}

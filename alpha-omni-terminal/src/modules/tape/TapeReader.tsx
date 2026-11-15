import * as React from 'react';
import { Pause, Play, Radar } from 'lucide-react';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { ModuleHeader, Segmented, SliderField } from '@/components/fx/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMockData } from '@/context/MockDataContext';
import { formatClock, formatInrCompact, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { OrderBook } from './OrderBook';
import type { BlockDeal } from './detector';
import { useTapeFeed, type TapeRow } from './useTapeFeed';

const price = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── tape row: typography scales with how unusual the print is ────────────── */

const TapeLine = React.memo(function TapeLine({ row }: { row: TapeRow }) {
	const { trade, z, kind } = row;
	const buy = trade.side === 'B';
	const anomaly = kind !== null;
	const tier = anomaly ? 3 : z >= 2 ? 2 : z >= 1 ? 1 : 0;
	const tone = buy ? 'text-bull' : 'text-bear';

	return (
		<TableRow
			data-testid="tape-row"
			data-trade-id={trade.id}
			data-anomaly={anomaly}
			className={cn(
				'num',
				anomaly ? (buy ? 'animate-flash-bull bg-bull/[0.07]' : 'animate-flash-bear bg-bear/[0.07]') : 'animate-row-in',
				tier === 0 && 'text-[11px] text-muted-foreground',
				tier === 1 && 'text-[12px] text-foreground/85',
				tier === 2 && 'text-[13px] font-medium text-foreground',
				tier === 3 && cn('text-[15px] font-semibold', tone, buy ? 'text-glow-bull' : 'text-glow-bear')
			)}
		>
			<TableCell className={cn('relative w-[92px] !pl-3', tier < 3 && 'text-muted-foreground')}>
				{anomaly && <span className={cn('absolute inset-y-0 left-0 w-[3px]', buy ? 'bg-bull shadow-[0_0_12px_var(--bull)]' : 'bg-bear shadow-[0_0_12px_var(--bear)]')} />}
				<span className="text-[10.5px] font-normal">{formatClock(trade.ts)}</span>
			</TableCell>
			<TableCell className={cn('font-sans tracking-wide', tier < 3 && 'text-foreground/90')}>{trade.symbol}</TableCell>
			<TableCell className={cn('w-12', tier < 3 && (buy ? 'text-bull/80' : 'text-bear/80'))}>{buy ? 'BUY' : 'SELL'}</TableCell>
			<TableCell className="text-right">{price(trade.price)}</TableCell>
			<TableCell className="text-right">{formatQty(trade.qty)}</TableCell>
			<TableCell className="text-right">{formatInrCompact(trade.notional)}</TableCell>
			<TableCell className={cn('text-right', tier < 3 && trade.slippageBps > 2 && 'text-primary')}>{trade.slippageBps.toFixed(2)}</TableCell>
			<TableCell className="w-[68px] !pr-3 text-right">
				{anomaly ? (
					<span
						className={cn(
							'inline-block rounded-[4px] px-1.5 py-px text-[9.5px] font-bold tracking-[0.14em]',
							buy ? 'bg-bull text-[#012214]' : 'bg-bear text-white'
						)}
					>
						{kind}
					</span>
				) : (
					<span className="text-[10px] font-normal text-muted-foreground/70">{z >= 1 ? `${z.toFixed(1)}σ` : ''}</span>
				)}
			</TableCell>
		</TableRow>
	);
});

/* ── isolated block card ──────────────────────────────────────────────────── */

const BlockCard = React.memo(function BlockCard({ block, onFocus }: { block: BlockDeal; onFocus: (symbol: string) => void }) {
	const buy = block.side === 'B';
	return (
		<button
			type="button"
			data-testid="block-card"
			onClick={() => onFocus(block.symbol)}
			// Re-keying on print count restarts the flash each time a sweep grows.
			key={`${block.id}-${block.prints}`}
			className={cn(
				'block w-full rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40',
				buy ? 'animate-flash-bull border-bull/40 bg-bull/[0.07] hover:border-bull/70' : 'animate-flash-bear border-bear/45 bg-bear/[0.07] hover:border-bear/75'
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className={cn('num rounded-[4px] px-1.5 py-px text-[9.5px] font-bold tracking-[0.14em]', buy ? 'bg-bull text-[#012214]' : 'bg-bear text-white')}>
						{block.kind}
						{block.prints > 1 ? ` ×${block.prints}` : ''}
					</span>
					<span className="text-[13px] font-semibold tracking-wide text-foreground">{block.symbol}</span>
				</div>
				<span className="num text-[10px] text-muted-foreground">{formatClock(block.endTs)}</span>
			</div>
			<div className="mt-1.5 flex items-baseline justify-between gap-3">
				<span className={cn('num text-[22px] leading-none font-semibold', buy ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear')}>
					{buy ? 'BUY' : 'SELL'} {formatInrCompact(block.notional)}
				</span>
				<span className="num text-[11px] text-foreground/80">{formatQty(block.qty)} sh</span>
			</div>
			<div className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
				<span>VWAP {price(block.vwap)}</span>
				<span className={block.slippageBps > 2.5 ? 'text-primary' : undefined}>slip {block.slippageBps.toFixed(2)} bps</span>
				<span>size {block.score.toFixed(1)}σ</span>
				{block.prints > 1 && <span>{Math.max(1, Math.round(block.endTs - block.startTs))} ms</span>}
			</div>
		</button>
	);
});

/* ── small stat tiles ─────────────────────────────────────────────────────── */

function Tile({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
	return (
		<div className={cn('glass rounded-xl px-3.5 py-2.5', className)}>
			<div className="kicker">{label}</div>
			<div className="mt-1">{children}</div>
		</div>
	);
}

function DeltaSpark({ points }: { points: number[] }) {
	if (points.length < 2) return <div className="h-8" />;
	const W = 200;
	const H = 32;
	const lo = Math.min(...points, 0);
	const hi = Math.max(...points, 0);
	const span = hi - lo || 1;
	const x = (i: number) => (i / (points.length - 1)) * W;
	const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);
	const last = points[points.length - 1];
	const stroke = last >= 0 ? 'var(--bull)' : 'var(--bear)';
	const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	return (
		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label="Cumulative aggressor delta">
			<line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="2 3" />
			<path d={`${line} L${W},${y(0)} L0,${y(0)} Z`} fill={stroke} opacity={0.13} />
			<path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
		</svg>
	);
}

/* ── page ─────────────────────────────────────────────────────────────────── */

const SPEEDS = [
	{ value: '0.5', label: '0.5×' },
	{ value: '1', label: '1×' },
	{ value: '2', label: '2×' },
	{ value: '4', label: '4×' }
];

export default function TapeReader() {
	const { universe, seed } = useMockData();
	const symbols = React.useMemo(() => universe.instruments.map((i) => i.symbol), [universe.instruments]);

	const [paused, setPaused] = React.useState(false);
	const [speed, setSpeed] = React.useState('1');
	const [zThreshold, setZThreshold] = React.useState(3.2);
	const [focusSymbol, setFocusSymbol] = React.useState(symbols[0]);
	const [filter, setFilter] = React.useState<string>('ALL');
	const [anomaliesOnly, setAnomaliesOnly] = React.useState(false);

	React.useEffect(() => {
		setFocusSymbol(symbols[0]);
		setFilter('ALL');
	}, [symbols]);

	const feed = useTapeFeed({ instruments: universe.instruments, seed, paused, speed: Number(speed), zThreshold, focusSymbol });
	const { stats } = feed;

	const rows = React.useMemo(
		() => feed.rows.filter((r) => (filter === 'ALL' || r.trade.symbol === filter) && (!anomaliesOnly || r.kind !== null)),
		[feed.rows, filter, anomaliesOnly]
	);
	const blocks = React.useMemo(() => (filter === 'ALL' ? feed.blocks : feed.blocks.filter((b) => b.symbol === filter)), [feed.blocks, filter]);

	const flowTotal = stats.buyFlow + stats.sellFlow;
	const buyShare = flowTotal > 0 ? stats.buyFlow / flowTotal : 0.5;
	const lastDelta = stats.delta.length ? stats.delta[stats.delta.length - 1] : 0;

	const focus = (symbol: string) => setFocusSymbol(symbol);

	return (
		<div className="flex h-full flex-col gap-4 p-5">
			<ModuleHeader
				index="04"
				domain="Microstructure"
				title="High-Frequency Tape Reader"
				lede="A simulated time-and-sales feed across eight liquid names. A size-outlier model and a same-side clustering pass pick institutional block deals and sliced sweeps out of the noise and light them up as they print."
				actions={
					<>
						<Segmented ariaLabel="Playback speed" value={speed} options={SPEEDS} onChange={setSpeed} />
						<Button
							variant={paused ? 'default' : 'outline'}
							size="sm"
							aria-label={paused ? 'Resume feed' : 'Pause feed'}
							onClick={() => setPaused((p) => !p)}
						>
							{paused ? <Play /> : <Pause />}
							{paused ? 'Resume' : 'Pause'}
						</Button>
					</>
				}
			/>

			<div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-5">
				<Tile label="Prints / sec">
					<div className="num text-[1.35rem] leading-none font-medium text-foreground">{stats.rate.toFixed(1)}</div>
					<div className="num mt-1 text-[10.5px] text-muted-foreground">{stats.prints.toLocaleString('en-IN')} since open</div>
				</Tile>
				<Tile label="Aggressor imbalance">
					<div className="num flex items-baseline justify-between text-[13px]">
						<span className="text-bull">{(buyShare * 100).toFixed(0)}% buy</span>
						<span className="text-bear">{((1 - buyShare) * 100).toFixed(0)}% sell</span>
					</div>
					<div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-bear/60">
						<div className="h-full bg-bull transition-[width] duration-300" style={{ width: `${buyShare * 100}%` }} />
					</div>
				</Tile>
				<Tile label="Cumulative delta">
					<div className="flex items-center gap-3">
						<span className={cn('num shrink-0 text-[13px]', lastDelta >= 0 ? 'text-bull' : 'text-bear')}>
							{lastDelta >= 0 ? '+' : ''}
							{formatInrCompact(lastDelta)}
						</span>
						<DeltaSpark points={stats.delta} />
					</div>
				</Tile>
				<Tile label="Blocks isolated">
					<div className="num text-[1.35rem] leading-none font-medium text-primary">{stats.score.reported}</div>
					<div className="num mt-1 text-[10.5px] text-muted-foreground">{formatInrCompact(stats.blockNotional)} institutional notional</div>
				</Tile>
				<Tile label="Detector vs ground truth" className="max-lg:col-span-2">
					<div className="num flex items-baseline gap-3 text-[13px]">
						<span className="text-foreground">
							recall <span className="text-accent">{(stats.score.recall * 100).toFixed(0)}%</span>
						</span>
						<span className="text-foreground">
							precision <span className="text-accent">{(stats.score.precision * 100).toFixed(0)}%</span>
						</span>
					</div>
					<div className="num mt-1 text-[10.5px] text-muted-foreground">
						{stats.score.caught} of {stats.score.injected} injected orders caught
					</div>
				</Tile>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[270px_minmax(0,1fr)_340px]">
				{/* ── order book ── */}
				<GlassPanel kicker="Depth · 10 levels" title={`${focusSymbol} order book`} flush still className="min-h-[420px]">
					<div className="flex h-full flex-col">
						<div className="flex shrink-0 flex-wrap gap-1 px-3 pb-2.5">
							{symbols.map((s) => (
								<button
									key={s}
									type="button"
									aria-pressed={s === focusSymbol}
									onClick={() => setFocusSymbol(s)}
									className={cn(
										'rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
										s === focusSymbol ? 'border-primary/50 bg-primary/15 text-primary' : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground'
									)}
								>
									{s}
								</button>
							))}
						</div>
						<div className="min-h-0 flex-1">
							<OrderBook book={feed.book} />
						</div>
					</div>
				</GlassPanel>

				{/* ── tape ── */}
				<GlassPanel
					kicker="Time & sales"
					title={
						<span className="flex items-center gap-2">
							Live tape
							{paused ? <Badge variant="primary">paused</Badge> : <Badge variant="bull">streaming</Badge>}
						</span>
					}
					flush
					still
					className="min-h-[420px] overflow-hidden"
					actions={
						<>
							<div className="flex items-center gap-2">
								<Switch id="tape-anomalies" checked={anomaliesOnly} onCheckedChange={setAnomaliesOnly} />
								<Label htmlFor="tape-anomalies">Blocks only</Label>
							</div>
							<select
								aria-label="Filter tape by symbol"
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								className="h-7 cursor-pointer rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-foreground outline-none focus:border-primary/60"
							>
								<option value="ALL" className="bg-[#0c1017]">
									All symbols
								</option>
								{symbols.map((s) => (
									<option key={s} value={s} className="bg-[#0c1017]">
										{s}
									</option>
								))}
							</select>
						</>
					}
				>
					<div className="thin-scroll h-full overflow-auto">
						<Table className="[&_td]:px-2 [&_th]:px-2 [&_th]:tracking-[0.14em]">
							<TableHeader className="sticky top-0 z-10 bg-[rgb(9_12_18/0.96)] backdrop-blur">
								<TableRow>
									<TableHead>Time</TableHead>
									<TableHead>Symbol</TableHead>
									<TableHead>Side</TableHead>
									<TableHead className="text-right">Price</TableHead>
									<TableHead className="text-right">Qty</TableHead>
									<TableHead className="text-right">Notional</TableHead>
									<TableHead className="text-right">Slip bp</TableHead>
									<TableHead className="text-right">Flag</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TapeLine key={row.trade.id} row={row} />
								))}
							</TableBody>
						</Table>
						{rows.length === 0 && (
							<div className="p-8 text-center text-xs text-muted-foreground">
								{anomaliesOnly ? 'No block prints in the current window — they will appear here as they are detected.' : 'Waiting for prints…'}
							</div>
						)}
					</div>
				</GlassPanel>

				{/* ── block radar ── */}
				<GlassPanel
					kicker="Isolated flow"
					title={
						<span className="flex items-center gap-2">
							<Radar className="size-4 text-primary" /> Institutional radar
						</span>
					}
					flush
					still
					className="min-h-[420px] overflow-hidden"
				>
					<div className="flex h-full flex-col">
						<div className="shrink-0 border-b border-white/[0.06] px-4 pb-3">
							<SliderField
								label="Sensitivity (size threshold)"
								tone="primary"
								value={zThreshold}
								display={`${zThreshold.toFixed(1)}σ`}
								min={2.2}
								max={4.6}
								step={0.1}
								onChange={setZThreshold}
								hint="Lower catches smaller prints, at the cost of more false alarms."
							/>
						</div>
						<div className="thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
							{blocks.length === 0 ? (
								<div className="m-auto max-w-[220px] text-center text-xs leading-relaxed text-muted-foreground">
									Listening. Block deals and clustered sweeps will be isolated here the moment they hit the tape.
								</div>
							) : (
								blocks.map((b) => <BlockCard key={`${b.id}-${b.prints}`} block={b} onFocus={focus} />)
							)}
						</div>
					</div>
				</GlassPanel>
			</div>
		</div>
	);
}

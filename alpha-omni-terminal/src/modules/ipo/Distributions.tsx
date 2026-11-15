import { formatInrCompact, formatInrSigned, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SimResult } from './engine';

export function AllotmentBars({ result }: { result: SimResult }) {
	const { outcomes } = result.allotment;
	// Keep the list readable when a proportionate draw yields many distinct outcomes.
	const shown = outcomes.length <= 9 ? outcomes : [...outcomes].sort((a, b) => b.prob - a.prob).slice(0, 9).sort((a, b) => a.lots - b.lots);
	const hidden = outcomes.length - shown.length;
	const max = Math.max(...shown.map((o) => o.prob), 1e-9);
	return (
		<div className="flex flex-col gap-1.5">
			{shown.map((o) => (
				<div key={o.lots} className="grid grid-cols-[62px_minmax(0,1fr)_52px] items-center gap-2">
					<span className="num text-[11px] text-muted-foreground">
						{o.lots === 0 ? 'none' : `${o.lots} lot${o.lots === 1 ? '' : 's'}`}
					</span>
					<div className="h-4 overflow-hidden rounded-[4px] bg-white/[0.04]">
						<div
							className={cn(
								'h-full rounded-[4px] transition-[width] duration-500 ease-out',
								o.lots === 0 ? 'bg-white/25' : 'bg-primary shadow-[0_0_14px_-2px_var(--primary)]'
							)}
							style={{ width: `${Math.max(0.6, (o.prob / max) * 100)}%` }}
						/>
					</div>
					<span className="num text-right text-[11px] text-foreground">{formatPct(o.prob, o.prob < 0.1 ? 2 : 1)}</span>
				</div>
			))}
			{hidden > 0 && (
				<div className="text-[10.5px] text-muted-foreground">
					+ {hidden} rarer outcome{hidden === 1 ? '' : 's'} not shown (all are counted in the totals)
				</div>
			)}
		</div>
	);
}

export function PnlHistogram({ result }: { result: SimResult }) {
	const { bins, population } = result.histogram;
	if (population === 0 || bins.length === 0) {
		return (
			<div className="flex h-full min-h-40 items-center justify-center text-center text-xs text-muted-foreground">
				No draw produced an allotment at these inputs — nothing to distribute.
			</div>
		);
	}
	const W = 560;
	const H = 170;
	const padX = 8;
	const padTop = 16;
	const padBottom = 22;
	const lo = bins[0].x0;
	const hi = bins[bins.length - 1].x1;
	const maxCount = Math.max(...bins.map((b) => b.count), 1);
	const x = (v: number) => padX + ((v - lo) / (hi - lo)) * (W - padX * 2);
	const barW = (W - padX * 2) / bins.length;
	const meanIf = result.pnl.meanIfAllotted;
	const zeroInRange = lo < 0 && hi > 0;

	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Histogram of listing-day profit and loss when shares are allotted">
			{bins.map((b, i) => {
				const h = (b.count / maxCount) * (H - padTop - padBottom);
				const mid = (b.x0 + b.x1) / 2;
				return (
					<rect
						key={i}
						x={padX + i * barW + 1}
						y={H - padBottom - h}
						width={Math.max(1, barW - 2)}
						height={Math.max(0, h)}
						rx={2}
						fill={mid >= 0 ? 'var(--bull)' : 'var(--bear)'}
						opacity={0.35 + 0.6 * (b.count / maxCount)}
					>
						<title>
							{formatInrSigned(b.x0)} to {formatInrSigned(b.x1)} — {formatPct(b.prob, 1)} of allotted draws
						</title>
					</rect>
				);
			})}
			<line x1={padX} x2={W - padX} y1={H - padBottom} y2={H - padBottom} stroke="rgb(255 255 255 / 0.15)" />
			{zeroInRange && (
				<g>
					<line x1={x(0)} x2={x(0)} y1={padTop - 4} y2={H - padBottom} stroke="rgb(255 255 255 / 0.4)" strokeDasharray="3 3" />
					<text x={x(0)} y={H - 7} textAnchor="middle" className="num" fontSize="10" fill="rgb(255 255 255 / 0.55)">
						₹0
					</text>
				</g>
			)}
			{meanIf > lo && meanIf < hi && (
				<g>
					<line x1={x(meanIf)} x2={x(meanIf)} y1={padTop - 4} y2={H - padBottom} stroke="var(--primary)" strokeWidth={1.5} />
					<text
						x={x(meanIf)}
						y={9}
						textAnchor={x(meanIf) > W * 0.75 ? 'end' : 'start'}
						dx={x(meanIf) > W * 0.75 ? -5 : 5}
						className="num"
						fontSize="10"
						fill="var(--primary)"
					>
						mean {formatInrCompact(meanIf)}
					</text>
				</g>
			)}
			<text x={padX} y={H - 7} className="num" fontSize="10" fill="rgb(255 255 255 / 0.45)">
				{formatInrCompact(lo)}
			</text>
			<text x={W - padX} y={H - 7} textAnchor="end" className="num" fontSize="10" fill="rgb(255 255 255 / 0.45)">
				{formatInrCompact(hi)}
			</text>
		</svg>
	);
}

/** Box-plot strip of the simulated listing-day return. */
export function ListingFan({ result }: { result: SimResult }) {
	const { p5, p25, p50, p75, p95 } = result.listing;
	const lo = Math.min(p5, -0.05);
	const hi = Math.max(p95, 0.05);
	const span = hi - lo || 1;
	const pos = (v: number) => `${((v - lo) / span) * 100}%`;
	const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
	return (
		<div>
			<div className="relative h-9">
				<div className="absolute top-1/2 right-0 left-0 h-px bg-white/10" />
				<div
					className="absolute top-1/2 h-px bg-accent/60"
					style={{ left: pos(p5), width: `${((p95 - p5) / span) * 100}%` }}
				/>
				<div
					className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[4px] border border-accent/50 bg-accent/20"
					style={{ left: pos(p25), width: `${((p75 - p25) / span) * 100}%` }}
				/>
				<div className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 bg-accent shadow-[0_0_10px_var(--accent)]" style={{ left: pos(p50) }} />
				<div className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/35" style={{ left: pos(0) }} />
			</div>
			<div className="num mt-1 grid grid-cols-5 text-[10.5px] text-muted-foreground">
				<span>p5 {fmt(p5)}</span>
				<span className="text-center">p25 {fmt(p25)}</span>
				<span className="text-center text-accent">median {fmt(p50)}</span>
				<span className="text-center">p75 {fmt(p75)}</span>
				<span className="text-right">p95 {fmt(p95)}</span>
			</div>
		</div>
	);
}

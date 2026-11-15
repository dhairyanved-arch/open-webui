import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatInrSigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SimResult } from './engine';
import { probHeat } from './heat';

function pct(p: number) {
	if (p === 0) return '—';
	if (p < 0.0005) return '<0.1%';
	return `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`;
}

/**
 * Joint outcome matrix from the 10,000 draws: listing-day return bucket (rows)
 * against lots allotted (columns). Cell heat is the share of draws that landed
 * there; the grand total is checked against the iteration count.
 */
export function JointHeatmap({ result }: { result: SimResult }) {
	const { joint } = result;
	const maxProb = Math.max(...joint.cells.flat().map((c) => c.prob), 1e-9);
	const exact = joint.totalCount === result.iterations;

	return (
		<div className="flex h-full flex-col">
			<div className="thin-scroll min-h-0 flex-1 overflow-x-auto">
				<table className="w-full border-separate border-spacing-[3px] text-center">
					<thead>
						<tr>
							<th className="kicker w-[104px] pb-1 text-left font-normal">Listing return</th>
							{joint.cols.map((col) => (
								<th key={col.label} className="kicker pb-1 font-normal whitespace-nowrap">
									{col.label}
								</th>
							))}
							<th className="kicker w-14 pb-1 font-normal">Row Σ</th>
						</tr>
					</thead>
					<tbody>
						{joint.cells.map((row, ri) => (
							<tr key={joint.rows[ri]}>
								<th className="num pr-2 text-left text-[11px] font-normal whitespace-nowrap text-muted-foreground">
									{joint.rows[ri]}
								</th>
								{row.map((cell, ci) => (
									<td key={ci} className="p-0">
										<Tooltip>
											<TooltipTrigger asChild>
												<div
													tabIndex={0}
													className="num flex h-10 min-w-[58px] cursor-default flex-col items-center justify-center rounded-md text-[12px] leading-tight transition-[background-color] duration-300 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
													style={probHeat(cell.prob / maxProb)}
												>
													<span className="font-medium">{pct(cell.prob)}</span>
													{cell.count > 0 && ci > 0 && (
														<span className="text-[9.5px] opacity-75">{formatInrSigned(cell.avgPnl)}</span>
													)}
												</div>
											</TooltipTrigger>
											<TooltipContent>
												<div className="num">
													{cell.count.toLocaleString('en-IN')} of {result.iterations.toLocaleString('en-IN')} draws
												</div>
												<div className="text-muted-foreground">
													{joint.cols[ci].label} · listing {joint.rows[ri]}
													{ci > 0 && cell.count > 0 && <> · avg P&L {formatInrSigned(cell.avgPnl)}</>}
												</div>
											</TooltipContent>
										</Tooltip>
									</td>
								))}
								<td className="num text-[11px] text-muted-foreground">{pct(joint.rowTotals[ri])}</td>
							</tr>
						))}
						<tr>
							<th className="kicker pt-1 text-left font-normal">Column Σ</th>
							{joint.colTotals.map((t, ci) => (
								<td key={ci} className="num pt-1 text-[11px] text-muted-foreground">
									{pct(t)}
								</td>
							))}
							<td className={cn('num pt-1 text-[11px] font-medium', exact ? 'text-bull' : 'text-bear')}>
								{(joint.probSum * 100).toFixed(2)}%
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div
				data-testid="normalisation-check"
				data-ok={exact}
				className={cn(
					'num mt-3 flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px]',
					exact ? 'border-bull/25 bg-bull/[0.06] text-bull' : 'border-bear/30 bg-bear/[0.08] text-bear'
				)}
			>
				{exact ? <CircleCheck className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
				<span>
					Σ cells = {(joint.probSum * 100).toFixed(2)}% · {joint.totalCount.toLocaleString('en-IN')} /{' '}
					{result.iterations.toLocaleString('en-IN')} draws accounted for
				</span>
			</div>
		</div>
	);
}

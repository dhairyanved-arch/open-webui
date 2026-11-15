import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Segmented } from '@/components/fx/primitives';
import { formatInrCompact, formatInrSigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SCENARIO_GMP_PCTS, SCENARIO_SUBSCRIPTIONS, type ScenarioCell } from './engine';
import { pnlHeat, probHeat } from './heat';

type Metric = 'expectedPnl' | 'pAllot' | 'pnlIfAllotted';

const METRICS: Array<{ value: Metric; label: string }> = [
	{ value: 'expectedPnl', label: 'Expected P&L' },
	{ value: 'pAllot', label: 'P(allotment)' },
	{ value: 'pnlIfAllotted', label: 'P&L if allotted' }
];

function nearestIndex(values: number[], target: number, log = false) {
	let best = 0;
	let bestDist = Infinity;
	values.forEach((v, i) => {
		const d = log ? Math.abs(Math.log(v) - Math.log(Math.max(target, 1e-6))) : Math.abs(v - target);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	});
	return best;
}

export function ScenarioHeatmap({
	grid,
	currentSubscription,
	currentGmpPct,
	categoryLabel
}: {
	grid: ScenarioCell[][];
	currentSubscription: number;
	currentGmpPct: number;
	categoryLabel: string;
}) {
	const [metric, setMetric] = React.useState<Metric>('expectedPnl');
	const flat = grid.flat();
	const maxAbs = Math.max(...flat.map((c) => Math.abs(c[metric])), 1e-9);
	const hereCol = nearestIndex(SCENARIO_SUBSCRIPTIONS, currentSubscription, true);
	const hereRow = nearestIndex(SCENARIO_GMP_PCTS, currentGmpPct);

	return (
		<div className="flex h-full flex-col">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<Segmented ariaLabel="Scenario metric" value={metric} options={METRICS} onChange={setMetric} />
				<div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
					<span className="inline-block size-2.5 rounded-[3px] ring-2 ring-white" /> your live inputs
				</div>
			</div>
			<div className="thin-scroll min-h-0 flex-1 overflow-x-auto">
				<table className="w-full border-separate border-spacing-[3px] text-center">
					<thead>
						<tr>
							<th className="kicker w-11 pb-1 text-left font-normal">GMP</th>
							{SCENARIO_SUBSCRIPTIONS.map((s) => (
								<th key={s} className="num pb-1 text-[10.5px] font-normal text-muted-foreground">
									{s}×
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{grid.map((row, ri) => (
							<tr key={SCENARIO_GMP_PCTS[ri]}>
								<th className="num pr-1 text-left text-[11px] font-normal text-muted-foreground">
									{SCENARIO_GMP_PCTS[ri] > 0 ? '+' : ''}
									{SCENARIO_GMP_PCTS[ri]}%
								</th>
								{row.map((cell, ci) => {
									const here = ri === hereRow && ci === hereCol;
									const style =
										metric === 'pAllot' ? probHeat(cell.pAllot) : pnlHeat(cell[metric] / maxAbs);
									return (
										<td key={ci} className="p-0">
											<Tooltip>
												<TooltipTrigger asChild>
													<div
														tabIndex={0}
														className={cn(
															'num flex h-[34px] min-w-[36px] cursor-default items-center justify-center rounded-md text-[10px] font-medium transition-[background-color] duration-300 outline-none focus-visible:ring-2 focus-visible:ring-white/40',
															here && 'ring-2 ring-white'
														)}
														style={style}
													>
														{metric === 'pAllot'
															? `${(cell.pAllot * 100).toFixed(cell.pAllot < 0.1 ? 1 : 0)}%`
															: formatInrCompact(cell[metric]).replace('₹', '')}
													</div>
												</TooltipTrigger>
												<TooltipContent>
													<div className="num font-medium">
														{cell.subscription}× {categoryLabel} · GMP {cell.gmpPct > 0 ? '+' : ''}
														{cell.gmpPct}%
													</div>
													<div className="num text-muted-foreground">
														P(allot) {(cell.pAllot * 100).toFixed(1)}% · E[P&L] {formatInrSigned(cell.expectedPnl)}
													</div>
													<div className="num text-muted-foreground">
														if allotted {formatInrSigned(cell.pnlIfAllotted)}
													</div>
												</TooltipContent>
											</Tooltip>
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="kicker mt-2 text-center">{categoryLabel} subscription →</div>
		</div>
	);
}

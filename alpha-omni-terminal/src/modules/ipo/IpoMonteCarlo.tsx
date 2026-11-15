import * as React from 'react';
import { RefreshCw, Timer } from 'lucide-react';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { NumberField } from '@/components/fx/NumberField';
import { ModuleHeader, Segmented, SliderField, Stat } from '@/components/fx/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMockData } from '@/context/MockDataContext';
import type { IpoPreset } from '@/data/generators';
import { formatInr, formatInrCompact, formatInrSigned, formatPct } from '@/lib/format';
import { clamp } from '@/lib/utils';
import { AllotmentBars, ListingFan, PnlHistogram } from './Distributions';
import { JointHeatmap } from './JointHeatmap';
import { ScenarioHeatmap } from './ScenarioHeatmap';
import {
	DEFAULT_ITERATIONS,
	categoryRules,
	scenarioGrid,
	simulateIpo,
	type IpoCategory,
	type IpoInputs
} from './engine';

const SCENARIO_ITERATIONS = 2_500;

function inputsFromPreset(preset: IpoPreset): IpoInputs {
	return {
		issuePrice: preset.issuePrice,
		lotSize: preset.lotSize,
		gmp: preset.gmp,
		subRetail: preset.subRetail,
		subNII: preset.subNII,
		subQIB: preset.subQIB,
		category: 'retail',
		applications: 3,
		unitsPerApp: 1,
		subscriptionVol: 0.15
	};
}

/** Subscription multiples span three decades, so the slider runs in log space. */
function SubscriptionField({
	label,
	value,
	onChange,
	tone
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	tone: 'primary' | 'accent' | 'violet';
}) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_92px] items-end gap-3">
			<SliderField
				label={label}
				tone={tone}
				value={Math.log10(clamp(value, 0.05, 1000))}
				display={`${value >= 100 ? value.toFixed(0) : value.toFixed(2)}×`}
				min={-1.3}
				max={3}
				step={0.01}
				onChange={(v) => onChange(+Math.pow(10, v).toFixed(2))}
			/>
			<NumberField label="multiple" value={value} onChange={onChange} min={0.01} max={1000} step={0.1} suffix="×" />
		</div>
	);
}

export default function IpoMonteCarlo() {
	const { universe } = useMockData();
	const [presetId, setPresetId] = React.useState(universe.ipos[0].id);
	const [inputs, setInputs] = React.useState<IpoInputs>(() => inputsFromPreset(universe.ipos[0]));
	const [drawSeed, setDrawSeed] = React.useState(1);

	// A reseed of the mock universe swaps the IPO pipeline underneath us.
	React.useEffect(() => {
		setPresetId(universe.ipos[0].id);
		setInputs(inputsFromPreset(universe.ipos[0]));
	}, [universe]);

	const preset = universe.ipos.find((p) => p.id === presetId) ?? universe.ipos[0];
	const set = <K extends keyof IpoInputs>(key: K, value: IpoInputs[K]) =>
		setInputs((prev) => ({ ...prev, [key]: value }));

	// Typing stays instant; the simulation follows on the deferred copy.
	const deferred = React.useDeferredValue(inputs);
	const rules = React.useMemo(() => categoryRules(deferred), [deferred]);
	const result = React.useMemo(() => simulateIpo(deferred, DEFAULT_ITERATIONS, drawSeed), [deferred, drawSeed]);
	const grid = React.useMemo(() => scenarioGrid(deferred, SCENARIO_ITERATIONS, drawSeed), [deferred, drawSeed]);

	const liveRules = categoryRules(inputs);
	const unitsPerApp = clamp(inputs.unitsPerApp, 1, liveRules.maxUnits);
	const gmpPct = inputs.issuePrice > 0 ? (inputs.gmp / inputs.issuePrice) * 100 : 0;
	const categorySub = inputs.category === 'retail' ? inputs.subRetail : inputs.subNII;
	const bidValue = unitsPerApp * liveRules.unitLots * liveRules.lotValue;

	const selectPreset = (id: string) => {
		const next = universe.ipos.find((p) => p.id === id);
		if (!next) return;
		setPresetId(id);
		setInputs((prev) => ({ ...inputsFromPreset(next), category: prev.category, applications: prev.applications, subscriptionVol: prev.subscriptionVol }));
	};

	return (
		<div className="thin-scroll h-full overflow-y-auto">
			<div className="mx-auto flex max-w-[1760px] flex-col gap-4 p-5">
				<ModuleHeader
					index="01"
					domain="Primary markets"
					title="The IPO Monte Carlo Engine"
					lede="Feed in the live subscription book and grey-market premium. Ten thousand simulated closes run the SEBI basis-of-allotment draw for your category, then a listing day, and report what you can actually expect to take home."
					actions={
						<>
							<Badge variant="default" data-testid="sim-meta">
								<Timer className="size-3" />
								{result.iterations.toLocaleString('en-IN')} iterations · {result.elapsedMs.toFixed(1)} ms
							</Badge>
							<Button variant="outline" size="sm" onClick={() => setDrawSeed((s) => s + 1)}>
								<RefreshCw /> Re-roll draws
							</Button>
						</>
					}
				/>

				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
					{/* ── inputs ── */}
					<div className="flex flex-col gap-4">
						<GlassPanel kicker="Issue" title="Offer terms">
							<div className="flex flex-col gap-3">
								<div>
									<Label className="mb-1 block">IPO pipeline (mock)</Label>
									<Select value={presetId} onValueChange={selectPreset}>
										<SelectTrigger aria-label="IPO preset">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{universe.ipos.map((p) => (
												<SelectItem key={p.id} value={p.id}>
													{p.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
										<Badge variant="accent">{preset.sector}</Badge>
										<Badge>{formatInrCompact(preset.issueSizeCr * 1e7)} issue</Badge>
										<Badge variant="primary">{preset.status}</Badge>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<NumberField label="Issue price" prefix="₹" value={inputs.issuePrice} min={1} max={100000} step={1} onChange={(v) => set('issuePrice', v)} />
									<NumberField label="Lot size" suffix="sh" value={inputs.lotSize} min={1} max={10000} step={1} onChange={(v) => set('lotSize', Math.round(v))} />
								</div>
								<div className="grid grid-cols-[minmax(0,1fr)_92px] items-end gap-3">
									<SliderField
										label="Live GMP"
										tone={inputs.gmp >= 0 ? 'bull' : 'bear'}
										value={clamp(gmpPct, -30, 150)}
										display={`${gmpPct >= 0 ? '+' : '−'}${Math.abs(gmpPct).toFixed(1)}%`}
										min={-30}
										max={150}
										step={0.5}
										onChange={(v) => set('gmp', Math.round((v / 100) * inputs.issuePrice))}
									/>
									<NumberField label="₹ / share" prefix="₹" value={inputs.gmp} min={-100000} max={100000} step={1} onChange={(v) => set('gmp', v)} />
								</div>
								<div className="num rounded-md border border-white/[0.06] bg-black/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
									One lot = {formatInr(liveRules.lotValue)} · implied listing ≈ {formatInr(inputs.issuePrice + inputs.gmp)}
								</div>
							</div>
						</GlassPanel>

						<GlassPanel kicker="Demand" title="Subscription book">
							<div className="flex flex-col gap-3">
								<SubscriptionField label="Retail" tone="primary" value={inputs.subRetail} onChange={(v) => set('subRetail', v)} />
								<SubscriptionField label="NII (HNI)" tone="violet" value={inputs.subNII} onChange={(v) => set('subNII', v)} />
								<SubscriptionField label="QIB" tone="accent" value={inputs.subQIB} onChange={(v) => set('subQIB', v)} />
								<SliderField
									label="Final-book uncertainty"
									value={inputs.subscriptionVol}
									display={`±${(inputs.subscriptionVol * 100).toFixed(0)}%`}
									min={0}
									max={0.5}
									step={0.01}
									onChange={(v) => set('subscriptionVol', v)}
									hint="How far the closing book may drift from the live figures (log-σ)."
								/>
							</div>
						</GlassPanel>

						<GlassPanel kicker="You" title="Your application">
							<div className="flex flex-col gap-3">
								<Segmented<IpoCategory>
									ariaLabel="Application category"
									className="w-full [&>button]:flex-1"
									value={inputs.category}
									onChange={(v) => setInputs((prev) => ({ ...prev, category: v, unitsPerApp: 1 }))}
									options={[
										{ value: 'retail', label: 'Retail ≤ ₹2L' },
										{ value: 'snii', label: 'sNII ₹2–10L' },
										{ value: 'bnii', label: 'bNII > ₹10L' }
									]}
								/>
								<SliderField
									label="Applications (separate PANs)"
									value={inputs.applications}
									display={inputs.applications}
									min={1}
									max={10}
									step={1}
									onChange={(v) => set('applications', v)}
								/>
								<SliderField
									label="Bid size per application"
									value={unitsPerApp}
									display={`${unitsPerApp * liveRules.unitLots} lot${unitsPerApp * liveRules.unitLots === 1 ? '' : 's'} · ${formatInrCompact(bidValue)}`}
									min={1}
									max={Math.max(2, liveRules.maxUnits)}
									step={1}
									onChange={(v) => set('unitsPerApp', clamp(v, 1, liveRules.maxUnits))}
									hint={
										categorySub > 1
											? 'Oversubscribed: a larger bid does not improve lottery odds — only more applications do.'
											: 'Undersubscribed: you receive every lot you bid for.'
									}
								/>
							</div>
						</GlassPanel>
					</div>

					{/* ── outputs ── */}
					<div className="flex min-w-0 flex-col gap-4">
						<div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
							<Stat
								label="P(any allotment)"
								tone="primary"
								value={formatPct(result.allotment.pAny, 1)}
								hint={`${formatPct(result.allotment.perApplication, 2)} per application · ${rules.label}`}
							/>
							<Stat
								label="Expected P&L"
								tone={result.pnl.mean >= 0 ? 'bull' : 'bear'}
								value={formatInrSigned(result.pnl.mean)}
								hint={`${formatPct(result.pnl.returnOnBlocked, 2)} on blocked capital`}
							/>
							<Stat
								label="P&L if allotted"
								tone={result.pnl.meanIfAllotted >= 0 ? 'bull' : 'bear'}
								value={formatInrSigned(result.pnl.meanIfAllotted)}
								hint={`profit in ${formatPct(result.pnl.pProfit, 1)} of all draws`}
							/>
							<Stat
								label="5% – 95% range"
								value={
									<span className="flex flex-wrap items-baseline gap-x-1.5 text-[1.05rem] leading-tight">
										<span className="whitespace-nowrap">{formatInrSigned(result.pnl.p5)}</span>
										<span className="text-[0.8rem] text-muted-foreground">to</span>
										<span className="whitespace-nowrap">{formatInrSigned(result.pnl.p95)}</span>
									</span>
								}
								hint={`loss in ${formatPct(result.pnl.pLoss, 1)} of draws`}
							/>
							<Stat
								label="Capital blocked (ASBA)"
								value={formatInrCompact(result.capitalBlocked)}
								hint={`expected ${result.allotment.expectedLots.toFixed(2)} lots allotted`}
							/>
						</div>

						<div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
							<GlassPanel
								kicker="Heat map · 10,000 draws"
								title="Allotment × listing-day outcome"
								className="min-h-[430px]"
							>
								<JointHeatmap result={result} />
							</GlassPanel>
							<GlassPanel
								kicker={`Heat map · ${SCENARIO_ITERATIONS.toLocaleString('en-IN')} draws per cell`}
								title="Scenario surface — subscription × GMP"
								className="min-h-[430px]"
							>
								<ScenarioHeatmap
									grid={grid}
									currentSubscription={categorySub}
									currentGmpPct={gmpPct}
									categoryLabel={rules.label}
								/>
							</GlassPanel>
						</div>

						<div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
							<GlassPanel kicker="Draw mechanics" title="Lots allotted">
								<AllotmentBars result={result} />
								<div className="mt-4 border-t border-white/[0.06] pt-3">
									<div className="kicker mb-2">Listing-day return (all draws)</div>
									<ListingFan result={result} />
								</div>
							</GlassPanel>
							<GlassPanel kicker="Conditional on receiving shares" title="Listing-day P&L distribution">
								<div className="h-[210px]">
									<PnlHistogram result={result} />
								</div>
								<p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
									{formatPct(1 - result.allotment.pAny, 1)} of draws end with no allotment and ₹0 P&L; they are
									excluded here so the shape of the allotted outcomes is visible. GMP is realised with a
									demand-weighted haircut — heavier QIB books hold their premium better.
								</p>
							</GlassPanel>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

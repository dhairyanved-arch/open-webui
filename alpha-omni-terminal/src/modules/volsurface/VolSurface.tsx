import * as React from 'react';
import { MousePointer2, RotateCcw } from 'lucide-react';
import { CanvasBoundary } from '@/components/fx/CanvasBoundary';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { ModuleHeader, Segmented, SliderField } from '@/components/fx/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useMockData } from '@/context/MockDataContext';
import type { OptionDesk } from '@/data/generators';
import { cn } from '@/lib/utils';
import type { OptionType } from './blackScholes';
import { SmileSlice } from './SmileSlice';
import { RAMP_CSS, SurfaceScene, type Probe } from './SurfaceScene';
import { METRICS, computeField, evaluatePoint, type SurfaceMetric, type SurfaceParams } from './surfaceModel';

interface Controls {
	spot: number;
	atmIv: number;
	daysElapsed: number;
	skew: number;
	convexity: number;
	riskFree: number;
}

function controlsFromDesk(desk: OptionDesk): Controls {
	return { spot: desk.spot, atmIv: desk.atmIv, daysElapsed: 0, skew: desk.skew, convexity: desk.convexity, riskFree: desk.riskFree };
}

const METRIC_OPTIONS: Array<{ value: SurfaceMetric; label: string }> = (
	['value', 'iv', 'delta', 'gamma', 'vega', 'theta'] as SurfaceMetric[]
).map((m) => ({ value: m, label: METRICS[m].label }));

const inr = (v: number, d = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

function GreekCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
	return (
		<div className="rounded-md border border-white/[0.06] bg-black/25 px-2.5 py-1.5">
			<div className="kicker">{label}</div>
			<div className={cn('num mt-0.5 text-[15px] leading-tight', tone ?? 'text-foreground')}>{value}</div>
		</div>
	);
}

export default function VolSurface() {
	const { universe } = useMockData();
	const desk = universe.optionDesk;
	const [controls, setControls] = React.useState<Controls>(() => controlsFromDesk(desk));
	const [optionType, setOptionType] = React.useState<OptionType>('call');
	const [metric, setMetric] = React.useState<SurfaceMetric>('value');
	const [showGrid, setShowGrid] = React.useState(true);
	const [autoRotate, setAutoRotate] = React.useState(false);
	const [probe, setProbe] = React.useState<Probe | null>(null);

	React.useEffect(() => setControls(controlsFromDesk(desk)), [desk]);

	const set = <K extends keyof Controls>(key: K, value: Controls[K]) => setControls((c) => ({ ...c, [key]: value }));

	const params = React.useMemo<SurfaceParams>(
		() => ({ ...controls, refSpot: desk.spot, optionType }),
		[controls, desk.spot, optionType]
	);

	// One pass over the grid per parameter change; the scene only applies it to the buffers.
	const field = React.useMemo(() => computeField(params, metric), [params, metric]);
	const spec = METRICS[metric];

	// Readout follows the hover probe, otherwise the listed 30-day at-the-money strike.
	const atmStrike = Math.round(controls.spot / 50) * 50;
	const focus = probe ?? { strike: atmStrike, days: 30 };
	const point = evaluatePoint(params, focus.strike, focus.days);
	const g = point.greeks;

	return (
		<div className="flex h-full flex-col gap-4 p-5">
			<ModuleHeader
				index="02"
				domain="Derivatives"
				title="3D Volatility Surface"
				lede="A live Black-Scholes surface over strike and expiry, priced off a skewed volatility smile. Move spot, implied vol or the calendar and the mesh re-solves every vertex — drag to orbit, hover to probe the Greeks at any point."
				actions={
					<>
						<Badge variant="accent">{desk.underlying}</Badge>
						<Button variant="outline" size="sm" onClick={() => setControls(controlsFromDesk(desk))}>
							<RotateCcw /> Reset desk
						</Button>
					</>
				}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
				{/* ── canvas ── */}
				<GlassPanel still flush className="relative min-h-[460px] overflow-hidden">
					<div
						data-testid="surface-stage"
						data-field-range={`${field.min.toFixed(4)}|${field.max.toFixed(4)}`}
						className="absolute inset-0"
						style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 45%, rgb(77 227 255 / 0.06), transparent 70%)' }}
					>
						<CanvasBoundary>
							<SurfaceScene
								field={field}
								params={params}
								metric={metric}
								showGrid={showGrid}
								autoRotate={autoRotate}
								probe={probe}
								onProbe={setProbe}
							/>
						</CanvasBoundary>
					</div>

					<div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
						<div className="pointer-events-auto flex flex-wrap gap-2">
							<Segmented ariaLabel="Surface metric" value={metric} options={METRIC_OPTIONS} onChange={setMetric} className="hud" />
							<Segmented<OptionType>
								ariaLabel="Option type"
								value={optionType}
								onChange={setOptionType}
								className="hud"
								options={[
									{ value: 'call', label: 'Call' },
									{ value: 'put', label: 'Put' },
									{ value: 'straddle', label: 'Straddle' }
								]}
							/>
						</div>
						<div className="hud pointer-events-auto flex items-center gap-4 rounded-lg px-3 py-1.5">
							<div className="flex items-center gap-2">
								<Switch id="vs-grid" checked={showGrid} onCheckedChange={setShowGrid} />
								<Label htmlFor="vs-grid">Wire</Label>
							</div>
							<div className="flex items-center gap-2">
								<Switch id="vs-rotate" checked={autoRotate} onCheckedChange={setAutoRotate} />
								<Label htmlFor="vs-rotate">Orbit</Label>
							</div>
						</div>
					</div>

					<div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
						<div className="hud rounded-lg px-3 py-2">
							<div className="kicker mb-1.5">
								{spec.label} · {spec.unit}
							</div>
							<div className="h-2 w-52 rounded-full" style={{ background: field.signed ? RAMP_CSS.diverging : RAMP_CSS.sequential }} />
							<div className="num mt-1 flex justify-between text-[10px] text-muted-foreground">
								<span>{spec.format(field.min)}</span>
								<span>{spec.format(field.max)}</span>
							</div>
						</div>
						<div className="hud flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
							<MousePointer2 className="size-3.5" />
							drag to orbit · scroll to zoom · hover to probe
						</div>
					</div>
				</GlassPanel>

				{/* ── controls ── */}
				<div className="thin-scroll flex min-h-0 flex-col gap-4 xl:overflow-y-auto xl:pr-1 [&>section]:shrink-0">
					<GlassPanel kicker="Inputs" title="Market state">
						<div className="flex flex-col gap-3.5">
							<SliderField
								label="Underlying price"
								tone="primary"
								value={controls.spot}
								display={inr(controls.spot, 0)}
								min={Math.round(desk.spot * 0.8)}
								max={Math.round(desk.spot * 1.2)}
								step={10}
								onChange={(v) => set('spot', v)}
								hint={`${controls.spot >= desk.spot ? '+' : '−'}${Math.abs((controls.spot / desk.spot - 1) * 100).toFixed(1)}% vs desk open ${inr(desk.spot, 0)}`}
							/>
							<SliderField
								label="Implied volatility (ATM)"
								tone="accent"
								value={controls.atmIv}
								display={`${(controls.atmIv * 100).toFixed(1)}%`}
								min={0.05}
								max={0.8}
								step={0.005}
								onChange={(v) => set('atmIv', v)}
							/>
							<SliderField
								label="Theta decay"
								tone="bear"
								value={controls.daysElapsed}
								display={`${controls.daysElapsed}d elapsed`}
								min={0}
								max={90}
								step={1}
								onChange={(v) => set('daysElapsed', v)}
								hint="Rolls the calendar forward: every expiry loses this many days and time value bleeds out."
							/>
						</div>
					</GlassPanel>

					<GlassPanel
						kicker={probe ? 'Probe' : 'At the money · 30d listed'}
						title={`${inr(focus.strike, 0)} ${optionType} · ${point.daysLeft > 0 ? `${point.daysLeft.toFixed(0)}d left` : 'expired'}`}
					>
						<div data-testid="greeks-readout" className="grid grid-cols-2 gap-2">
							<GreekCell label="Value" value={`₹${inr(g.price)}`} tone="text-primary" />
							<GreekCell label="Implied vol" value={`${(point.sigma * 100).toFixed(2)}%`} tone="text-accent" />
							<GreekCell label="Delta" value={g.delta.toFixed(4)} />
							<GreekCell label="Gamma" value={g.gamma.toExponential(3)} />
							<GreekCell label="Vega / vol pt" value={`₹${inr(g.vega)}`} />
							<GreekCell label="Theta / day" value={`${g.theta < 0 ? '−' : ''}₹${inr(Math.abs(g.theta))}`} tone={g.theta < 0 ? 'text-bear' : 'text-bull'} />
						</div>
					</GlassPanel>

					<GlassPanel kicker="Smile" title="Surface shape">
						<div className="flex flex-col gap-3.5">
							<SliderField
								label="Skew"
								tone="violet"
								value={controls.skew}
								display={controls.skew.toFixed(2)}
								min={-0.8}
								max={0.4}
								step={0.01}
								onChange={(v) => set('skew', v)}
							/>
							<SliderField
								label="Convexity (wings)"
								tone="violet"
								value={controls.convexity}
								display={controls.convexity.toFixed(2)}
								min={0}
								max={1.5}
								step={0.01}
								onChange={(v) => set('convexity', v)}
							/>
							<SliderField
								label="Risk-free rate"
								tone="violet"
								value={controls.riskFree}
								display={`${(controls.riskFree * 100).toFixed(2)}%`}
								min={0}
								max={0.12}
								step={0.0025}
								onChange={(v) => set('riskFree', v)}
							/>
							<SmileSlice params={params} />
						</div>
					</GlassPanel>
				</div>
			</div>
		</div>
	);
}

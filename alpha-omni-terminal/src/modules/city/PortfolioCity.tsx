import * as React from 'react';
import { CloudLightning, MousePointer2, RotateCcw, Shuffle, Sun } from 'lucide-react';
import { CanvasBoundary } from '@/components/fx/CanvasBoundary';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { ModuleHeader } from '@/components/fx/primitives';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMockData } from '@/context/MockDataContext';
import { CLASS_DAILY_VOL, type AssetClass, type Holding } from '@/data/generators';
import { formatInr, formatInrCompact, formatInrSigned, formatPctSigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CityScene } from './CityScene';
import { CLASS_META, WEATHER_META, buildCity, parsePortfolio, weatherFor, type Weather } from './cityModel';

const CLASS_ORDER: AssetClass[] = ['equity', 'mutual_fund', 'debt'];
const CLASS_TONE: Record<AssetClass, 'accent' | 'violet' | 'primary'> = { equity: 'accent', mutual_fund: 'violet', debt: 'primary' };
const WEATHER_ORDER: Weather[] = ['sun', 'fog', 'rain', 'storm'];
const SHORT_LABEL: Record<AssetClass, string> = { equity: 'Equity', mutual_fund: 'Funds', debt: 'Debt' };
const MAX_VALUE = 6_000_000;

/* ── one holding: allocation + daily move ─────────────────────────────────── */

const HoldingRow = React.memo(function HoldingRow({
	holding,
	selected,
	onSelect,
	onChange
}: {
	holding: Holding;
	selected: boolean;
	onSelect: (id: string) => void;
	onChange: (id: string, patch: Partial<Pick<Holding, 'value' | 'dayChangePct'>>) => void;
}) {
	const vol = CLASS_DAILY_VOL[holding.assetClass];
	const range = +(vol * 4).toFixed(2);
	const up = holding.dayChangePct >= 0;
	const ref = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}, [selected]);

	return (
		<div
			ref={ref}
			className={cn(
				'rounded-lg border px-2.5 py-2 transition-colors',
				selected ? 'border-white/30 bg-white/[0.06]' : 'border-white/[0.06] bg-black/20 hover:border-white/15'
			)}
		>
			<button type="button" onClick={() => onSelect(holding.id)} className="flex w-full items-baseline justify-between gap-2 text-left outline-none focus-visible:underline">
				<span className="min-w-0 truncate text-[12px] font-medium text-foreground">{holding.name}</span>
				<span className="num shrink-0 text-[11px] text-foreground/85">{formatInrCompact(holding.value)}</span>
			</button>
			<Slider
				aria-label={`Value — ${holding.name}`}
				tone={CLASS_TONE[holding.assetClass]}
				className="mt-1"
				value={[Math.min(MAX_VALUE, holding.value)]}
				min={50_000}
				max={MAX_VALUE}
				step={25_000}
				onValueChange={([v]) => onChange(holding.id, { value: v })}
			/>
			<div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)_56px] items-center gap-2">
				<span className="text-[10px] text-muted-foreground">today</span>
				<Slider
					aria-label={`Day change — ${holding.name}`}
					tone={up ? 'bull' : 'bear'}
					value={[Math.max(-range, Math.min(range, holding.dayChangePct))]}
					min={-range}
					max={range}
					step={vol < 0.5 ? 0.01 : 0.05}
					onValueChange={([v]) => onChange(holding.id, { dayChangePct: +v.toFixed(2) })}
				/>
				<span className={cn('num text-right text-[11px]', up ? 'text-bull' : 'text-bear')}>{formatPctSigned(holding.dayChangePct)}</span>
			</div>
		</div>
	);
});

/* ── JSON view of the same state ──────────────────────────────────────────── */

function JsonEditor() {
	const { portfolio, replacePortfolio } = useMockData();
	const canonical = React.useMemo(() => JSON.stringify(portfolio, null, 2), [portfolio]);
	const [draft, setDraft] = React.useState(canonical);
	const [error, setError] = React.useState<string | null>(null);
	const dirty = draft !== canonical;
	const editing = React.useRef(false);

	// Follow external changes (sliders, shocks) unless the user is mid-edit.
	React.useEffect(() => {
		if (!editing.current) {
			setDraft(canonical);
			setError(null);
		}
	}, [canonical]);

	const apply = () => {
		const result = parsePortfolio(draft);
		if ('error' in result) {
			setError(result.error);
			return;
		}
		editing.current = false;
		setError(null);
		replacePortfolio(result.portfolio);
	};

	return (
		<div className="flex h-full flex-col gap-2 px-3 pb-3">
			<p className="text-[11px] leading-relaxed text-muted-foreground">
				The city is rendered from this document. Edit values, add holdings or invent a sector, then apply.
			</p>
			<textarea
				aria-label="Portfolio JSON"
				spellCheck={false}
				value={draft}
				onChange={(e) => {
					editing.current = true;
					setDraft(e.target.value);
				}}
				className="thin-scroll num min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-foreground/90 outline-none focus:border-primary/50"
			/>
			{error && (
				<div role="alert" className="rounded-md border border-bear/30 bg-bear/10 px-2.5 py-1.5 text-[11px] text-bear">
					{error}
				</div>
			)}
			<div className="flex justify-end gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={!dirty}
					onClick={() => {
						editing.current = false;
						setDraft(canonical);
						setError(null);
					}}
				>
					Discard
				</Button>
				<Button size="sm" disabled={!dirty} onClick={apply}>
					Apply to city
				</Button>
			</div>
		</div>
	);
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function PortfolioCity() {
	const { portfolio, updateHolding, shockMarket, resetPortfolio } = useMockData();
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const [autoRotate, setAutoRotate] = React.useState(false);

	const layout = React.useMemo(() => buildCity(portfolio), [portfolio]);
	const selected = selectedId ? portfolio.holdings.find((h) => h.id === selectedId) : undefined;

	const weatherCounts = React.useMemo(() => {
		const counts: Record<Weather, number> = { sun: 0, fog: 0, rain: 0, storm: 0 };
		for (const d of layout.districts) counts[d.weather]++;
		return counts;
	}, [layout]);

	const select = React.useCallback((id: string | null) => setSelectedId(id), []);

	return (
		<div className="flex h-full flex-col gap-4 p-5">
			<ModuleHeader
				index="05"
				domain="Allocation"
				title="Portfolio City"
				lede="Your book as a skyline. Capital sets each building's height and girth, asset class sets its architecture, and today's move decides the weather over every sector — sun on what's working, rain on what isn't."
				actions={
					<>
						<Button variant="bull" size="sm" onClick={() => shockMarket(1.5)}>
							<Sun /> Bull day
						</Button>
						<Button variant="bear" size="sm" onClick={() => shockMarket(-1.7)}>
							<CloudLightning /> Bear day
						</Button>
						<Button variant="outline" size="sm" onClick={() => shockMarket(0)}>
							<Shuffle /> Shuffle
						</Button>
						<Button variant="ghost" size="sm" onClick={resetPortfolio}>
							<RotateCcw /> Reset
						</Button>
					</>
				}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
				{/* ── city ── */}
				<GlassPanel still flush className="relative min-h-[460px] overflow-hidden">
					<div
						className="absolute inset-0"
						style={{ background: 'radial-gradient(ellipse 90% 70% at 50% 20%, rgb(40 60 110 / 0.22), transparent 70%), linear-gradient(180deg, #070b14 0%, #05070a 70%)' }}
					>
						<CanvasBoundary>
							<CityScene layout={layout} selectedId={selectedId} onSelect={select} autoRotate={autoRotate} />
						</CanvasBoundary>
					</div>

					<div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
						<div className="hud rounded-lg px-3 py-2">
							<div className="kicker mb-1.5">Weather · sector move ÷ typical daily vol</div>
							<div className="flex flex-wrap gap-x-3.5 gap-y-1">
								{WEATHER_ORDER.map((w) => (
									<span key={w} className="num flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
										<span className="inline-block size-2 rounded-full" style={{ background: WEATHER_META[w].color, boxShadow: `0 0 8px ${WEATHER_META[w].color}` }} />
										<span className="font-sans text-foreground/90">{WEATHER_META[w].label}</span>
										{WEATHER_META[w].rule}
										<span className="text-foreground/60">· {weatherCounts[w]}</span>
									</span>
								))}
							</div>
						</div>
						<div className="hud pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5">
							<Switch id="city-rotate" checked={autoRotate} onCheckedChange={setAutoRotate} />
							<Label htmlFor="city-rotate">Fly-around</Label>
						</div>
					</div>

					<div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
						<div className="hud rounded-lg px-3 py-2">
							<div className="kicker mb-1.5">Architecture by asset class</div>
							<div className="flex flex-col gap-1">
								{CLASS_ORDER.map((c) => (
									<span key={c} className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
										<span className="inline-block h-2.5 w-1 rounded-full" style={{ background: CLASS_META[c].color }} />
										<span className="w-[78px] text-foreground/90">{CLASS_META[c].label}</span>
										{CLASS_META[c].architecture}
									</span>
								))}
							</div>
						</div>
						<div className="hud flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
							<MousePointer2 className="size-3.5" />
							drag to orbit · scroll to zoom · click a building
						</div>
					</div>
				</GlassPanel>

				{/* ── allocator ── */}
				<GlassPanel still flush className="min-h-[460px] overflow-hidden" bodyClassName="flex flex-col">
					<div className="shrink-0 px-4 pt-4">
						<div className="flex items-end justify-between gap-3">
							<div>
								<div className="kicker">Portfolio value</div>
								<div data-testid="portfolio-total" className="num mt-0.5 text-[1.6rem] leading-none font-medium text-foreground">
									{formatInr(layout.total)}
								</div>
							</div>
							<div className="text-right">
								<div className="kicker">Today</div>
								<div data-testid="portfolio-day" className={cn('num mt-0.5 text-[15px] leading-none', layout.dayPnl >= 0 ? 'text-bull' : 'text-bear')}>
									{formatInrSigned(layout.dayPnl)}
								</div>
								<div className={cn('num mt-1 text-[11px]', layout.dayPnl >= 0 ? 'text-bull' : 'text-bear')}>{formatPctSigned(layout.dayChangePct)}</div>
							</div>
						</div>
						<div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/5">
							{CLASS_ORDER.map((c) => (
								<div
									key={c}
									className="h-full transition-[width] duration-300"
									style={{ width: `${layout.byClass[c].weightPct}%`, background: CLASS_META[c].color }}
									title={`${CLASS_META[c].label} ${layout.byClass[c].weightPct.toFixed(1)}%`}
								/>
							))}
						</div>
						<div className="num mt-1.5 grid grid-cols-3 gap-2 text-[10.5px]">
							{CLASS_ORDER.map((c) => (
								<div key={c}>
									<span className="whitespace-nowrap" style={{ color: CLASS_META[c].color }}>
										{SHORT_LABEL[c]}
									</span>
									<span className="ml-1.5 text-foreground/85">{layout.byClass[c].weightPct.toFixed(1)}%</span>
								</div>
							))}
						</div>
					</div>

					<Tabs defaultValue="holdings" className="mt-3 flex min-h-0 flex-1 flex-col">
						<div className="flex shrink-0 items-center justify-between px-4 pb-2">
							<TabsList>
								<TabsTrigger value="holdings">Holdings</TabsTrigger>
								<TabsTrigger value="json">JSON</TabsTrigger>
							</TabsList>
							{selected && (
								<span data-testid="selected-holding" className="num truncate pl-3 text-[10.5px] text-muted-foreground">
									selected <span className="text-foreground">{selected.ticker}</span>
								</span>
							)}
						</div>

						<TabsContent value="holdings" className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
							{layout.districts.map((d) => (
								<div key={`${d.assetClass}-${d.sector}`} className="mb-3 last:mb-0">
									<div className="mb-1.5 flex items-center justify-between px-1">
										<span className="flex items-center gap-2">
											<span className="inline-block h-3 w-1 rounded-full" style={{ background: CLASS_META[d.assetClass].color }} />
											<span className="text-[11.5px] font-medium text-foreground">{d.sector}</span>
											<span className="text-[10px] text-muted-foreground">{CLASS_META[d.assetClass].label}</span>
										</span>
										<span className="num flex items-center gap-1.5 text-[10.5px]">
											<span style={{ color: WEATHER_META[weatherFor(d.sigmaMove)].color }}>{WEATHER_META[d.weather].label}</span>
											<span className={d.dayChangePct >= 0 ? 'text-bull' : 'text-bear'}>{formatPctSigned(d.dayChangePct)}</span>
										</span>
									</div>
									<div className="flex flex-col gap-1.5">
										{d.buildings.map((b) => (
											<HoldingRow
												key={b.holding.id}
												holding={b.holding}
												selected={selectedId === b.holding.id}
												onSelect={select}
												onChange={updateHolding}
											/>
										))}
									</div>
								</div>
							))}
						</TabsContent>

						<TabsContent value="json" className="min-h-0 flex-1">
							<JsonEditor />
						</TabsContent>
					</Tabs>
				</GlassPanel>
			</div>
		</div>
	);
}

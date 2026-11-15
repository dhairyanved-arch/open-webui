import * as React from 'react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';

/** Fixed atmospheric layers behind the whole terminal. */
export function Backdrop() {
	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
			<div
				className="absolute -top-[30%] -left-[10%] h-[80vh] w-[70vw] rounded-full opacity-60 blur-[120px] animate-aurora"
				style={{ background: 'radial-gradient(closest-side, rgb(255 178 36 / 0.16), transparent)' }}
			/>
			<div
				className="absolute -right-[15%] -bottom-[35%] h-[90vh] w-[70vw] rounded-full opacity-60 blur-[130px] animate-aurora"
				style={{
					background: 'radial-gradient(closest-side, rgb(77 227 255 / 0.13), transparent)',
					animationDelay: '-9s'
				}}
			/>
			<div
				className="absolute inset-0 opacity-[0.55]"
				style={{
					backgroundImage:
						'linear-gradient(rgb(255 255 255 / 0.028) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.028) 1px, transparent 1px)',
					backgroundSize: '44px 44px',
					maskImage: 'radial-gradient(ellipse 90% 80% at 50% 30%, #000 30%, transparent 85%)'
				}}
			/>
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
		</div>
	);
}

interface ModuleHeaderProps {
	index: string;
	domain: string;
	title: React.ReactNode;
	lede: React.ReactNode;
	actions?: React.ReactNode;
}

export function ModuleHeader({ index, domain, title, lede, actions }: ModuleHeaderProps) {
	return (
		<header className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
			<div className="min-w-0">
				<div className="kicker flex items-center gap-2">
					<span className="text-primary">Module {index}</span>
					<span className="h-px w-6 bg-white/15" />
					<span>{domain}</span>
				</div>
				<h1 className="mt-1 font-serif text-[2.1rem] leading-[1.05] tracking-tight text-foreground italic">
					{title}
				</h1>
				<p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">{lede}</p>
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</header>
	);
}

type Tone = 'default' | 'bull' | 'bear' | 'primary' | 'accent' | 'violet';

const toneText: Record<Tone, string> = {
	default: 'text-foreground',
	bull: 'text-bull',
	bear: 'text-bear',
	primary: 'text-primary',
	accent: 'text-accent',
	violet: 'text-violet'
};

export function Stat({
	label,
	value,
	hint,
	tone = 'default',
	className
}: {
	label: string;
	value: React.ReactNode;
	hint?: React.ReactNode;
	tone?: Tone;
	className?: string;
}) {
	return (
		<div className={cn('glass rounded-xl px-4 py-3', className)}>
			<div className="kicker">{label}</div>
			<div className={cn('num mt-1 text-[1.45rem] leading-none font-medium', toneText[tone])}>{value}</div>
			{hint && <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
		</div>
	);
}

/** Labelled slider row with a live mono readout — the terminal's standard control. */
export function SliderField({
	label,
	value,
	display,
	min,
	max,
	step,
	onChange,
	tone = 'primary',
	hint
}: {
	label: string;
	value: number;
	display: React.ReactNode;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	tone?: 'primary' | 'accent' | 'violet' | 'bull' | 'bear';
	hint?: React.ReactNode;
}) {
	return (
		<div>
			<div className="mb-1 flex items-baseline justify-between gap-3">
				<span className="text-xs text-muted-foreground">{label}</span>
				<span className="num text-xs text-foreground">{display}</span>
			</div>
			<Slider
				aria-label={label}
				tone={tone}
				value={[value]}
				min={min}
				max={max}
				step={step}
				onValueChange={([v]) => onChange(v)}
			/>
			{hint && <div className="mt-1 text-[10.5px] leading-snug text-muted-foreground/80">{hint}</div>}
		</div>
	);
}

/** Small segmented toggle. */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	className,
	ariaLabel
}: {
	value: T;
	options: Array<{ value: T; label: React.ReactNode }>;
	onChange: (value: T) => void;
	className?: string;
	ariaLabel?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className={cn('inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5', className)}
		>
			{options.map((opt) => {
				const active = opt.value === value;
				return (
					<button
						key={opt.value}
						type="button"
						role="radio"
						aria-checked={active}
						onClick={() => onChange(opt.value)}
						className={cn(
							'rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
							active
								? 'bg-white/10 text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
								: 'text-muted-foreground hover:text-foreground'
						)}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

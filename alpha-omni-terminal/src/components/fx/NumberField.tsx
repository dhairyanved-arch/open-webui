import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface NumberFieldProps {
	label: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	prefix?: string;
	suffix?: string;
	hint?: React.ReactNode;
	className?: string;
}

/**
 * Numeric input that keeps its own text while the user types (so "1." or an empty
 * box are allowed mid-edit) and only commits finite, clamped numbers upward.
 */
export function NumberField({ label, value, onChange, min, max, step, prefix, suffix, hint, className }: NumberFieldProps) {
	const id = React.useId();
	const [text, setText] = React.useState(String(value));
	const focused = React.useRef(false);

	React.useEffect(() => {
		if (!focused.current) setText(String(value));
	}, [value]);

	const commit = (raw: string) => {
		const parsed = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(parsed)) return;
		let next = parsed;
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
		onChange(next);
	};

	return (
		<div className={cn('min-w-0', className)}>
			<Label htmlFor={id} className="mb-1 block">
				{label}
			</Label>
			<div className="relative">
				{prefix && (
					<span className="num pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
						{prefix}
					</span>
				)}
				<Input
					id={id}
					type="number"
					inputMode="decimal"
					value={text}
					min={min}
					max={max}
					step={step}
					onFocus={() => {
						focused.current = true;
					}}
					onBlur={() => {
						focused.current = false;
						setText(String(value));
					}}
					onChange={(e) => {
						setText(e.target.value);
						commit(e.target.value);
					}}
					className={cn(prefix && 'pl-6', suffix && 'pr-7')}
				/>
				{suffix && (
					<span className="num pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
						{suffix}
					</span>
				)}
			</div>
			{hint && <div className="mt-1 text-[10.5px] leading-snug text-muted-foreground/80">{hint}</div>}
		</div>
	);
}

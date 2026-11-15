import { useQuotes } from '@/context/MockDataContext';
import { cn } from '@/lib/utils';

function formatPrice(price: number) {
	return price.toLocaleString('en-IN', {
		minimumFractionDigits: price < 100 ? 2 : 1,
		maximumFractionDigits: price < 100 ? 2 : 1
	});
}

export function TickerTape() {
	const quotes = useQuotes();
	// Two copies back to back make the -50% marquee loop seamless.
	const loop = [...quotes, ...quotes];
	return (
		<div className="mask-fade-x relative min-w-0 flex-1 overflow-hidden" aria-label="Simulated market ticker">
			<div className="flex w-max animate-marquee items-center hover:[animation-play-state:paused]">
				{loop.map((q, i) => {
					const up = q.changePct >= 0;
					return (
						<div
							key={`${q.symbol}-${i}`}
							aria-hidden={i >= quotes.length}
							className="flex items-center gap-2 border-r border-white/[0.06] px-4 text-[11px] whitespace-nowrap"
						>
							<span className="font-medium tracking-wide text-muted-foreground">{q.symbol}</span>
							<span className="num text-foreground">{formatPrice(q.price)}</span>
							<span className={cn('num', up ? 'text-bull' : 'text-bear')}>
								{up ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

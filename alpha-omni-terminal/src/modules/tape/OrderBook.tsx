import { formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BookLevel, BookSnapshot } from './simulator';

const price = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Ladder({ levels, side, maxCum }: { levels: Array<BookLevel & { cum: number }>; side: 'bid' | 'ask'; maxCum: number }) {
	return (
		<div className="flex flex-col">
			{levels.map((l, i) => (
				<div key={i} className="num relative grid h-[19px] grid-cols-[1fr_auto] items-center px-3 text-[11px]">
					<div
						className={cn('absolute inset-y-px right-0 rounded-l-[3px]', side === 'bid' ? 'bg-bull/[0.13]' : 'bg-bear/[0.13]')}
						style={{ width: `${(l.cum / maxCum) * 100}%` }}
					/>
					<span className={cn('relative', side === 'bid' ? 'text-bull' : 'text-bear')}>{price(l.price)}</span>
					<span className="relative text-foreground/75">{formatQty(l.qty)}</span>
				</div>
			))}
		</div>
	);
}

export function OrderBook({ book }: { book: BookSnapshot | null }) {
	if (!book) return <div className="p-4 text-xs text-muted-foreground">Waiting for the first book snapshot…</div>;

	let cum = 0;
	const bids = book.bids.map((l) => ({ ...l, cum: (cum += l.qty) }));
	const bidTotal = cum;
	cum = 0;
	const asks = book.asks.map((l) => ({ ...l, cum: (cum += l.qty) }));
	const askTotal = cum;
	const maxCum = Math.max(bidTotal, askTotal, 1);
	const bidShare = bidTotal / (bidTotal + askTotal);

	return (
		<div className="flex h-full flex-col">
			<div className="kicker grid grid-cols-[1fr_auto] px-3 pb-1">
				<span>Price</span>
				<span>Size</span>
			</div>
			<div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
				<Ladder levels={[...asks].reverse()} side="ask" maxCum={maxCum} />
				<div className="my-1 flex items-center justify-between border-y border-white/[0.07] bg-white/[0.03] px-3 py-1.5">
					<span className={cn('num text-[17px] leading-none font-medium', book.lastSide === 'B' ? 'text-bull text-glow-bull' : 'text-bear text-glow-bear')}>
						{price(book.last)}
					</span>
					<span className="num text-[10px] text-muted-foreground">
						mid {price(book.mid)} · {book.spreadBps.toFixed(2)} bps
					</span>
				</div>
				<Ladder levels={bids} side="bid" maxCum={maxCum} />
			</div>
			<div className="shrink-0 px-3 pt-2 pb-3">
				<div className="flex h-1.5 overflow-hidden rounded-full bg-bear/50">
					<div className="h-full bg-bull transition-[width] duration-300" style={{ width: `${bidShare * 100}%` }} />
				</div>
				<div className="num mt-1 flex justify-between text-[10px] text-muted-foreground">
					<span>bid depth {formatQty(bidTotal)}</span>
					<span>ask depth {formatQty(askTotal)}</span>
				</div>
			</div>
		</div>
	);
}

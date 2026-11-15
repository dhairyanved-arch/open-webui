import { smileVol } from './blackScholes';
import { STRIKE_RANGE, type SurfaceParams } from './surfaceModel';

const TENORS: Array<{ days: number; color: string }> = [
	{ days: 7, color: 'var(--primary)' },
	{ days: 30, color: 'var(--accent)' },
	{ days: 90, color: 'var(--violet)' }
];

/** 2D cut through the surface: implied vol against strike for three listed tenors. */
export function SmileSlice({ params }: { params: SurfaceParams }) {
	const W = 320;
	const H = 150;
	const pad = { l: 30, r: 8, t: 10, b: 20 };
	const lo = params.refSpot * STRIKE_RANGE[0];
	const hi = params.refSpot * STRIKE_RANGE[1];
	const N = 60;

	const series = TENORS.map((tenor) => {
		const left = tenor.days - params.daysElapsed;
		if (left <= 0) return { ...tenor, left, points: [] as Array<[number, number]> };
		const points: Array<[number, number]> = [];
		for (let i = 0; i <= N; i++) {
			const k = lo + ((hi - lo) * i) / N;
			points.push([k, smileVol(params.spot, k, left / 365, params) * 100]);
		}
		return { ...tenor, left, points };
	});

	const all = series.flatMap((s) => s.points.map((p) => p[1]));
	const yMax = Math.max(20, Math.ceil((Math.max(...all, 0) * 1.08) / 10) * 10);
	const x = (k: number) => pad.l + ((k - lo) / (hi - lo)) * (W - pad.l - pad.r);
	const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
	const spotVisible = params.spot >= lo && params.spot <= hi;

	return (
		<div>
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Volatility smile by tenor">
				{[0, 0.5, 1].map((f) => (
					<g key={f}>
						<line x1={pad.l} x2={W - pad.r} y1={y(yMax * f)} y2={y(yMax * f)} stroke="rgb(255 255 255 / 0.08)" />
						<text x={pad.l - 5} y={y(yMax * f) + 3} textAnchor="end" fontSize="9" className="num" fill="rgb(255 255 255 / 0.45)">
							{Math.round(yMax * f)}%
						</text>
					</g>
				))}
				{spotVisible && (
					<line x1={x(params.spot)} x2={x(params.spot)} y1={pad.t} y2={H - pad.b} stroke="var(--primary)" strokeDasharray="3 3" opacity={0.7} />
				)}
				{series.map(
					(s) =>
						s.points.length > 0 && (
							<path
								key={s.days}
								d={s.points.map(([k, v], i) => `${i === 0 ? 'M' : 'L'}${x(k).toFixed(1)},${y(Math.min(v, yMax)).toFixed(1)}`).join(' ')}
								fill="none"
								stroke={s.color}
								strokeWidth={1.75}
								strokeLinejoin="round"
							/>
						)
				)}
				<text x={pad.l} y={H - 5} fontSize="9" className="num" fill="rgb(255 255 255 / 0.45)">
					{Math.round(lo).toLocaleString('en-IN')}
				</text>
				<text x={W - pad.r} y={H - 5} textAnchor="end" fontSize="9" className="num" fill="rgb(255 255 255 / 0.45)">
					{Math.round(hi).toLocaleString('en-IN')}
				</text>
			</svg>
			<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
				{series.map((s) => (
					<span key={s.days} className="num flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
						<span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color, opacity: s.left > 0 ? 1 : 0.3 }} />
						{s.days}d listed · {s.left > 0 ? `${Math.round(s.left)}d left` : 'expired'}
					</span>
				))}
			</div>
		</div>
	);
}

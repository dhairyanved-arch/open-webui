import type { CSSProperties } from 'react';

/** Sequential amber ramp for probabilities. `t` is 0..1 relative intensity. */
export function probHeat(t: number): CSSProperties {
	const k = Math.max(0, Math.min(1, t));
	const alpha = k === 0 ? 0.02 : 0.07 + 0.83 * Math.pow(k, 0.55);
	return {
		backgroundColor: `rgb(255 178 36 / ${alpha.toFixed(3)})`,
		color: alpha > 0.55 ? '#1a1203' : undefined
	};
}

/** Diverging neon ramp for P&L. `t` is −1..1 relative to the largest magnitude. */
export function pnlHeat(t: number): CSSProperties {
	const k = Math.max(-1, Math.min(1, t));
	const mag = Math.abs(k);
	if (mag < 1e-4) return { backgroundColor: 'rgb(255 255 255 / 0.025)' };
	const alpha = 0.08 + 0.78 * Math.pow(mag, 0.6);
	return {
		backgroundColor: k > 0 ? `rgb(0 255 156 / ${alpha.toFixed(3)})` : `rgb(255 45 85 / ${alpha.toFixed(3)})`,
		color: alpha > 0.5 ? (k > 0 ? '#012214' : '#fff') : undefined
	};
}

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹ with Indian digit grouping. */
export function formatInr(value: number, decimals: 0 | 2 = 0): string {
	const body = decimals === 0 ? inr0.format(Math.abs(value)) : inr2.format(Math.abs(value));
	return `${value < 0 ? '−' : ''}₹${body}`;
}

/** Signed ₹, e.g. +₹4,200 / −₹1,150. */
export function formatInrSigned(value: number): string {
	if (Math.abs(value) < 0.5) return '₹0';
	return `${value > 0 ? '+' : '−'}₹${inr0.format(Math.abs(value))}`;
}

/** Compact ₹ in lakh / crore units. */
export function formatInrCompact(value: number): string {
	const abs = Math.abs(value);
	const sign = value < 0 ? '−' : '';
	if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 1 : 2)} Cr`;
	if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 1 : 2)} L`;
	if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
	return `${sign}₹${abs.toFixed(0)}`;
}

export function formatPct(fraction: number, decimals = 1): string {
	return `${(fraction * 100).toFixed(decimals)}%`;
}

export function formatPctSigned(pct: number, decimals = 2): string {
	return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(decimals)}%`;
}

export function formatQty(value: number): string {
	if (value >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
	if (value >= 1e5) return `${(value / 1e5).toFixed(2)}L`;
	if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
	return inr0.format(value);
}

export function formatClock(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

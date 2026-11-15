/* ────────────────────────────────────────────────────────────────────────────
 * Black-Scholes-Merton pricing, Greeks and a parametric volatility smile.
 * Conventions: T in years, sigma and r as decimals, vega per 1 vol point,
 * theta per calendar day, rho per 1% rate move.
 * ──────────────────────────────────────────────────────────────────────────── */

export type OptionType = 'call' | 'put' | 'straddle';

const INV_SQRT_2PI = 0.3989422804014327;

export function normPdf(x: number): number {
	return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal CDF. Uses the complementary error function (Numerical Recipes
 * erfc Chebyshev fit, fractional error < 1.2e-7 everywhere).
 */
export function normCdf(x: number): number {
	const z = Math.abs(x) / Math.SQRT2;
	const t = 1 / (1 + 0.5 * z);
	const erfc =
		t *
		Math.exp(
			-z * z -
				1.26551223 +
				t *
					(1.00002368 +
						t *
							(0.37409196 +
								t *
									(0.09678418 +
										t *
											(-0.18628806 +
												t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
		);
	return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
}

export interface Greeks {
	price: number;
	delta: number;
	gamma: number;
	/** Price change per +1 vol point. */
	vega: number;
	/** Price change per calendar day elapsed. */
	theta: number;
	/** Price change per +1% in the risk-free rate. */
	rho: number;
}

function single(S: number, K: number, T: number, r: number, sigma: number, call: boolean): Greeks {
	if (T <= 1e-8 || sigma <= 1e-8) {
		// Expired (or zero vol): the option is worth its intrinsic value and nothing else.
		const forward = T > 0 ? K * Math.exp(-r * T) : K;
		const intrinsic = call ? Math.max(S - forward, 0) : Math.max(forward - S, 0);
		const itm = call ? S > forward : S < forward;
		return { price: intrinsic, delta: itm ? (call ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
	}
	const sqrtT = Math.sqrt(T);
	const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
	const d2 = d1 - sigma * sqrtT;
	const pdf = normPdf(d1);
	const disc = Math.exp(-r * T);
	const gamma = pdf / (S * sigma * sqrtT);
	const vega = (S * pdf * sqrtT) / 100;
	const decay = -(S * pdf * sigma) / (2 * sqrtT);
	if (call) {
		const nd1 = normCdf(d1);
		const nd2 = normCdf(d2);
		return {
			price: S * nd1 - K * disc * nd2,
			delta: nd1,
			gamma,
			vega,
			theta: (decay - r * K * disc * nd2) / 365,
			rho: (K * T * disc * nd2) / 100
		};
	}
	const nNegD1 = normCdf(-d1);
	const nNegD2 = normCdf(-d2);
	return {
		price: K * disc * nNegD2 - S * nNegD1,
		delta: -nNegD1,
		gamma,
		vega,
		theta: (decay + r * K * disc * nNegD2) / 365,
		rho: (-K * T * disc * nNegD2) / 100
	};
}

export function blackScholes(S: number, K: number, T: number, r: number, sigma: number, type: OptionType): Greeks {
	if (type === 'straddle') {
		const c = single(S, K, T, r, sigma, true);
		const p = single(S, K, T, r, sigma, false);
		return {
			price: c.price + p.price,
			delta: c.delta + p.delta,
			gamma: c.gamma + p.gamma,
			vega: c.vega + p.vega,
			theta: c.theta + p.theta,
			rho: c.rho + p.rho
		};
	}
	return single(S, K, T, r, sigma, type === 'call');
}

export interface SmileParams {
	/** At-the-money implied volatility for the 30-day tenor. */
	atmIv: number;
	/** Slope of the smile: negative = equity-style put skew. */
	skew: number;
	/** Curvature of the smile (wing lift). */
	convexity: number;
}

const MIN_SMILE_TENOR = 7 / 365;
const REF_TENOR_SQRT = Math.sqrt(30 / 365);

/**
 * Implied volatility for strike K and tenor T.
 * Moneyness is scaled by √T so that short-dated smiles are steeper in strike
 * space, as they are in real index-option markets; a mild upward term structure
 * is layered on top.
 */
export function smileVol(S: number, K: number, T: number, p: SmileParams): number {
	const tenor = Math.max(T, MIN_SMILE_TENOR);
	const z = Math.log(K / S) / Math.sqrt(tenor);
	const term = 1 + 0.18 * (Math.sqrt(tenor) - REF_TENOR_SQRT);
	const shape = 1 + p.skew * z + p.convexity * z * z;
	const sigma = p.atmIv * term * Math.min(3.2, Math.max(0.35, shape));
	return Math.min(2.5, Math.max(0.02, sigma));
}

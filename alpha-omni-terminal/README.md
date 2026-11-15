# Asymmetric Alpha · Omni-Terminal

A dark-mode React terminal that puts five quantitative and spatial finance tools behind one collapsible sidebar. Everything runs in the browser from a seeded mock-data generator — there is no backend, and no real market data is used.

```bash
cd alpha-omni-terminal
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests for every engine (Vitest) |
| `npm run smoke` | Headless-browser run through all five modules (needs Playwright, see below) |

## Modules

### 01 · IPO Monte Carlo Engine — `src/modules/ipo`

Enter the issue price, lot size, live GMP and the Retail / NII / QIB subscription multiples, choose your category (Retail, sNII, bNII), number of applications and bid size. Each of the 10,000 iterations:

1. perturbs the live book into a final book (correlated log-normal shocks);
2. runs the basis-of-allotment draw for your category — full allotment when undersubscribed, one minimum lot each plus a proportionate remainder when applicants are fewer than lots, otherwise a lottery in which winners get exactly one minimum application;
3. simulates listing day — GMP realised with a demand-weighted haircut (QIB conviction weighted most), idiosyncratic noise and an occasional market gap-down.

Outputs: a joint heat map of *listing return × lots allotted*, a *subscription × GMP* scenario surface, the lot distribution, the conditional P&L histogram and headline statistics. Probabilities are integer counts over the iteration total, so every distribution sums to exactly 100% — the heat map shows the checksum, and the tests assert it.

### 02 · 3D Volatility Surface — `src/modules/volsurface`

A React Three Fiber mesh over strike × expiry. Sliders for underlying price, at-the-money implied volatility and theta decay (days elapsed), plus skew, wing convexity and the risk-free rate. Every change re-prices all 3,577 vertices with Black-Scholes off a √T-scaled skewed smile and rewrites the vertex buffer in place. Switch the height metric between value, implied vol, delta, gamma, vega and theta, for calls, puts or straddles; hover the mesh to probe the Greeks at any strike and expiry.

### 03 · Node-Based Algo Builder — `src/modules/algo`

An infinite pan-and-zoom canvas (React Flow). Drag nodes from the palette — Market Data, RSI, Volume Spike, MA Cross, MACD, Bollinger Break, Price vs VWAP, Price Change, Session Window, AND / OR / NOT, Enter Long / Short, Exit, Alert — and wire them together. Wires are typed (bars vs. signal) and loops are refused. The graph compiles on every edit into a strategy JSON spec and a self-contained pandas backtest script; half-wired graphs still compile, with diagnostics that jump to the offending node.

### 04 · High-Frequency Tape Reader — `src/modules/tape`

A microstructure simulator streams prints for eight symbols against ten-level order books, and injects institutional activity: single block prints that walk the book, and parent orders sliced into rapid same-side child prints. The detector sees only what a real tape exposes. It flags size outliers against a per-symbol log-size baseline, and chains elevated same-side prints into sweeps. Flagged prints flash neon green or red in the tape and are isolated as cards in the radar. Because the simulator knows which orders it injected, the panel also shows the detector's live recall and precision.

### 05 · Portfolio City — `src/modules/city`

A procedural Three.js city built from the portfolio JSON. Capital sets a building's height and girth; asset class sets its architecture (glass towers for equities, stepped setback towers for mutual funds, low colonnaded halls for debt); each sector is a district, and its day move — measured against the asset class's typical daily volatility — sets the weather over it: sun, fog, rain or a lightning storm. Re-allocate with sliders, shock the market, or edit the JSON directly.

## Structure

```
src/
  App.tsx                      routes; one lazy chunk per module
  context/MockDataContext.tsx  seeded universe, shared portfolio state, live quote store
  data/generators.ts           IPO pipeline, portfolio, instruments, option desk, starter graphs
  lib/                         seeded RNG, formatting, class-name helper
  components/ui/               shadcn/ui primitives (sidebar, slider, table, tabs, select, …)
  components/layout/           app shell, sidebar navigation, ticker tape
  components/fx/               glass panels, spotlight, backdrop, WebGL error boundary
  modules/<name>/              page component + pure engine + engine tests
```

Each module keeps its maths in a plain TypeScript file with no React or DOM dependency (`engine.ts`, `blackScholes.ts`, `compiler.ts`, `simulator.ts`, `detector.ts`, `cityModel.ts`), which is what the unit tests exercise.

“Reseed mock data” in the sidebar regenerates every dataset from a new seed.

## Verification

`npm test` covers, among other things:

- IPO: distributions, joint matrix, marginals and histogram all normalise to 100% across six input regimes; lottery odds match the analytic value; results are deterministic per seed.
- Black-Scholes: textbook values, put-call parity, Greeks against finite differences, no NaNs at expiry.
- Compiler: expected rules from the starter graph, cycle and half-wired handling, and — when `python3` with pandas is available — the generated script is executed end to end for a graph using every node type.
- Tape: uncrossed books, reproducible streams, and detector recall and precision above 85% against injected ground truth, with a near-zero false-alarm rate on ordinary flow.
- City: every holding placed once, weights summing to 100%, no overlapping districts, weather thresholds.

`npm run smoke` serves the production build and drives all five modules in headless Chromium: it moves the sliders, drags a node onto the canvas and wires it, pauses the tape, shocks the city, navigates every route twice, and fails on any console error, uncaught exception or blank WebGL canvas. It needs Playwright, which is deliberately not a project dependency:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run build && npm run smoke
```

## Notes

- All prices, subscriptions, trades and portfolio values are simulated. Company and index names are used as familiar labels only; nothing here is market data or investment advice.
- The Three.js canvases sit inside an error boundary and the orbit cameras are constrained to stay above the floor and outside the scene's bounding volume, so a WebGL failure or a camera move cannot take the rest of the app down.
- When built from inside this repository, esbuild prints a warning about the parent `tsconfig.json` extending `.svelte-kit/tsconfig.json`. It comes from the host project's config, not this app, and does not affect the build.

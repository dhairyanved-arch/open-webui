/* eslint-disable no-console */
/**
 * Browser smoke test for the Omni-Terminal.
 *
 *   npm run build && npm run smoke
 *
 * Serves the production build, opens every module in headless Chromium and fails
 * on any console error, uncaught exception, blank WebGL canvas or broken
 * interaction. Screenshots land in ./smoke-output. Needs Playwright:
 *   npm i -D playwright && npx playwright install chromium
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'smoke-output');
const PORT = Number(process.env.SMOKE_PORT || 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = process.env.SMOKE_ONLY ? process.env.SMOKE_ONLY.split(',') : null;
const SCALE = Number(process.env.SMOKE_SCALE || 1);

const failures = [];
const check = (ok, message) => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
	if (!ok) failures.push(message);
};

async function waitForServer(url, timeoutMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`Preview server did not start at ${url}`);
}

/** Fraction of sampled pixels of the first <canvas> that are not near-black. */
async function canvasCoverage(page, selector = 'canvas') {
	const el = page.locator(selector).first();
	const png = await el.screenshot();
	return page.evaluate(async (b64) => {
		const img = new Image();
		img.src = `data:image/png;base64,${b64}`;
		await img.decode();
		const c = document.createElement('canvas');
		c.width = img.width;
		c.height = img.height;
		const ctx = c.getContext('2d');
		ctx.drawImage(img, 0, 0);
		const { data } = ctx.getImageData(0, 0, c.width, c.height);
		let lit = 0;
		let total = 0;
		for (let i = 0; i < data.length; i += 4 * 37) {
			total++;
			if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
		}
		return lit / total;
	}, png.toString('base64'));
}

/** Cheap perceptual hash of an element, to prove a frame actually changed. */
async function fingerprint(page, selector) {
	const png = await page.locator(selector).first().screenshot();
	let h = 0;
	for (let i = 0; i < png.length; i += 97) h = (Math.imul(h, 31) + png[i]) >>> 0;
	return h;
}

/** Poll until `probe()` is truthy — the app is given time, never a fixed sleep. */
async function until(probe, timeoutMs = 8000) {
	const start = Date.now();
	for (;;) {
		if (await probe()) return true;
		if (Date.now() - start > timeoutMs) return false;
		await new Promise((r) => setTimeout(r, 100));
	}
}

async function dragSlider(page, label, fraction) {
	const thumb = page.getByRole('slider', { name: label }).first();
	await thumb.scrollIntoViewIfNeeded();
	const track = thumb.locator('xpath=ancestor::span[@data-orientation][last()]');
	const box = await track.boundingBox();
	await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

const modules = {
	async ipo(page) {
		await page.goto(`${BASE}/#/ipo`);
		await page.getByText('The IPO Monte Carlo Engine').waitFor();
		const norm = page.getByTestId('normalisation-check');
		await norm.waitFor();
		check((await norm.getAttribute('data-ok')) === 'true', 'IPO: joint heat map normalises to 100% of draws');
		check((await norm.innerText()).includes('100.00%'), 'IPO: checksum reads 100.00%');
		check((await page.getByTestId('sim-meta').innerText()).includes('10,000'), 'IPO: runs 10,000 iterations');
		const before = await page.getByText('P(any allotment)').locator('..').innerText();
		await dragSlider(page, 'Retail', 0.2);
		const changed = await until(async () => (await page.getByText('P(any allotment)').locator('..').innerText()) !== before);
		check(changed, 'IPO: allotment odds respond to the retail subscription slider');
		check((await norm.getAttribute('data-ok')) === 'true', 'IPO: still normalised after input change');
		await page.getByRole('radio', { name: 'sNII ₹2–10L' }).click();
		await page.waitForTimeout(300);
		check((await norm.getAttribute('data-ok')) === 'true', 'IPO: normalised in the sNII category');
		await page.getByRole('radio', { name: 'Retail ≤ ₹2L' }).click();
	},

	async 'vol-surface'(page) {
		await page.goto(`${BASE}/#/vol-surface`);
		await page.locator('canvas').first().waitFor();
		await page.waitForTimeout(1500);
		check((await canvasCoverage(page)) > 0.04, 'Vol surface: WebGL canvas is drawing');
		for (const label of ['Underlying price', 'Implied volatility (ATM)', 'Theta decay']) {
			const fp0 = await fingerprint(page, 'canvas');
			const readout0 = await page.getByTestId('greeks-readout').innerText();
			await dragSlider(page, label, 0.85);
			check(await until(async () => (await fingerprint(page, 'canvas')) !== fp0), `Vol surface: mesh re-renders when "${label}" moves`);
			check(
				await until(async () => (await page.getByTestId('greeks-readout').innerText()) !== readout0),
				`Vol surface: Greeks recompute when "${label}" moves`
			);
		}
		for (const metric of ['Delta', 'Gamma', 'Vega', 'Theta', 'Implied vol', 'Value']) {
			await page.getByRole('radio', { name: metric, exact: true }).click();
			await page.waitForTimeout(250);
		}
		check((await canvasCoverage(page)) > 0.04, 'Vol surface: still drawing after cycling every metric');
		// hover the mesh → the raycast probe should take over the Greeks readout
		await page.getByRole('button', { name: 'Reset desk' }).click();
		const box = await page.locator('canvas').first().boundingBox();
		let probed = false;
		for (const [fx, fy] of [[0.5, 0.55], [0.45, 0.6], [0.55, 0.5], [0.4, 0.5], [0.5, 0.65]]) {
			await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 4 });
			await page.waitForTimeout(250);
			if ((await page.getByText('Probe', { exact: true }).count()) > 0) {
				probed = true;
				break;
			}
		}
		check(probed, 'Vol surface: hovering the mesh probes Greeks at that strike / expiry');
		await page.mouse.move(box.x + 5, box.y + box.height - 5);
	},

	async 'algo-builder'(page) {
		await page.goto(`${BASE}/#/algo-builder`);
		await page.locator('.react-flow__node').first().waitFor();
		const nodes0 = await page.locator('.react-flow__node').count();
		check(nodes0 >= 5, `Algo builder: starter graph rendered (${nodes0} nodes)`);
		const py0 = await page.getByTestId('code-output').innerText();
		check(py0.includes('def build_signals'), 'Algo builder: Python output generated');
		// edit a parameter → output must change in real time
		const threshold = page.locator('.react-flow__node').filter({ hasText: 'RSI' }).first().getByLabel('Threshold');
		await threshold.fill('82');
		const rewritten = await until(async () => {
			const py1 = await page.getByTestId('code-output').innerText();
			return py1 !== py0 && py1.includes('> 82');
		});
		check(rewritten, 'Algo builder: editing a node parameter rewrites the script');
		// drag a new node from the palette onto the canvas
		const source = page.getByTestId('palette-macd');
		const canvas = page.locator('.react-flow__pane');
		const cbox = await canvas.boundingBox();
		await source.dragTo(canvas, { targetPosition: { x: cbox.width * 0.5, y: cbox.height * 0.88 } });
		await until(async () => (await page.locator('.react-flow__node').count()) === nodes0 + 1);
		const nodes1 = await page.locator('.react-flow__node').count();
		check(nodes1 === nodes0 + 1, 'Algo builder: drag-and-drop adds a node to the canvas');
		// wire the data source into the new node by dragging between handles
		const newNode = page.locator('.react-flow__node').filter({ hasText: 'MACD' }).last();
		const from = page.locator('.react-flow__node').filter({ hasText: 'Market Data' }).first().locator('.react-flow__handle.source').first();
		const to = newNode.locator('.react-flow__handle.target').first();
		const edges0 = await page.locator('.react-flow__edge').count();
		const fb = await from.boundingBox();
		const tb = await to.boundingBox();
		await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
		await page.mouse.down();
		await page.mouse.move((fb.x + tb.x) / 2, (fb.y + tb.y) / 2, { steps: 8 });
		await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
		await page.mouse.up();
		check(
			await until(async () => (await page.locator('.react-flow__edge').count()) === edges0 + 1),
			'Algo builder: dragging handle-to-handle wires two nodes'
		);
		await page.getByRole('tab', { name: 'JSON' }).click();
		const json = await page.getByTestId('code-output').innerText();
		let parsed = null;
		try {
			parsed = JSON.parse(json);
		} catch {
			parsed = null;
		}
		check(parsed !== null && Array.isArray(parsed.rules), 'Algo builder: JSON output is valid and lists rules');
		check(parsed !== null && parsed.graph.nodes.length === nodes1, 'Algo builder: JSON graph matches the canvas');
		await page.getByRole('tab', { name: 'Python' }).click();
	},

	async tape(page) {
		await page.goto(`${BASE}/#/tape`);
		await page.getByTestId('tape-row').first().waitFor();
		const firstId = await page.getByTestId('tape-row').first().getAttribute('data-trade-id');
		await page.waitForTimeout(1200);
		const nextId = await page.getByTestId('tape-row').first().getAttribute('data-trade-id');
		check(firstId !== nextId, 'Tape: prints are streaming');
		await page.getByTestId('block-card').first().waitFor({ timeout: 30000 });
		check((await page.getByTestId('block-card').count()) > 0, 'Tape: institutional block deals are detected and isolated');
		await page.getByRole('button', { name: 'Pause feed' }).click();
		await page.waitForTimeout(300);
		const p0 = await page.getByTestId('tape-row').first().getAttribute('data-trade-id');
		await page.waitForTimeout(700);
		const p1 = await page.getByTestId('tape-row').first().getAttribute('data-trade-id');
		check(p0 === p1, 'Tape: pause freezes the stream');
		const flagged = await page.locator('[data-testid="tape-row"][data-anomaly="true"]').count();
		check(flagged > 0, `Tape: anomalous prints are highlighted in the tape (${flagged} visible)`);
	},

	async 'portfolio-city'(page) {
		await page.goto(`${BASE}/#/portfolio-city`);
		await page.locator('canvas').first().waitFor();
		await page.waitForTimeout(2500);
		check((await canvasCoverage(page)) > 0.05, 'City: WebGL canvas is drawing');
		const fp0 = await fingerprint(page, 'canvas');
		const today0 = await page.getByTestId('portfolio-day').innerText();
		await page.getByRole('button', { name: 'Bear day' }).click();
		check(
			await until(async () => (await page.getByTestId('portfolio-day').innerText()) !== today0),
			'City: a market shock redraws the day\'s moves'
		);
		check((await page.getByTestId('portfolio-day').innerText()).includes('−'), 'City: a bear day puts the book in the red');
		check(await until(async () => (await fingerprint(page, 'canvas')) !== fp0), 'City: weather changes when the market is shocked');
		const total0 = await page.getByTestId('portfolio-total').innerText();
		await dragSlider(page, 'Value — Reliance Industries', 0.95);
		check(
			await until(async () => (await page.getByTestId('portfolio-total').innerText()) !== total0),
			'City: allocation slider updates the portfolio'
		);
		check((await canvasCoverage(page)) > 0.05, 'City: still drawing after re-allocation');
		// sweep the pointer across the skyline until a building reports itself
		const cbox = await page.locator('canvas').first().boundingBox();
		let hovered = false;
		outer: for (let gy = 0.35; gy <= 0.8; gy += 0.075) {
			for (let gx = 0.2; gx <= 0.8; gx += 0.06) {
				await page.mouse.move(cbox.x + cbox.width * gx, cbox.y + cbox.height * gy, { steps: 2 });
				await page.waitForTimeout(90);
				if ((await page.getByText('% of book').count()) > 0) {
					hovered = true;
					await page.mouse.down();
					await page.mouse.up();
					break outer;
				}
			}
		}
		check(hovered, 'City: hovering a building raises its holding card');
		check(
			await until(async () => (await page.getByTestId('selected-holding').count()) > 0),
			'City: clicking a building selects the holding in the allocator'
		);
		await page.mouse.move(cbox.x + 4, cbox.y + 4);
		await page.getByRole('tab', { name: 'JSON' }).click();
		const text = await page.getByLabel('Portfolio JSON').inputValue();
		check(JSON.parse(text).holdings.length > 0, 'City: portfolio JSON state is exposed and valid');
		await page.getByRole('tab', { name: 'Holdings' }).click();
	}
};

(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
		cwd: ROOT,
		stdio: 'ignore'
	});
	let browser;
	try {
		await waitForServer(BASE);
		browser = await chromium.launch({
			args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
		});
		const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: SCALE });
		const page = await context.newPage();
		const errors = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
		});
		page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

		for (const [name, run] of Object.entries(modules)) {
			if (ONLY && !ONLY.includes(name)) continue;
			console.log(`\n▸ ${name}`);
			const mark = errors.length;
			try {
				await run(page);
			} catch (err) {
				check(false, `${name}: scenario threw — ${err.message.split('\n')[0]}`);
			}
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `${name}.png`) });
			const fresh = errors.slice(mark);
			check(fresh.length === 0, `${name}: no console errors or uncaught exceptions${fresh.length ? ` → ${fresh.slice(0, 3).join(' | ')}` : ''}`);
		}

		if (!ONLY) {
			console.log('\n▸ shell');
			// Round-trip through every route twice: mounting and unmounting the WebGL
			// scenes must not leak errors or leave the router in a bad state.
			const mark = errors.length;
			for (let lap = 0; lap < 2; lap++) {
				for (const label of ['IPO Monte Carlo', 'Volatility Surface', 'Algo Builder', 'Tape Reader', 'Portfolio City']) {
					await page.getByRole('link', { name: label }).click();
					await page.waitForTimeout(450);
				}
			}
			check(errors.length === mark, 'Shell: two laps through all five routes with no errors');
			await page.getByRole('button', { name: 'Collapse sidebar' }).click();
			const railWidth = () => page.locator('aside').evaluate((el) => el.getBoundingClientRect().width);
			const collapsed = await until(async () => (await railWidth()) < 90);
			check(collapsed, `Shell: sidebar collapses to an icon rail (${Math.round(await railWidth())}px)`);
			await page.screenshot({ path: path.join(OUT, 'shell-collapsed.png') });
			await page.getByRole('button', { name: 'Expand sidebar' }).click();
			check(await until(async () => (await railWidth()) > 200), 'Shell: sidebar expands again');
		}
	} finally {
		if (browser) await browser.close();
		server.kill();
	}

	console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
	process.exit(failures.length ? 1 : 0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});

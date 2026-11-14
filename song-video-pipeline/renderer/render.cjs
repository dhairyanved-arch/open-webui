#!/usr/bin/env node
/* Renders a songvid timeline to video.
 *
 *   node render.cjs --timeline timeline.json --out video.mp4 [--audio clip.wav]
 *                   [--workers 4] [--stills dir --at 1.5,4,9.2] [--from s --to s]
 *
 * Each frame is produced by calling window.seek(t) in headless Chromium and
 * taking a screenshot, so the output is deterministic and frame-accurate: the
 * same timeline always gives the same video, and text lands exactly on the
 * timestamps it was given.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
}
if (!args.timeline || (!args.out && !args.stills)) {
	console.error('usage: render.cjs --timeline timeline.json (--out video.mp4 [--audio file] | --stills dir --at t1,t2,...)');
	process.exit(2);
}

let chromium;
try {
	({ chromium } = require('playwright'));
} catch (e) {
	console.error('Playwright is required: npm i -g playwright && npx playwright install chromium');
	process.exit(2);
}

(async () => {
	const TL = JSON.parse(fs.readFileSync(args.timeline, 'utf8'));
	const { width, height, duration } = TL.meta;
	const fps = TL.meta.fps || 30;
	const workers = Math.max(1, parseInt(args.workers || '4', 10));
	const stage = pathToFileURL(path.join(__dirname, 'stage', 'index.html')).href;

	const launch = { args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'] };
	if (process.env.SONGVID_CHROMIUM) launch.executablePath = process.env.SONGVID_CHROMIUM;
	const browser = await chromium.launch(launch);
	const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	const open = async () => {
		const page = await ctx.newPage();
		page.on('pageerror', (e) => console.error('[stage error]', e.message));
		page.on('console', (m) => m.type() === 'error' && console.error('[stage]', m.text()));
		await page.goto(stage);
		await page.evaluate((tl) => window.initStage(tl), TL);
		return page;
	};

	if (args.stills) {
		fs.mkdirSync(args.stills, { recursive: true });
		const page = await open();
		const times = String(args.at || '0')
			.split(',')
			.map(Number);
		for (const t of times) {
			await page.evaluate((x) => window.seek(x), t);
			const file = path.join(args.stills, `t${t.toFixed(2).padStart(6, '0')}.jpg`);
			await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
			console.log(file);
		}
		await browser.close();
		return;
	}

	const pages = await Promise.all(Array.from({ length: workers }, open));
	const f0 = Math.round((parseFloat(args.from) || 0) * fps);
	const f1 = Math.round((args.to ? parseFloat(args.to) : duration) * fps);
	const ff = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
	if (args.audio) ff.push('-ss', String(f0 / fps), '-i', args.audio);
	ff.push('-map', '0:v', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(args.crf || 22), '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
	if (args.audio) ff.push('-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
	ff.push('-t', String((f1 - f0) / fps), args.out);
	const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
	const done = new Promise((res, rej) => enc.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg exited with ' + code)))));

	const t0 = Date.now();
	for (let f = f0; f < f1; f += workers) {
		const batch = [];
		for (let k = 0; k < workers && f + k < f1; k++) {
			const page = pages[k];
			const t = (f + k) / fps;
			batch.push(page.evaluate((x) => window.seek(x), t).then(() => page.screenshot({ type: 'jpeg', quality: 94 })));
		}
		for (const buf of await Promise.all(batch)) if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
		const n = Math.min(f + workers, f1) - f0;
		if (n % (workers * 15) === 0 || f + workers >= f1) process.stderr.write(`\r  frame ${n}/${f1 - f0}  ${(n / ((Date.now() - t0) / 1000)).toFixed(1)} fps   `);
	}
	enc.stdin.end();
	await done;
	await browser.close();
	process.stderr.write(`\n  wrote ${args.out}\n`);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

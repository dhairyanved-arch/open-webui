/* Stage: lays the props out on a desk, flies a camera between them and exposes
 * window.seek(t). Called by render.cjs with the timeline produced by songvid.
 */
(() => {
	const SV = window.SV;
	const { h } = SV;
	const FONTS = ['400 20px Inter', '600 20px Inter', '700 20px Inter', '600 20px Caveat', '700 20px Caveat', '400 20px "Permanent Marker"', '900 20px "Playfair Display"', 'italic 400 20px "Playfair Display"', '700 20px UnifrakturCook', '400 20px "Special Elite"'];

	const DECOR = ['ring', 'pencil', 'clip', 'blank', 'ring', 'tape', 'clip', 'pencil'];

	window.initStage = async (TL) => {
		await Promise.all(FONTS.map((f) => document.fonts.load(f)));
		await document.fonts.ready;
		const meta = TL.meta;
		const look = Object.assign({ desk: 'walnut', grain: 0.09, pulse: 1, tilt: 1, accent: '#ffb24a' }, TL.look || {});
		const VW = meta.width;
		const VH = meta.height;
		const fps = meta.fps || 30;
		const D = meta.duration;
		const rng = SV.rng(meta.seed || 1);

		const viewport = document.getElementById('viewport');
		viewport.style.width = VW + 'px';
		viewport.style.height = VH + 'px';
		document.documentElement.style.setProperty('--accent', look.accent);
		const world = h('div#world');
		const desk = h('div#desk');
		world.append(desk);
		viewport.append(world);

		/* ---- build props ---- */
		const items = TL.scenes.map((scene, i) => {
			scene.opts = scene.opts || {};
			scene.seed = scene.seed || SV.hash(scene.prop + ':' + i + ':' + (meta.seed || 1));
			const lines = (scene.lines || []).map((li) => TL.lines[li]);
			const words = SV.wordsOf(lines);
			const ctx = {
				lines,
				words,
				text: lines.map((l) => l.text).join(' '),
				rng: SV.rng(scene.seed),
				look,
				meta,
				t0: scene.start,
				t1: scene.end,
				first: words.length ? words[0].s : scene.start,
				last: words.length ? words[words.length - 1].e : scene.end
			};
			const def = SV.props[scene.prop] || SV.props.sticky;
			const size = typeof def.size === 'function' ? def.size(scene, ctx) : def.size;
			const box = h('div.prop.prop-' + scene.prop, { style: { width: size.w + 'px', height: size.h + 'px' } });
			world.append(box);
			const inst = def.build(scene, ctx, box);
			return { scene, ctx, size, box, inst, rot: rng.range(-7, 7), x: 0, y: 0 };
		});

		/* ---- desk layout: a wandering trail of props that never overlap ---- */
		const radius = (it) => Math.hypot(it.size.w, it.size.h) / 2;
		items.forEach((it, i) => {
			if (i === 0) return;
			const prev = items[i - 1];
			const placed = items.slice(0, i);
			const cx = placed.reduce((n, o) => n + o.x, 0) / i;
			const cy = placed.reduce((n, o) => n + o.y, 0) / i;
			let best = null;
			for (let k = 0; k < 48; k++) {
				const a = rng.range(-3.1416, 3.1416);
				const dist = radius(prev) + radius(it) + rng.range(40, 240) + (k > 30 ? 400 : 0);
				const x = prev.x + Math.cos(a) * dist;
				const y = prev.y + Math.sin(a) * dist;
				if (!placed.every((o) => Math.hypot(o.x - x, o.y - y) > radius(o) + radius(it) + 30)) continue;
				// stay compact, but prefer a fresh direction over doubling back
				const score = Math.hypot(x - cx, y - cy) + rng.range(0, 500);
				if (!best || score < best.score) best = { x, y, score };
			}
			it.x = best ? best.x : prev.x + radius(prev) + radius(it) + 2000;
			it.y = best ? best.y : prev.y;
		});
		const bounds = items.reduce((b, it) => ({ x0: Math.min(b.x0, it.x - radius(it)), y0: Math.min(b.y0, it.y - radius(it)), x1: Math.max(b.x1, it.x + radius(it)), y1: Math.max(b.y1, it.y + radius(it)) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
		const M = 5200;
		Object.assign(desk.style, {
			left: bounds.x0 - M + 'px',
			top: bounds.y0 - M + 'px',
			width: bounds.x1 - bounds.x0 + 2 * M + 'px',
			height: bounds.y1 - bounds.y0 + 2 * M + 'px',
			backgroundImage: `url("${SV.art.desk(look.desk, meta.seed || 7)}")`
		});
		items.forEach((it) => {
			Object.assign(it.box.style, { left: it.x - it.size.w / 2 + 'px', top: it.y - it.size.h / 2 + 'px', transform: `rotate(${it.rot}deg)` });
			const pr = radius(it) * 2.6;
			world.insertBefore(h('div.pool', { style: { left: it.x - pr + 'px', top: it.y - pr + 'px', width: pr * 2 + 'px', height: pr * 2 + 'px' } }), items[0].box);
		});
		/* a little desk clutter in the gaps */
		for (let i = 0, placed = 0; i < 400 && placed < items.length * 3 + 6; i++) {
			const x = rng.range(bounds.x0 - 500, bounds.x1 + 500);
			const y = rng.range(bounds.y0 - 700, bounds.y1 + 700);
			if (!items.every((o) => Math.hypot(o.x - x, o.y - y) > radius(o) + 150)) continue;
			const kind = DECOR[placed % DECOR.length];
			const el = h('div.decor.decor-' + kind, { style: { left: x + 'px', top: y + 'px', transform: `translate(-50%,-50%) rotate(${rng.range(-180, 180)}deg) scale(${rng.range(0.85, 1.25)})` } });
			if (kind === 'blank') el.style.backgroundImage = `url("${SV.art.photo({ kind: rng.pick(look.photos || ['hills', 'road', 'city']), tone: rng.pick(look.tones || ['dusk']), seed: 900 + placed, w: 300, h: 300 })}")`;
			world.insertBefore(el, items[0].box);
			placed++;
		}

		/* ---- overlays ---- */
		const grain = h('div#grain', { style: { backgroundImage: `url("${SV.art.noise(256, 11)}")`, opacity: look.grain } });
		const fade = h('div#fade');
		const endcard = h('div#endcard', h('b', meta.title || ''), h('span', meta.artist || ''));
		document.getElementById('frame').append(h('div#vignette'), grain, endcard, fade);

		/* ---- camera ---- */
		const defaultShots = (it) => {
			const w0 = Math.max(it.size.w * 1.3, it.size.h * 1.16 * (VW / VH));
			const r0 = (it.ctx.rng() - 0.5) * 9;
			return [
				{ at: 0, x: it.size.w / 2, y: it.size.h / 2, w: w0, rot: r0 },
				{ at: 1, x: it.size.w / 2, y: it.size.h / 2, w: w0 * 0.87, rot: r0 * -0.3 }
			];
		};
		items.forEach((it) => (it.shots = it.inst.shots || defaultShots(it)));
		const local = (it, t) => {
			const u = SV.unlerp(it.scene.start, it.scene.end, t);
			if (typeof it.shots === 'function') return it.shots(u, t);
			const ks = it.shots;
			let a = ks[0];
			let b = ks[ks.length - 1];
			for (let i = 0; i < ks.length - 1; i++) if (u >= ks[i].at && u <= ks[i + 1].at) [a, b] = [ks[i], ks[i + 1]];
			const v = SV.ease.out(SV.unlerp(a.at, b.at, u));
			return { x: SV.lerp(a.x, b.x, v), y: SV.lerp(a.y, b.y, v), w: SV.lerp(a.w, b.w, v), rot: SV.lerp(a.rot || 0, b.rot || 0, v) };
		};
		const shot = (i, t) => {
			const it = items[i];
			const s = local(it, t);
			const dx = s.x - it.size.w / 2;
			const dy = s.y - it.size.h / 2;
			const a = (it.rot * Math.PI) / 180;
			return { x: it.x + dx * Math.cos(a) - dy * Math.sin(a), y: it.y + dx * Math.sin(a) + dy * Math.cos(a), z: VW / s.w, r: it.rot + (s.rot || 0) };
		};
		const cuts = items.slice(1).map((it, i) => {
			const T = it.scene.start;
			const d = Math.min(0.62, 0.8 * (T - items[i].scene.start), 0.8 * (it.scene.end - T));
			return { T, d };
		});
		const wide = {
			x: (bounds.x0 + bounds.x1) / 2,
			y: (bounds.y0 + bounds.y1) / 2,
			z: Math.max(0.2, Math.min(VW / (bounds.x1 - bounds.x0 + 300), VH / (bounds.y1 - bounds.y0 + 300))),
			r: 0
		};
		const lastWord = Math.max(0, ...items.map((it) => (it.ctx.words.length ? it.ctx.last : 0)));
		const outroAt = D - lastWord > 2.2 ? Math.max(lastWord + 0.7, D - 3.2) : null;
		const beats = meta.beats || [];
		const mix = (A, B, u, dip = 0) => ({ x: SV.lerp(A.x, B.x, u), y: SV.lerp(A.y, B.y, u), z: Math.exp(SV.lerp(Math.log(A.z), Math.log(B.z), u)) * (1 - dip * Math.sin(u * Math.PI)), r: SV.lerp(A.r, B.r, u) });

		const camera = (t) => {
			let i = 0;
			while (i < items.length - 1 && t >= items[i + 1].scene.start) i++;
			let c = shot(i, t);
			for (let k = 0; k < cuts.length; k++) {
				const { T, d } = cuts[k];
				if (t > T - d / 2 && t < T + d / 2) {
					const A = shot(k, T - d / 2);
					const B = shot(k + 1, T + d / 2);
					const far = Math.hypot(B.x - A.x, B.y - A.y) * Math.min(A.z, B.z);
					c = mix(A, B, SV.ease.inOutQuart(SV.unlerp(T - d / 2, T + d / 2, t)), SV.clamp(far / 9000, 0.05, 0.28));
				}
			}
			if (outroAt != null && t > outroAt) c = mix(c, wide, SV.ease.inOut(SV.unlerp(outroAt, D - 0.2, t)) * 0.9);
			const open = 1 - SV.ease.outQuint(SV.unlerp(0, 1.1, t));
			c.z *= 1 - 0.34 * open;
			c.r += 9 * open;
			let b = 0;
			for (let k = beats.length - 1; k >= 0; k--)
				if (beats[k] <= t) {
					b = Math.exp(-(t - beats[k]) * 8);
					break;
				}
			c.z *= 1 + 0.014 * look.pulse * b;
			c.x += Math.sin(t * 0.83) * 7 + Math.sin(t * 2.1) * 2;
			c.y += Math.cos(t * 0.71) * 8;
			c.tx = (5.5 + 2.2 * Math.sin(t * 0.5)) * look.tilt;
			c.ty = 2.6 * Math.sin(t * 0.37 + 1) * look.tilt;
			return c;
		};

		window.seek = (t) => {
			t = Math.max(0, Math.min(D, t));
			for (const it of items) it.inst.update(t);
			const c = camera(t);
			const p = camera(Math.max(0, t - 1 / fps));
			world.style.transform = `translate(${VW / 2}px,${VH / 2}px) rotateX(${c.tx.toFixed(3)}deg) rotateY(${c.ty.toFixed(3)}deg) scale(${c.z.toFixed(5)}) rotate(${(-c.r).toFixed(4)}deg) translate(${(-c.x).toFixed(2)}px,${(-c.y).toFixed(2)}px)`;
			const speed = Math.hypot(c.x - p.x, c.y - p.y) * c.z + Math.abs(Math.log(c.z / p.z)) * VW * 0.35 + Math.abs(c.r - p.r) * 14;
			const calm = outroAt != null && t > outroAt ? 0.3 : 1; // the closing pull-back stays sharp
			const blur = SV.clamp((speed - 16) * 0.16 * calm, 0, 20);
			viewport.style.filter = blur > 0.6 ? `blur(${blur.toFixed(1)}px)` : 'none';
			const frame = Math.round(t * fps);
			const gf = frame >> 1;
			grain.style.backgroundPosition = `${(gf * 97) % 256}px ${(gf * 57) % 256}px`;
			fade.style.opacity = Math.max(1 - SV.unlerp(0, 0.45, t), SV.unlerp(D - 0.45, D - 0.02, t));
			endcard.style.opacity = outroAt != null ? SV.unlerp(outroAt + 0.5, outroAt + 1.2, t) : 0;
		};
		window.seek(0);
		window.stageInfo = { scenes: items.length, world: bounds, duration: D };
		return window.stageInfo;
	};
})();

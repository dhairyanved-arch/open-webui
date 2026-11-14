/* Paper props: sticky note, polaroids, newspaper, hanging signs, letter, book, ticket.
 *
 * Prop contract:
 *   SV.props.name = {
 *     size: {w,h} | (scene, ctx) => {w,h},        // footprint on the desk, px
 *     build(scene, ctx, box) => { update(t), shots? }
 *   }
 * `box` is an empty element already sized w×h. `ctx.words` are the timed words
 * of the lyric line(s) this scene owns; times are absolute clip seconds.
 */
(() => {
	const SV = window.SV;
	const { h } = SV;

	/* Something landing on the desk: scales down, fades in, wobbles. */
	SV.dropIn = (el, t, at, { dur = 0.42, from = 1.28, rot = 0, swing = 5 } = {}) => {
		const u = SV.unlerp(at, at + dur, t);
		if (el._u === u) return u;
		el._u = u;
		const e = SV.ease.outQuint(u);
		el.style.opacity = SV.clamp(u * 4);
		el.style.transform = `rotate(${rot + (u < 1 ? swing * SV.ease.swing(u, 1.5, 4) : 0)}deg) scale(${SV.lerp(from, 1, e)})`;
		return u;
	};

	SV.props.sticky = {
		size: { w: 640, h: 660 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const txt = h('div.sticky-txt');
			const motif = o.doodle || SV.motif(ctx.text, 'star');
			const doodle = h('div.sticky-doodle', { html: SV.icon(motif, { size: 120, sw: 1.7, fill: motif === 'heart' ? 'currentColor' : 'none' }) });
			const note = h('div.sticky.c-' + (o.color || 'yellow'), h('div.pushpin'), txt, doodle);
			box.append(note);
			const tt = SV.timedText(txt, ctx.words, { mode: 'write' });
			SV.fit(txt, 520, 360, 104, 36);
			const rot = ctx.rng.range(-4, 4);
			return {
				update(t) {
					SV.dropIn(note, t, ctx.t0 - 0.1, { rot });
					tt.update(t);
					const u = SV.unlerp(tt.last + 0.05, tt.last + 0.4, t);
					doodle.style.opacity = u;
					doodle.style.transform = `scale(${0.4 + 0.6 * SV.ease.outBack(u)}) rotate(${-8 + 8 * u}deg)`;
				}
			};
		}
	};

	SV.props.polaroid = {
		size: (scene, ctx) => (ctx.lines.length > 1 ? { w: 980, h: 520 + 420 * Math.min(3, ctx.lines.length) - 240 } : { w: 900, h: 1000 }),
		build(scene, ctx, box) {
			const cards = [];
			const mk = (i, x, y, w, rot, line) => {
				const cap = h('div.pola-cap');
				const el = h(
					'div.pola',
					{ style: { left: x + 'px', top: y + 'px', width: w + 'px' } },
					h('div.pola-img', { style: { height: w - 48 + 'px', backgroundImage: `url("${SV.art.photoFor(scene, ctx, i, 600, 600)}")` } }),
					cap
				);
				box.append(el);
				let tt = null;
				if (line) {
					tt = SV.timedText(cap, SV.wordsOf([line]), { mode: 'write' });
					SV.fit(cap, cap.clientWidth, cap.clientHeight, 68, 26);
				}
				cards.push({ el, rot, at: line ? line.start - 0.25 : ctx.t0 - 0.3 + i * 0.08, tt });
			};
			if (ctx.lines.length === 1) {
				mk(1, 20, 60, 400, -9, null);
				mk(2, 500, 20, 380, 7, null);
				mk(0, 130, 190, 640, ctx.rng.range(-3, 3), ctx.lines[0]);
			} else {
				ctx.lines.slice(0, 3).forEach((ln, i) => mk(i, i % 2 ? 420 : 40, 30 + i * 400, 520, (i % 2 ? 1 : -1) * ctx.rng.range(2.5, 6), ln));
			}
			return {
				update(t) {
					for (const c of cards) {
						SV.dropIn(c.el, t, c.at, { rot: c.rot, swing: 7 });
						c.tt && c.tt.update(t);
					}
				}
			};
		}
	};

	SV.props.newspaper = {
		size: { w: 1100, h: 1480 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const head = h('div.np-head');
			const fill = SV.art.filler(scene.seed + 5, 3);
			box.append(
				h(
					'div.np',
					h('div.np-mast', o.masthead || ctx.look.masthead || 'The Evening Ledger'),
					h('div.np-date', h('span', o.edition || 'LATE EDITION'), h('span', o.dateline || 'VOL. XXVII · NO. 114'), h('span', o.price || 'PRICE FIVE CENTS')),
					h('div.np-headbox', head),
					h('div.np-kicker', o.kicker || 'An account of events as they were told to this newspaper'),
					h(
						'div.np-body',
						h('div.np-photo', { style: { backgroundImage: `url("${SV.art.photoFor(scene, ctx, 0, 1000, 560)}")` } }),
						h('div.np-cols', fill)
					)
				)
			);
			const tt = SV.timedText(head, ctx.words, { mode: 'type', transform: (s) => s.toUpperCase() });
			SV.fit(head, 1000, 400, 170, 54);
			tt.measure();
			return {
				update: (t) => tt.update(t),
				shots: [
					{ at: 0, x: 550, y: 430, w: 1320, rot: -3 },
					{ at: 1, x: 550, y: 520, w: 1160, rot: 1.5 }
				]
			};
		}
	};

	const chunkWords = (words, maxChars = 11, maxWords = 2) => {
		const out = [];
		let cur = [];
		for (const w of words) {
			const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
			if (cur.length && (cur.length >= maxWords || len > maxChars || cur[0].li !== w.li)) {
				out.push(cur);
				cur = [];
			}
			cur.push(w);
		}
		if (cur.length) out.push(cur);
		return out;
	};

	SV.props.signs = {
		size: (scene, ctx) => {
			const n = chunkWords(ctx.words).length;
			const cols = n <= 4 ? Math.min(n, 2) : 3;
			return { w: cols * 350 + 40, h: Math.ceil(n / cols) * 470 + 60 };
		},
		build(scene, ctx, box) {
			const chunks = chunkWords(ctx.words);
			const cols = chunks.length <= 4 ? Math.min(chunks.length, 2) : 3;
			const strips = chunks.map((ch, i) => {
				const txt = h('div.sign-txt');
				const rot = ctx.rng.range(-4.5, 4.5);
				const el = h(
					'div.sign',
					{ style: { left: 30 + (i % cols) * 350 + ctx.rng.range(-8, 8) + 'px', top: 40 + Math.floor(i / cols) * 470 + ctx.rng.range(-14, 14) + 'px' } },
					h('div.sign-tape'),
					txt
				);
				box.append(el);
				const tt = SV.timedText(txt, ch.map((w) => ({ ...w, li: 0 })), { mode: 'pop', transform: (s) => s.toUpperCase() });
				SV.fit(txt, 270, 330, 120, 30);
				return { el, tt, rot, at: ch[0].s - 0.12 };
			});
			return {
				update(t) {
					for (const s of strips) {
						const u = SV.unlerp(s.at, s.at + 0.6, t);
						s.el.style.opacity = SV.clamp(u * 6);
						s.el.style.transform = `rotate(${s.rot + (u < 1 ? 16 * SV.ease.swing(u, 1.6, 4) : 0)}deg) scale(${SV.lerp(1.12, 1, SV.ease.out(u))})`;
						s.tt.update(t);
					}
				}
			};
		}
	};

	SV.props.letter = {
		size: { w: 880, h: 1180 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const body = h('div.letter-body');
			const sign = h('div.letter-sign', o.sign || '— yours');
			box.append(h('div.letter', h('div.letter-date', o.date || 'Sunday, late'), h('div.letter-greet', o.greeting || 'Listen —'), body, sign));
			const tt = SV.timedText(body, ctx.words, { mode: 'write' });
			SV.fit(body, 700, 640, 84, 40);
			return {
				update(t) {
					tt.update(t);
					sign.style.opacity = SV.unlerp(tt.last + 0.1, tt.last + 0.6, t);
				},
				shots: [
					{ at: 0, x: 440, y: 500, w: 1080, rot: 4 },
					{ at: 1, x: 440, y: 600, w: 960, rot: -1 }
				]
			};
		}
	};

	SV.props.book = {
		size: { w: 740, h: 1020 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const title = h('div.book-title');
			const orn = h('div.book-orn', { html: SV.icon(o.doodle || SV.motif(ctx.text, 'star'), { size: 84, sw: 1.4 }) });
			box.append(
				h('div.book.c-' + (o.color || 'oxblood'), h('div.book-spine'), h('div.book-frame', h('div.book-top', o.top || 'A TRUE STORY'), title, orn, h('div.book-foot', o.foot || ctx.meta.title || '')))
			);
			const tt = SV.timedText(title, ctx.words, { mode: 'pop', transform: (s) => s.toUpperCase() });
			SV.fit(title, 520, 520, 120, 40);
			return {
				update(t) {
					tt.update(t);
					orn.style.opacity = SV.unlerp(tt.last, tt.last + 0.5, t);
				}
			};
		}
	};

	SV.props.ticket = {
		size: { w: 1120, h: 540 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const note = h('div.tk-note');
			const bars = Array.from({ length: 34 }, () => `<i style="width:${ctx.rng.pick([2, 3, 5, 7])}px"></i>`).join('');
			box.append(
				h(
					'div.tk',
					h(
						'div.tk-main',
						h('div.tk-top', h('span', o.carrier || 'ONE WAY · BOARDING PASS'), h('span', { html: SV.icon('plane', { size: 34, sw: 1.8 }) })),
						h('div.tk-route', h('b', o.from || 'HERE'), h('span.tk-line'), h('b', o.to || 'AWAY')),
						h('div.tk-label', o.label || 'NOTE TO PASSENGER'),
						note
					),
					h('div.tk-stub', h('div.tk-label', 'GATE'), h('b', o.gate || 'A7'), h('div.tk-label', 'SEAT'), h('b', o.seat || '12F'), h('div.tk-bars', { html: bars }))
				)
			);
			const tt = SV.timedText(note, ctx.words, { mode: 'type' });
			SV.fit(note, 720, 150, 62, 24);
			tt.measure();
			return {
				update: (t) => tt.update(t),
				shots: [
					{ at: 0, x: 560, y: 270, w: 1420, rot: -7 },
					{ at: 1, x: 560, y: 270, w: 1240, rot: -3 }
				]
			};
		}
	};
})();

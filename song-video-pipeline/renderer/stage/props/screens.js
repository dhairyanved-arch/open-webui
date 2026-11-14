/* Screen props: chat, search, map, social post, lock-screen notification,
 * weather widget, music player and the star chart.
 * All UI here is an original, generic design — it does not copy any real app.
 */
(() => {
	const SV = window.SV;
	const { h } = SV;

	const phone = (cls, attrs, ...kids) => {
		if (attrs instanceof Node) {
			kids.unshift(attrs);
			attrs = {};
		}
		return h('div.phone', h('div.phone-screen.' + cls, attrs, h('div.phone-notch'), ...kids));
	};
	const statusBar = (time) => h('div.sb', h('span', time), h('span.sb-r', h('i.sb-sig'), h('i.sb-bat')));

	SV.props.chat = {
		size: { w: 760, h: 1400 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const name = o.contact || 'You';
			const list = h('div.chat-list');
			(o.history || ['you still awake?', 'always']).forEach((m, i) => list.append(h('div.bub.' + (i % 2 ? 'out' : 'in'), m)));
			const bubs = ctx.lines.map((ln, i) => {
				const side = (o.sides && o.sides[i]) || (i % 2 ? 'in' : 'out');
				const txt = h('span');
				const dots = h('div.bub.dots.' + side, h('i'), h('i'), h('i'));
				const el = h('div.bub.' + side, txt);
				const row = h('div.bub-row.' + side, dots, el);
				list.append(row);
				const tt = SV.timedText(txt, SV.wordsOf([ln]), { mode: 'fade' });
				return { el, dots, tt, s: ln.start };
			});
			const seen = h('div.chat-seen', 'Delivered');
			list.append(seen);
			box.append(
				phone(
					'chat',
					statusBar(o.time || '23:41'),
					h('div.chat-head', h('div.avatar', name[0].toUpperCase()), h('div', h('b', name), h('small', 'online'))),
					list,
					h('div.chat-input', h('span', 'Message'), h('i', { html: SV.icon('arrowUp', { size: 30, color: '#fff', sw: 2.6 }) }))
				)
			);
			return {
				update(t) {
					for (const b of bubs) {
						const pre = SV.unlerp(b.s - 0.55, b.s - 0.4, t) * (1 - SV.unlerp(b.s - 0.06, b.s, t));
						b.dots.style.opacity = pre;
						b.dots.style.transform = `scale(${0.8 + 0.2 * pre})`;
						[...b.dots.children].forEach((d, i) => (d.style.transform = `translateY(${-5 * Math.max(0, Math.sin((t * 9 - i * 0.9) % 6.28))}px)`));
						const u = SV.unlerp(b.s - 0.06, b.s + 0.2, t);
						b.el.style.opacity = SV.clamp(u * 3);
						b.el.style.transform = `scale(${0.7 + 0.3 * SV.ease.outBack(u)})`;
						b.tt.update(t);
					}
					seen.style.opacity = SV.unlerp(ctx.last + 0.2, ctx.last + 0.5, t) * 0.7;
				},
				shots: [
					{ at: 0, x: 380, y: 760, w: 1040, rot: 5 },
					{ at: 1, x: 380, y: 840, w: 900, rot: 1 }
				]
			};
		}
	};

	SV.props.search = {
		size: { w: 980, h: 900 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const q = h('div.se-q');
			const rows = (o.suggestions || ['Recent places', 'Saved for later', 'Open now · nearby', 'Somewhere new']).map((s, i) =>
				h('div.se-row', h('i', { html: SV.icon(['clock', 'bookmark', 'pin', 'star'][i % 4], { size: 34, sw: 1.9 }) }), h('div', h('b', s), h('small', ['Earlier today', '3 items', '1.2 km', 'Suggested'][i % 4])))
			);
			box.append(
				h(
					'div.se',
					h('div.se-grab'),
					h('div.se-bar', h('i', { html: SV.icon('search', { size: 42, sw: 2.2 }) }), q, h('i.se-mic', { html: SV.icon('mic', { size: 38, sw: 2 }) })),
					h('div.se-label', o.label || 'Suggestions'),
					...rows
				)
			);
			const tt = SV.timedText(q, ctx.words, { mode: 'type' });
			SV.fit(q, 700, 150, 58, 30);
			tt.measure();
			const span = Math.max(0.6, ctx.last - ctx.first);
			return {
				update(t) {
					tt.update(t);
					rows.forEach((r, i) => {
						const u = SV.unlerp(ctx.first + (span * (i + 1)) / (rows.length + 1), ctx.first + (span * (i + 1)) / (rows.length + 1) + 0.3, t);
						r.style.opacity = u;
						r.style.transform = `translateY(${(1 - SV.ease.out(u)) * 24}px)`;
					});
				},
				shots: [
					{ at: 0, x: 490, y: 300, w: 1180, rot: -4 },
					{ at: 1, x: 490, y: 380, w: 1040, rot: 0 }
				]
			};
		}
	};

	/* Procedural night-mode street map with an animated route. */
	const buildMap = (W, H, rng, o) => {
		const p = [];
		p.push(`<rect width="${W}" height="${H}" fill="#18212d"/>`);
		const blocks = [];
		const ang = rng.range(-18, 18);
		p.push(`<g transform="rotate(${ang} ${W / 2} ${H / 2})">`);
		for (let y = -300; y < H + 300; y += rng.range(120, 190)) {
			for (let x = -300; x < W + 300; ) {
				const bw = rng.range(110, 260);
				const bh = rng.range(90, 150);
				const park = rng() < 0.09;
				p.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(bw - 16).toFixed(0)}" height="${(bh - 16).toFixed(0)}" rx="8" fill="${park ? '#1f3b33' : '#202b3a'}"/>`);
				blocks.push([x + bw / 2, y + bh / 2]);
				x += bw;
			}
		}
		for (let i = 0; i < 4; i++) {
			const yy = rng.range(0, H);
			p.push(`<rect x="-400" y="${yy}" width="${W + 800}" height="${rng.range(20, 34)}" fill="#2c394b"/>`);
			const xx = rng.range(0, W);
			p.push(`<rect x="${xx}" y="-400" width="${rng.range(20, 34)}" height="${H + 800}" fill="#2c394b"/>`);
		}
		p.push('</g>');
		// river
		const ry = rng.range(H * 0.15, H * 0.3);
		p.push(`<path d="M-50 ${ry} C ${W * 0.3} ${ry + 160}, ${W * 0.6} ${ry - 140}, ${W + 50} ${ry + 90}" stroke="#12304f" stroke-width="78" fill="none" stroke-linecap="round"/>`);
		// route: a few waypoints from the bottom-left towards the top-right
		const pts = [];
		const n = 5;
		for (let i = 0; i < n; i++) {
			const u = i / (n - 1);
			pts.push([SV.lerp(W * 0.2, W * 0.76, u) + (i % 2 ? 1 : -1) * rng.range(30, 110), SV.lerp(H * 0.8, H * 0.36, u) + rng.range(-40, 40)]);
		}
		let d = `M${pts[0][0]} ${pts[0][1]}`;
		for (let i = 1; i < pts.length; i++) {
			const [x0, y0] = pts[i - 1];
			const [x1, y1] = pts[i];
			d += ` C ${x0 + (x1 - x0) * 0.6} ${y0}, ${x1 - (x1 - x0) * 0.2} ${y1 + (y0 - y1) * 0.5}, ${x1} ${y1}`;
		}
		p.push(`<path d="${d}" stroke="#0b5fc4" stroke-opacity=".35" stroke-width="26" fill="none" stroke-linecap="round"/>`);
		p.push(`<path class="route" d="${d}" stroke="#3aa0ff" stroke-width="15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
		const labels = o.places || ['Old Quarter', 'Riverside', 'Night Market', 'The Overlook', 'Station Rd'];
		labels.forEach((name, i) => {
			const [bx, by] = blocks[Math.floor(rng() * blocks.length)] || [W / 2, H / 2];
			const x = SV.clamp(bx, 120, W - 160);
			const y = SV.clamp(by, H * 0.3, H * 0.9);
			const col = ['#7fd4a3', '#f0a35a', '#d58cf0', '#8fb6ff', '#9aa7b8'][i % 5];
			p.push(`<circle cx="${x - 22}" cy="${y - 9}" r="11" fill="${col}"/><text x="${x}" y="${y}" fill="${col}" font-family="Inter" font-weight="600" font-size="26">${SV.esc(name)}</text>`);
		});
		return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`, pts };
	};

	SV.props.map = {
		size: { w: 1000, h: 1320 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const W = 1000;
			const H = 1320;
			const m = buildMap(W, H, ctx.rng, o);
			const banner = h('div.map-nav-txt');
			const dot = h('div.map-dot');
			const dest = h('div.map-dest', h('i', { html: SV.icon('pin', { size: 64, color: '#fff', fill: '#ff4d5e', sw: 1.6 }) }), h('b', o.to || 'There'));
			const end = m.pts[m.pts.length - 1];
			dest.style.left = end[0] + 'px';
			dest.style.top = end[1] + 'px';
			const canvas = h('div.map-canvas', { html: m.svg });
			box.append(
				h(
					'div.map',
					canvas,
					dot,
					dest,
					h('div.map-nav', h('i', { html: SV.icon('turn', { size: 64, color: '#fff', sw: 2.4 }) }), banner),
					h('div.map-eta', h('b', o.eta || '12 min'), h('span', o.distance || '4.8 km · fastest route'), h('em', o.from || 'You'))
				)
			);
			const route = canvas.querySelector('.route');
			const len = route.getTotalLength();
			route.style.strokeDasharray = len;
			const tt = SV.timedText(banner, ctx.words, { mode: 'type' });
			SV.fit(banner, 740, 190, 62, 30);
			tt.measure();
			const pos = (u) => route.getPointAtLength(len * u);
			return {
				update(t) {
					tt.update(t);
					const u = SV.ease.inOut(SV.unlerp(ctx.first - 0.2, ctx.last + 0.5, t));
					route.style.strokeDashoffset = len * (1 - u);
					const pt = pos(u);
					dot.style.left = pt.x + 'px';
					dot.style.top = pt.y + 'px';
					const pulse = (t * 1.3) % 1;
					dot.style.boxShadow = `0 0 0 ${10 + pulse * 46}px rgba(58,160,255,${0.35 * (1 - pulse)}), 0 6px 18px rgba(0,0,0,.5)`;
					const arrive = SV.unlerp(ctx.last + 0.2, ctx.last + 0.6, t);
					dest.style.transform = `translate(-50%,-100%) scale(${1 + 0.25 * Math.sin(arrive * Math.PI)})`;
				},
				shots: (u, t) => {
					const pt = pos(SV.ease.inOut(SV.unlerp(ctx.first - 0.2, ctx.last + 0.5, t)));
					return { x: SV.lerp(500, pt.x, 0.35), y: SV.lerp(560, pt.y, 0.25), w: SV.lerp(1240, 1040, u), rot: SV.lerp(-5, 2, u) };
				}
			};
		}
	};

	SV.props.post = {
		size: { w: 880, h: 1290 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const user = o.user || (ctx.meta.artist || 'someone').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'someone';
			const cap = h('span.post-cap');
			const heart = h('i.post-heart', { html: SV.icon('heart', { size: 54, sw: 2 }) });
			const count = h('b', '0');
			const burst = h('div.post-burst', { html: SV.icon('heart', { size: 220, color: '#fff', fill: '#fff', sw: 0 }) });
			box.append(
				h(
					'div.post',
					h('div.post-head', h('div.post-av', h('div', user[0].toUpperCase())), h('div', h('b', user), h('small', o.place || 'somewhere, tonight')), h('i', { html: SV.icon('more', { size: 40 }) })),
					h('div.post-img', { style: { backgroundImage: `url("${SV.art.photoFor(scene, ctx, 0, 880, 880)}")` } }, burst),
					h('div.post-actions', heart, h('i', { html: SV.icon('comment', { size: 54, sw: 2 }) }), h('i', { html: SV.icon('send', { size: 50, sw: 2 }) }), h('i.r', { html: SV.icon('bookmark', { size: 52, sw: 2 }) })),
					h('div.post-likes', count, ' likes'),
					h('div.post-text', h('b', user + ' '), cap)
				)
			);
			const tt = SV.timedText(cap, ctx.words, { mode: 'type' });
			SV.fit(cap.parentElement, 820, 190, 48, 26);
			tt.measure();
			const likeAt = ctx.first + (ctx.last - ctx.first) * 0.5;
			const base = o.likes || 4300 + (scene.seed % 900);
			return {
				update(t) {
					tt.update(t);
					const u = SV.unlerp(likeAt, likeAt + 0.5, t);
					const svg = heart.firstChild;
					svg.setAttribute('fill', u > 0 ? '#ff3b55' : 'none');
					svg.setAttribute('stroke', u > 0 ? '#ff3b55' : 'currentColor');
					heart.style.transform = `scale(${1 + 0.5 * Math.sin(u * Math.PI)})`;
					burst.style.opacity = Math.sin(u * Math.PI) * 0.92;
					burst.style.transform = `translate(-50%,-50%) scale(${0.5 + 0.7 * SV.ease.outBack(u)})`;
					count.textContent = Math.round(base + SV.unlerp(likeAt, ctx.t1, t) * 137 + (u > 0 ? 1 : 0)).toLocaleString('en-US');
				},
				shots: [
					{ at: 0, x: 440, y: 560, w: 1180, rot: 4 },
					{ at: 1, x: 440, y: 760, w: 990, rot: 0 }
				]
			};
		}
	};

	SV.props.notification = {
		size: { w: 760, h: 1400 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const cards = ctx.lines.map((ln, i) => {
				const msg = h('div.nt-msg');
				const el = h('div.nt', h('div.nt-ic', { html: SV.icon(o.icon || 'chat', { size: 40, color: '#fff', sw: 2 }) }), h('div.nt-b', h('div.nt-top', h('b', (o.senders && o.senders[i]) || o.sender || 'Unknown'), h('small', 'now')), msg));
				const tt = SV.timedText(msg, SV.wordsOf([ln]), { mode: 'fade' });
				return { el, tt, s: ln.start };
			});
			box.append(
				phone(
					'lock',
					{ style: { backgroundImage: `linear-gradient(rgba(5,8,20,.35),rgba(5,8,20,.7)),url("${SV.art.photoFor({ ...scene, opts: { ...o, photos: ['stars', 'hills', 'shore'], tones: o.tones || ['night', 'ember'] } }, ctx, 0, 760, 1400)}")` } },
					statusBar(''),
					h('div.lock-date', o.date || 'Saturday, late'),
					h('div.lock-time', o.time || '23:47'),
					h('div.nt-stack', ...cards.map((c) => c.el))
				)
			);
			return {
				update(t) {
					for (const c of cards) {
						const u = SV.unlerp(c.s - 0.2, c.s + 0.15, t);
						c.el.style.opacity = SV.clamp(u * 2.5);
						c.el.style.transform = `translateY(${(1 - SV.ease.outBack(u)) * -70}px) scale(${0.92 + 0.08 * u})`;
						c.tt.update(t);
					}
				},
				shots: [
					{ at: 0, x: 380, y: 640, w: 1060, rot: -5 },
					{ at: 1, x: 380, y: 760, w: 900, rot: -1 }
				]
			};
		}
	};

	const WX = {
		storm: { bg: 'linear-gradient(160deg,#1c2330,#3b4658 60%,#566174)', icon: 'bolt', label: 'Thunderstorms', temp: '14°' },
		night: { bg: 'linear-gradient(160deg,#0b1030,#27306b 70%,#4a4f94)', icon: 'moon', label: 'Clear night', temp: '11°' },
		fire: { bg: 'linear-gradient(160deg,#3a1208,#a0401a 60%,#e58a36)', icon: 'flame', label: 'Dry · warm', temp: '27°' },
		clear: { bg: 'linear-gradient(160deg,#1e6fc0,#58a8ea 60%,#9fd2fb)', icon: 'star', label: 'Clear skies', temp: '21°' }
	};
	SV.props.weather = {
		size: { w: 860, h: 900 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const m = SV.motif(ctx.text, 'moon');
			const kind = o.condition || ({ bolt: 'storm', flame: 'fire', moon: 'night' }[m] || 'clear');
			const wx = WX[kind] || WX.clear;
			const alert = h('div.wx-alert-txt');
			const ic = h('div.wx-ic', { html: SV.icon(wx.icon, { size: 230, color: '#fff', sw: 1.1, fill: 'rgba(255,255,255,.18)' }) });
			box.append(
				h(
					'div.wx',
					{ style: { background: wx.bg } },
					h('div.wx-loc', { html: SV.icon('pin', { size: 34, color: '#fff', sw: 2 }) }, o.location || 'Right here'),
					h('div.wx-row', h('div.wx-temp', o.temp || wx.temp), ic),
					h('div.wx-cond', o.label || wx.label),
					h('div.wx-alert', h('div.wx-alert-h', { html: SV.icon('warn', { size: 34, color: '#ffd45e', sw: 2.2 }) }, o.alert || 'Advisory'), alert)
				)
			);
			const tt = SV.timedText(alert, ctx.words, { mode: 'type' });
			SV.fit(alert, 700, 210, 58, 28);
			tt.measure();
			return {
				update(t) {
					tt.update(t);
					const flash = kind === 'storm' ? Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.1)) ** 6 : 0;
					ic.style.transform = `translateY(${Math.sin(t * 1.4) * 8}px) scale(${1 + flash * 0.08})`;
					ic.style.filter = `drop-shadow(0 0 ${20 + flash * 60}px rgba(255,255,255,${0.25 + flash * 0.6}))`;
				}
			};
		}
	};

	SV.props.player = {
		size: { w: 880, h: 1180 },
		build(scene, ctx, box) {
			const o = scene.opts;
			const fill = h('i');
			const cur = h('span', '0:00');
			const N = 36;
			const eq = h('div.pl-eq', ...Array.from({ length: N }, () => h('i')));
			const phases = Array.from({ length: N }, () => ctx.rng.range(0, 6.28));
			const tone = (ctx.look.tones || ['dusk'])[0];
			const total = ctx.meta.trackDuration || ctx.meta.duration;
			const off = ctx.meta.clipOffset || 0;
			const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
			box.append(
				h(
					'div.pl',
					h('div.pl-art', { style: { backgroundImage: `url("${o.image || SV.art.photo({ kind: o.photo || 'stars', tone, seed: scene.seed, w: 760, h: 760 })}")` } }, eq),
					h('div.pl-title', ctx.meta.title || 'Untitled'),
					h('div.pl-artist', ctx.meta.artist || ''),
					h('div.pl-bar', fill),
					h('div.pl-times', cur, h('span', fmt(total))),
					h('div.pl-ctl', h('i', { html: SV.icon('prev', { size: 62, fill: 'currentColor', sw: 1 }) }), h('i.pl-play', { html: SV.icon('play', { size: 60, fill: 'currentColor', sw: 1 }) }), h('i', { html: SV.icon('next', { size: 62, fill: 'currentColor', sw: 1 }) }))
				)
			);
			const env = ctx.meta.env || [];
			const rate = ctx.meta.envRate || 30;
			return {
				update(t) {
					const lvl = env.length ? env[Math.min(env.length - 1, Math.max(0, Math.floor(t * rate)))] : 0.5 + 0.3 * Math.sin(t * 8);
					[...eq.children].forEach((b, i) => {
						const v = SV.clamp(lvl * (0.45 + 0.55 * Math.abs(Math.sin(t * (2.5 + (i % 5)) + phases[i]))));
						b.style.height = 8 + v * 150 + 'px';
					});
					fill.style.width = SV.clamp((off + t) / total) * 100 + '%';
					cur.textContent = fmt(off + t);
				},
				shots: [
					{ at: 0, x: 440, y: 560, w: 1500, rot: -6 },
					{ at: 1, x: 440, y: 590, w: 1080, rot: 0 }
				]
			};
		}
	};

	/* Star chart: every word is a star; the constellation draws itself as the
	 * line is sung. */
	SV.props.stars = {
		size: { w: 1040, h: 1040 },
		build(scene, ctx, box) {
			const W = 1040;
			const words = ctx.words;
			const perRow = words.length <= 4 ? 2 : words.length <= 9 ? 3 : 4;
			const rows = Math.ceil(words.length / perRow);
			const nodes = words.map((w, i) => {
				const r = Math.floor(i / perRow);
				const c = i % perRow;
				const inRow = Math.min(perRow, words.length - r * perRow);
				const x = W * 0.5 + (c - (inRow - 1) / 2) * (640 / perRow) * 1.15 + ctx.rng.range(-24, 24);
				const y = W * 0.5 + (r - (rows - 1) / 2) * Math.min(170, 620 / rows) + ctx.rng.range(-26, 26) + (c % 2 ? 34 : -20);
				return { x, y, w };
			});
			let bg = '';
			for (let i = 0; i < 170; i++) {
				const a = ctx.rng.range(0, 6.28);
				const rr = Math.sqrt(ctx.rng()) * 470;
				bg += `<circle cx="${(W / 2 + Math.cos(a) * rr).toFixed(1)}" cy="${(W / 2 + Math.sin(a) * rr).toFixed(1)}" r="${ctx.rng.range(0.8, 2.6).toFixed(1)}" fill="#fff" opacity="${ctx.rng.range(0.2, 0.9).toFixed(2)}"/>`;
			}
			let ticks = '';
			for (let i = 0; i < 72; i++) ticks += `<line x1="${W / 2}" y1="34" x2="${W / 2}" y2="${i % 6 ? 48 : 62}" transform="rotate(${i * 5} ${W / 2} ${W / 2})" stroke="#c9b37a" stroke-width="${i % 6 ? 1.5 : 3}" opacity=".8"/>`;
			const segs = nodes.slice(1).map((n, i) => `<line class="seg" x1="${nodes[i].x}" y1="${nodes[i].y}" x2="${n.x}" y2="${n.y}" stroke="#f3e3b3" stroke-width="2.5" stroke-linecap="round" opacity=".85"/>`).join('');
			const svg = h('div.sc-svg', {
				html: `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><defs><radialGradient id="scg${scene.seed}"><stop offset="0" stop-color="#1b2a5c"/><stop offset=".7" stop-color="#0b1330"/><stop offset="1" stop-color="#060a1c"/></radialGradient></defs><circle cx="${W / 2}" cy="${W / 2}" r="${W / 2 - 6}" fill="url(#scg${scene.seed})" stroke="#c9b37a" stroke-width="5"/><circle cx="${W / 2}" cy="${W / 2}" r="${W / 2 - 74}" fill="none" stroke="#c9b37a" stroke-width="1.5" opacity=".6"/><circle cx="${W / 2}" cy="${W / 2}" r="${W / 2 - 250}" fill="none" stroke="#c9b37a" stroke-width="1" stroke-dasharray="4 10" opacity=".45"/>${ticks}${bg}${segs}</svg>`
			});
			box.append(h('div.sc', svg));
			const segEls = [...svg.querySelectorAll('.seg')];
			segEls.forEach((s) => {
				const L = Math.hypot(s.x2.baseVal.value - s.x1.baseVal.value, s.y2.baseVal.value - s.y1.baseVal.value);
				s._len = L;
				s.style.strokeDasharray = L;
			});
			const els = nodes.map((n) => {
				const star = h('i.sc-star', { style: { left: n.x + 'px', top: n.y + 'px' } });
				const label = h('span.sc-word', { style: { left: n.x + 'px', top: n.y + 'px' }, text: n.w.w });
				box.firstChild.append(star, label);
				return { star, label, s: n.w.s };
			});
			return {
				update(t) {
					els.forEach((e, i) => {
						const u = SV.unlerp(e.s - 0.02, e.s + 0.3, t);
						const tw = 1 + 0.18 * Math.sin(t * 3 + i * 1.7);
						e.star.style.opacity = SV.clamp(u * 3);
						e.star.style.transform = `translate(-50%,-50%) scale(${(0.3 + 0.7 * SV.ease.outBack(u) + 1.4 * Math.sin(u * Math.PI)) * tw})`;
						e.label.style.opacity = SV.ease.out(u);
						e.label.style.transform = `translate(-50%, ${10 + (1 - SV.ease.out(u)) * 16}px)`;
						if (i > 0) {
							const a = els[i - 1].s;
							const v = SV.ease.inOut(SV.unlerp(Math.max(a, e.s - 0.4), e.s, t));
							segEls[i - 1].style.strokeDashoffset = segEls[i - 1]._len * (1 - v);
						}
					});
				},
				shots: [
					{ at: 0, x: 520, y: 520, w: 1300, rot: -8 },
					{ at: 1, x: 520, y: 520, w: 1090, rot: 3 }
				]
			};
		}
	};
})();

/* Song video stage — core helpers.
 * Everything here is a pure function of the clip time `t` (seconds): no CSS
 * animations, no timers. The renderer calls window.seek(t) once per frame.
 */
window.SV = { props: {}, art: {} };

(() => {
	const SV = window.SV;

	SV.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
	SV.lerp = (a, b, u) => a + (b - a) * u;
	SV.unlerp = (a, b, x) => (b === a ? (x >= b ? 1 : 0) : SV.clamp((x - a) / (b - a)));
	SV.ease = {
		inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
		inOutQuart: (u) => (u < 0.5 ? 8 * u ** 4 : 1 - Math.pow(-2 * u + 2, 4) / 2),
		out: (u) => 1 - Math.pow(1 - u, 3),
		outQuint: (u) => 1 - Math.pow(1 - u, 5),
		in: (u) => u * u * u,
		outBack: (u) => {
			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
		},
		// damped swing that settles on 0: used for things that drop in and wobble
		swing: (u, turns = 2.5, damp = 5) => Math.exp(-damp * u) * Math.cos(u * turns * Math.PI * 2)
	};

	/* Seeded RNG (mulberry32) so every render of a storyboard is identical. */
	SV.rng = (seed) => {
		let a = seed >>> 0 || 1;
		const f = () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		f.range = (lo, hi) => lo + (hi - lo) * f();
		f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
		f.pick = (arr) => arr[Math.floor(f() * arr.length)];
		f.sign = () => (f() < 0.5 ? -1 : 1);
		return f;
	};
	SV.hash = (str) => {
		let h = 2166136261;
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return h >>> 0;
	};

	/* Tiny DOM builder: h('div.a.b', {style:{...}, html:'..'}, child, child) */
	SV.h = (spec, attrs, ...kids) => {
		const [head, ...cls] = spec.split('.');
		const [tag, id] = head.split('#');
		const el = document.createElement(tag || 'div');
		if (id) el.id = id;
		if (cls.length) el.className = cls.join(' ');
		if (attrs && (attrs instanceof Node || typeof attrs === 'string')) {
			kids.unshift(attrs);
			attrs = null;
		}
		for (const [k, v] of Object.entries(attrs || {})) {
			if (k === 'style') Object.assign(el.style, v);
			else if (k === 'html') el.innerHTML = v;
			else if (k === 'text') el.textContent = v;
			else el.setAttribute(k, v);
		}
		for (const kid of kids.flat()) {
			if (kid == null || kid === false) continue;
			el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
		}
		return el;
	};
	SV.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	/* Shrink font-size until `el` fits in maxW × maxH (el must be in the DOM). */
	SV.fit = (el, maxW, maxH, max = 120, min = 18) => {
		let lo = min;
		let hi = max;
		const ok = (s) => {
			el.style.fontSize = s + 'px';
			return el.scrollWidth <= maxW + 1 && el.scrollHeight <= maxH + 1;
		};
		if (ok(hi)) return hi;
		for (let i = 0; i < 9; i++) {
			const mid = (lo + hi) / 2;
			if (ok(mid)) lo = mid;
			else hi = mid;
		}
		el.style.fontSize = Math.floor(lo) + 'px';
		return Math.floor(lo);
	};

	/* All the words of one or more lyric lines, flattened, with a line index. */
	SV.wordsOf = (lines) => lines.flatMap((ln, li) => ln.words.map((w) => ({ ...w, li })));

	/* Timed text.
	 * Builds one span per character inside `host` and returns update(t) which
	 * reveals them in sync with the word timings.
	 *   mode 'type'  – characters appear as if typed, with a caret
	 *   mode 'write' – characters ink in one after another (handwriting)
	 *   mode 'pop'   – whole words punch in
	 *   mode 'fade'  – whole words fade up softly
	 */
	SV.timedText = (host, words, opts = {}) => {
		const mode = opts.mode || 'type';
		const transform = opts.transform || ((s) => s);
		const brk = opts.breakLines !== false;
		host.classList.add('tt', 'tt-' + mode);
		const chars = [];
		const wordEls = [];
		words.forEach((w, wi) => {
			if (wi > 0) {
				if (brk && words[wi - 1].li !== w.li) host.append(SV.h('br'));
				else host.append(' ');
			}
			const text = transform(w.w);
			const wEl = SV.h('span.tw');
			const dur = Math.max(0.08, Math.min(w.e - w.s, 0.09 * text.length + 0.12));
			[...text].forEach((ch, ci) => {
				const cEl = SV.h('span.tc', { text: ch });
				wEl.append(cEl);
				chars.push({ el: cEl, at: w.s + (dur * ci) / text.length, on: null });
			});
			host.append(wEl);
			wordEls.push({ el: wEl, s: w.s, on: null });
		});
		let caret = null;
		if (mode === 'type' && opts.caret !== false) {
			caret = SV.h('span.tcaret');
			host.append(caret);
		}
		const first = words.length ? words[0].s : 0;
		const last = words.length ? words[words.length - 1].e : 0;
		let geom = null;
		const measure = () => {
			geom = chars.map((c) => ({ x: c.el.offsetLeft + c.el.offsetWidth, y: c.el.offsetTop, h: c.el.offsetHeight }));
		};
		const update = (t) => {
			if (mode === 'pop' || mode === 'fade') {
				for (const w of wordEls) {
					const u = SV.unlerp(w.s, w.s + (mode === 'pop' ? 0.16 : 0.32), t);
					if (u === w.on) continue;
					w.on = u;
					w.el.style.opacity = mode === 'pop' ? (u > 0 ? 1 : 0) : SV.ease.out(u);
					w.el.style.transform =
						mode === 'pop'
							? `scale(${u >= 1 ? 1 : 0.55 + 0.45 * SV.ease.outBack(u)})`
							: `translateY(${(1 - SV.ease.out(u)) * 0.25}em)`;
				}
				return;
			}
			let shown = -1;
			for (let i = 0; i < chars.length; i++) {
				const c = chars[i];
				const u = mode === 'write' ? SV.unlerp(c.at, c.at + 0.12, t) : t >= c.at ? 1 : 0;
				if (u > 0) shown = i;
				if (u === c.on) continue;
				c.on = u;
				c.el.style.opacity = u;
			}
			if (caret) {
				if (!geom) measure();
				const active = t >= first - 0.25 && t <= last + 1.6;
				const blink = t > last + 0.15 ? Math.floor((t - last) / 0.45) % 2 === 0 : true;
				caret.style.opacity = active && blink ? 1 : 0;
				const g = shown >= 0 ? geom[shown] : { x: geom[0] ? geom[0].x - chars[0].el.offsetWidth : 0, y: geom[0] ? geom[0].y : 0, h: geom[0] ? geom[0].h : 0 };
				caret.style.left = g.x + 'px';
				caret.style.top = g.y + 'px';
				caret.style.height = g.h + 'px';
			}
		};
		return { update, first, last, wordEls, measure };
	};

	/* Small inline icon set (24×24 viewBox, stroke-based unless noted). */
	const P = {
		search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
		mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
		heart: '<path d="M12 20.5S3.5 15.4 3.5 9.2A4.7 4.7 0 0112 6.6a4.7 4.7 0 018.5 2.6c0 6.2-8.5 11.3-8.5 11.3z"/>',
		comment: '<path d="M20.5 11.5a8.5 8.5 0 01-12.6 7.4L3.5 20.5l1.6-4.4A8.5 8.5 0 1120.5 11.5z"/>',
		send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
		bookmark: '<path d="M6 3h12v18l-6-5-6 5z"/>',
		pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 10-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
		arrowUp: '<path d="M12 20V5M5 12l7-7 7 7"/>',
		turn: '<path d="M7 20v-7a4 4 0 014-4h8M15 5l4 4-4 4"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>',
		bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>',
		flame: '<path d="M12 22c4 0 6.5-2.8 6.5-6.3 0-3.2-2.2-5-3.3-7.4-.6 1.6-1.4 2.4-2.4 2.9.3-3-1-6.3-3.6-8.2.3 3.4-3.7 6.300-3.7 12.200C5.500 19.200 8 22 12 22z"/>',
		moon: '<path d="M20 14.500A8.500 8.500 0 019.500 4a8.500 8.500 0 1010.500 10.500z"/>',
		home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
		plane: '<path d="M2.500 13.500l19-8-6.500 16-3.500-6.500z"/>',
		play: '<path d="M7 4.500v15l12.500-7.500z"/>',
		next: '<path d="M5 5v14l10-7zM18 5v14"/>',
		prev: '<path d="M19 5v14L9 12zM6 5v14"/>',
		bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.500 2h-15zM10 20.500a2 2 0 004 0"/>',
		chat: '<path d="M4 5h16v11H9l-5 4z"/>',
		more: '<circle cx="5" cy="12" r="1.500"/><circle cx="12" cy="12" r="1.500"/><circle cx="19" cy="12" r="1.500"/>',
		camera: '<path d="M4 8h3l1.500-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		warn: '<path d="M12 3.500l9.500 17h-19zM12 10v5M12 17.500v.5"/>'
	};
	SV.icon = (name, { size = 24, color = 'currentColor', fill = 'none', sw = 2 } = {}) =>
		`<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;

	/* Pick a doodle/icon that suits the words of a line. Purely cosmetic. */
	const MOTIFS = [
		['heart', /\b(love|loved|lover|heart|hearts|kiss|darling|baby|honey)\b/i],
		['flame', /\b(fire|fires|flame|flames|burn|burning|light|spark|blaze)\b/i],
		['star', /\b(star|stars|sky|shine|shining|dream|dreams|wish|heaven)\b/i],
		['bolt', /\b(thunder|storm|storms|lightning|rain|clouds?|pouring|wild)\b/i],
		['moon', /\b(night|nights|moon|midnight|dark|darkness|sleep|tonight)\b/i],
		['home', /\b(home|house|town|street|door|room)\b/i],
		['plane', /\b(fly|flying|away|far|leave|leaving|world|shores?|ocean|sea|road|run|go)\b/i],
		['clock', /\b(time|day|days|year|years|young|younger|old|child|remember|forever|never|always)\b/i]
	];
	SV.motif = (text, fallback = 'star') => {
		for (const [name, re] of MOTIFS) if (re.test(text)) return name;
		return fallback;
	};
})();

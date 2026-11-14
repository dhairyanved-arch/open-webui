/* Procedural artwork: desk textures, paper grain and moody "photographs".
 * Nothing is downloaded and nothing depends on the song — everything is drawn
 * from a seed, so the pipeline is self-contained. Storyboards may override any
 * photo with a real image via `opts.image`.
 */
(() => {
	const SV = window.SV;
	const art = SV.art;

	const DESKS = {
		walnut: { base: [74, 46, 28], vary: 16, seam: 'rgba(20,10,4,.55)', light: 'rgba(255,196,120,.20)' },
		oak: { base: [150, 104, 62], vary: 18, seam: 'rgba(60,34,14,.45)', light: 'rgba(255,230,180,.22)' },
		ebony: { base: [34, 30, 32], vary: 9, seam: 'rgba(0,0,0,.6)', light: 'rgba(150,180,255,.12)' },
		slate: { base: [40, 46, 56], vary: 8, seam: 'rgba(8,10,14,.6)', light: 'rgba(160,190,255,.14)' }
	};
	art.desks = DESKS;

	/* Seamless wood (or stone) tile, returned as a data URL. */
	art.desk = (name = 'walnut', seed = 7) => {
		const d = DESKS[name] || DESKS.walnut;
		const S = 1024;
		const planks = 4;
		const ph = S / planks;
		const c = document.createElement('canvas');
		c.width = c.height = S;
		const g = c.getContext('2d');
		const r = SV.rng(seed);
		const stone = name === 'slate';
		for (let p = 0; p < planks; p++) {
			const tone = r.range(-d.vary, d.vary);
			const [R, G, B] = d.base.map((v) => v + tone);
			g.fillStyle = `rgb(${R},${G},${B})`;
			g.fillRect(0, p * ph, S, ph);
			if (stone) continue;
			// grain: long wobbly streaks, periodic in x so the tile repeats cleanly
			for (let i = 0; i < 230; i++) {
				const y0 = p * ph + r.range(2, ph - 2);
				const amp = r.range(0.5, 5);
				const k = r.int(1, 3);
				const phase = r.range(0, 6.28);
				const dark = r() < 0.62;
				g.strokeStyle = dark ? `rgba(0,0,0,${r.range(0.03, 0.16)})` : `rgba(255,220,170,${r.range(0.02, 0.09)})`;
				g.lineWidth = r.range(0.5, 2.4);
				g.beginPath();
				for (let x = 0; x <= S; x += 16) {
					const y = y0 + Math.sin((x / S) * Math.PI * 2 * k + phase) * amp;
					x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
				}
				g.stroke();
			}
			// a knot or two
			for (let i = 0; i < 2; i++) {
				if (r() < 0.45) continue;
				const kx = r.range(80, S - 80);
				const ky = p * ph + r.range(50, ph - 50);
				for (let q = 9; q > 0; q--) {
					g.strokeStyle = `rgba(0,0,0,${0.05 + 0.012 * (9 - q)})`;
					g.lineWidth = 1.2;
					g.beginPath();
					g.ellipse(kx, ky, q * 7, q * 2.6, 0, 0, Math.PI * 2);
					g.stroke();
				}
			}
			g.fillStyle = d.seam;
			g.fillRect(0, p * ph, S, 3);
			g.fillStyle = 'rgba(255,255,255,.05)';
			g.fillRect(0, p * ph + 3, S, 1.5);
			// one butt joint per plank
			const jx = Math.floor(r.range(0, S));
			g.fillStyle = d.seam;
			g.fillRect(jx, p * ph, 3, ph);
		}
		// fine speckle so flat areas never look digital
		const img = g.getImageData(0, 0, S, S);
		const px = img.data;
		for (let i = 0; i < px.length; i += 4) {
			const n = (r() - 0.5) * (stone ? 22 : 14);
			px[i] += n;
			px[i + 1] += n;
			px[i + 2] += n;
		}
		g.putImageData(img, 0, 0);
		return c.toDataURL('image/jpeg', 0.9);
	};

	/* Monochrome noise tile (film grain / paper tooth). */
	art.noise = (size = 256, seed = 3, alpha = 255) => {
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const g = c.getContext('2d');
		const img = g.createImageData(size, size);
		const r = SV.rng(seed);
		for (let i = 0; i < img.data.length; i += 4) {
			const v = Math.floor(r() * 255);
			img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
			img.data[i + 3] = alpha;
		}
		g.putImageData(img, 0, 0);
		return c.toDataURL('image/png');
	};

	const TONES = {
		dusk: { sky: ['#241a3f', '#7a3b5e', '#e8795a', '#f7c88f'], orb: '#ffe7b8', hill: ['#5b3350', '#3a2038', '#1a0f1f'], stars: 0.25 },
		night: { sky: ['#050816', '#0d1736', '#1d2f5f', '#34497a'], orb: '#f1f4ff', hill: ['#17244a', '#0e1731', '#060a18'], stars: 1 },
		gold: { sky: ['#6a3a1c', '#c9772f', '#f2b55e', '#fde6ad'], orb: '#fff6da', hill: ['#8a4f25', '#55301a', '#26150c'], stars: 0 },
		dawn: { sky: ['#2d3a66', '#8d6c95', '#f0a48b', '#ffe1b5'], orb: '#fff2d2', hill: ['#5d5278', '#3b3355', '#1c1830'], stars: 0.1 },
		storm: { sky: ['#12171d', '#27313b', '#48545f', '#7c8791'], orb: '#dfe6ee', hill: ['#2a333c', '#1a2027', '#0b0e12'], stars: 0 },
		ember: { sky: ['#0a0710', '#22102a', '#5a1f2e', '#b8492c'], orb: '#ffcf8a', hill: ['#2c1422', '#190c16', '#08040a'], stars: 0.7 }
	};
	art.tones = TONES;

	const person = (x, y, s, flip = 1) =>
		`<g transform="translate(${x},${y}) scale(${s * flip},${s})"><circle cx="0" cy="-58" r="9"/><path d="M-10-46c2-4 18-4 20 0l5 30-6 2 1 40h-7l-3-30-3 30h-7l1-40-6-2z"/></g>`;
	const seated = (x, y, s, flip = 1) =>
		`<g transform="translate(${x},${y}) scale(${s * flip},${s})"><circle cx="0" cy="-40" r="9"/><path d="M-9-29c2-4 16-4 18 0l6 22 20 4-1 8-30 1-12-6z"/></g>`;

	/* A silhouette "photograph" as an SVG data URL.
	 * kind: hills | figures | figure | campfire | road | city | shore | stars | window
	 */
	art.photo = ({ kind = 'hills', tone = 'dusk', seed = 1, w = 600, h = 600 } = {}) => {
		const T = TONES[tone] || TONES.dusk;
		const r = SV.rng(seed * 7919 + 13);
		const id = 'p' + seed + kind;
		const horizon = h * r.range(0.56, 0.68);
		const parts = [];
		parts.push(
			`<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">${T.sky.map((c, i) => `<stop offset="${(i / (T.sky.length - 1)) * 0.8}" stop-color="${c}"/>`).join('')}</linearGradient>` +
				`<radialGradient id="${id}g"><stop offset="0" stop-color="${T.orb}" stop-opacity=".95"/><stop offset=".25" stop-color="${T.orb}" stop-opacity=".45"/><stop offset="1" stop-color="${T.orb}" stop-opacity="0"/></radialGradient>` +
				`<radialGradient id="${id}v" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>` +
				`<filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .22 0"/></filter></defs>`
		);
		parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}s)"/>`);
		if (T.stars > 0) {
			const n = Math.floor(90 * T.stars * (kind === 'stars' ? 2.4 : 1));
			for (let i = 0; i < n; i++) {
				const sy = r.range(0, horizon * 0.95);
				parts.push(`<circle cx="${r.range(0, w).toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.range(0.5, 1.9).toFixed(2)}" fill="#fff" opacity="${(r.range(0.35, 1) * (1 - (sy / horizon) * 0.6)).toFixed(2)}"/>`);
			}
		}
		const ox = w * r.range(0.28, 0.72);
		const oy = kind === 'stars' ? h * 0.22 : horizon - h * r.range(0.02, 0.2);
		const orr = h * (tone === 'night' || tone === 'ember' ? 0.045 : 0.075);
		parts.push(`<circle cx="${ox}" cy="${oy}" r="${orr * 5}" fill="url(#${id}g)"/><circle cx="${ox}" cy="${oy}" r="${orr}" fill="${T.orb}"/>`);

		const ridge = (base, amp, col, step = 6) => {
			const k1 = r.range(1, 2.4);
			const k2 = r.range(3, 6);
			const p1 = r.range(0, 6.28);
			const p2 = r.range(0, 6.28);
			const yAt = (x) => base - amp * (0.6 * Math.sin((x / w) * 6.28 * k1 + p1) + 0.3 * Math.sin((x / w) * 6.28 * k2 + p2) + 0.4);
			let dd = `M0 ${h} L0 ${yAt(0).toFixed(1)}`;
			for (let x = step; x <= w; x += step) dd += ` L${x} ${yAt(x).toFixed(1)}`;
			parts.push(`<path d="${dd} L${w} ${h}Z" fill="${col}"/>`);
			return yAt;
		};

		if (kind === 'shore') {
			parts.push(`<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="${T.hill[1]}"/>`);
			for (let i = 0; i < 26; i++) {
				const yy = horizon + Math.pow(i / 26, 1.6) * (h - horizon);
				const ww = (8 + i * 3.2) * r.range(0.6, 1.4);
				parts.push(`<rect x="${ox - ww / 2 + r.range(-6, 6) * i * 0.25}" y="${yy}" width="${ww}" height="${1.5 + i * 0.14}" rx="1" fill="${T.orb}" opacity="${(0.75 - i * 0.02).toFixed(2)}"/>`);
			}
			const y = ridge(h * 0.98, h * 0.07, T.hill[2]);
			parts.push(`<g fill="${T.hill[2]}">${person(w * 0.3, y(w * 0.3) + 4, h / 420)}</g>`);
		} else if (kind === 'road') {
			ridge(horizon + h * 0.03, h * 0.07, T.hill[0]);
			parts.push(`<rect y="${horizon + h * 0.02}" width="${w}" height="${h}" fill="${T.hill[1]}"/>`);
			const vx = w * 0.5;
			const vy = horizon + h * 0.025;
			parts.push(`<path d="M${vx - 5} ${vy} L${vx + 5} ${vy} L${w * 0.96} ${h} L${w * 0.04} ${h}Z" fill="${T.hill[2]}"/>`);
			for (let i = 0; i < 7; i++) {
				const u0 = Math.pow(i / 7, 2.2);
				const u1 = Math.pow((i + 0.5) / 7, 2.2);
				const y0 = SV.lerp(vy, h, u0);
				const y1 = SV.lerp(vy, h, u1);
				parts.push(`<path d="M${vx - 1 - u0 * 5} ${y0} L${vx + 1 + u0 * 5} ${y0} L${vx + 1 + u1 * 6} ${y1} L${vx - 1 - u1 * 6} ${y1}Z" fill="${T.orb}" opacity=".8"/>`);
			}
		} else if (kind === 'city') {
			ridge(horizon + h * 0.05, h * 0.05, T.hill[0]);
			let x = -10;
			while (x < w) {
				const bw = r.range(w * 0.05, w * 0.12);
				const bh = r.range(h * 0.1, h * 0.38);
				const top = h * 0.9 - bh;
				parts.push(`<rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="${T.hill[2]}"/>`);
				for (let wy = top + 8; wy < h * 0.88; wy += 11)
					for (let wx = x + 5; wx < x + bw - 6; wx += 9) if (r() < 0.28) parts.push(`<rect x="${wx}" y="${wy}" width="4" height="5" fill="${T.orb}" opacity="${r.range(0.4, 0.95).toFixed(2)}"/>`);
				x += bw + r.range(-2, 6);
			}
			parts.push(`<rect y="${h * 0.9}" width="${w}" height="${h}" fill="${T.hill[2]}"/>`);
		} else if (kind === 'window') {
			ridge(horizon + h * 0.08, h * 0.08, T.hill[0]);
			ridge(horizon + h * 0.2, h * 0.07, T.hill[1]);
			const f = T.hill[2];
			parts.push(`<path d="M0 0H${w}V${h}H0Z M${w * 0.12} ${h * 0.1}V${h * 0.8}H${w * 0.88}V${h * 0.1}Z" fill="${f}" fill-rule="evenodd"/>`);
			parts.push(`<rect x="${w * 0.49}" y="${h * 0.1}" width="${w * 0.02}" height="${h * 0.7}" fill="${f}"/><rect x="${w * 0.12}" y="${h * 0.44}" width="${w * 0.76}" height="${h * 0.018}" fill="${f}"/>`);
			parts.push(`<g fill="${f}">${person(w * 0.66, h * 0.86, h / 300)}</g>`);
		} else {
			ridge(horizon + h * 0.02, h * 0.1, T.hill[0]);
			ridge(horizon + h * 0.13, h * 0.09, T.hill[1]);
			const y = ridge(h * 0.93, h * 0.08, T.hill[2]);
			const sc = h / 400;
			if (kind === 'figures') {
				const fx = w * r.range(0.36, 0.56);
				parts.push(`<g fill="${T.hill[2]}">${person(fx, y(fx) + 3, sc)}${person(fx + 30 * sc, y(fx + 30 * sc) + 3, sc * 0.72, -1)}</g>`);
			} else if (kind === 'figure') {
				const fx = w * r.range(0.3, 0.7);
				parts.push(`<g fill="${T.hill[2]}">${person(fx, y(fx) + 3, sc * 1.1)}</g>`);
			} else if (kind === 'campfire') {
				const fx = w * 0.5;
				const fy = y(fx) + 2;
				parts.push(`<circle cx="${fx}" cy="${fy - 14 * sc}" r="${130 * sc}" fill="url(#${id}g)"/>`);
				parts.push(`<path d="M${fx} ${fy - 62 * sc}c${14 * sc} ${20 * sc} ${22 * sc} ${30 * sc} ${14 * sc} ${52 * sc}h${-28 * sc}c${-10 * sc} ${-20 * sc} ${4 * sc} ${-30 * sc} ${14 * sc} ${-52 * sc}z" fill="#ffb347"/><path d="M${fx} ${fy - 38 * sc}c${7 * sc} ${10 * sc} ${10 * sc} ${16 * sc} ${6 * sc} ${28 * sc}h${-12 * sc}c${-5 * sc} ${-11 * sc} ${1 * sc} ${-18 * sc} ${6 * sc} ${-28 * sc}z" fill="#fff1c0"/>`);
				parts.push(`<g fill="${T.hill[2]}"><rect x="${fx - 26 * sc}" y="${fy - 12 * sc}" width="${52 * sc}" height="${7 * sc}" rx="3" transform="rotate(12 ${fx} ${fy})"/><rect x="${fx - 26 * sc}" y="${fy - 12 * sc}" width="${52 * sc}" height="${7 * sc}" rx="3" transform="rotate(-12 ${fx} ${fy})"/>${seated(fx - 78 * sc, fy + 2, sc)}${seated(fx + 84 * sc, fy + 2, sc * 0.8, -1)}</g>`);
			} else if (kind === 'tree' || r() < 0.5) {
				const tx = w * r.range(0.25, 0.75);
				const ty = y(tx) + 4;
				parts.push(`<g fill="${T.hill[2]}"><rect x="${tx - 3 * sc}" y="${ty - 70 * sc}" width="${6 * sc}" height="${72 * sc}"/><circle cx="${tx}" cy="${ty - 86 * sc}" r="${30 * sc}"/><circle cx="${tx - 22 * sc}" cy="${ty - 70 * sc}" r="${20 * sc}"/><circle cx="${tx + 24 * sc}" cy="${ty - 72 * sc}" r="${22 * sc}"/></g>`);
			}
		}
		parts.push(`<rect width="${w}" height="${h}" filter="url(#${id}n)"/><rect width="${w}" height="${h}" fill="url(#${id}v)"/>`);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
	};

	/* Resolve a photo for a scene: explicit image file, else a procedural one. */
	art.photoFor = (scene, ctx, i = 0, w = 600, h = 600) => {
		const o = scene.opts || {};
		const img = Array.isArray(o.image) ? o.image[i] : i === 0 ? o.image : null;
		if (img) return img;
		const kinds = o.photos || ctx.look.photos || ['hills', 'figures', 'road', 'city', 'shore', 'campfire', 'figure', 'window'];
		const tones = o.tones || ctx.look.tones || ['dusk', 'night', 'gold'];
		const seed = (scene.seed || 1) * 31 + i * 17;
		return art.photo({ kind: kinds[(seed + i) % kinds.length], tone: tones[(seed >> 2) % tones.length], seed, w, h });
	};

	/* Filler copy for newspapers etc. Original text, deliberately generic. */
	art.filler = (seed, n = 1) => {
		const S = [
			'Witnesses say the evening went on far longer than anyone had planned.',
			'Streetlights came on at the usual hour, though nobody was watching the clock.',
			'Officials declined to comment, citing a general lack of urgency.',
			'A spokesperson confirmed the weather had no objection to the arrangement.',
			'Residents on the east side reported hearing music until well past midnight.',
			'The last bus left on time and largely empty, according to the driver.',
			'Several people described the moment as ordinary, and then changed their minds.',
			'No injuries were reported, apart from a few sunburns and one lost jacket.',
			'Neighbours agreed it was the sort of night that would be talked about for a while.',
			'By morning the square had been swept and the chairs were back in their rows.'
		];
		const r = SV.rng(seed);
		let out = '';
		for (let i = 0; i < n * 5; i++) out += r.pick(S) + ' ';
		return out;
	};
})();

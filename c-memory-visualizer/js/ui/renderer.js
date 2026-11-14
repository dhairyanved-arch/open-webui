/*
 * Canvas render engine.
 *
 * Runs a requestAnimationFrame loop and draws the memory layout with a 2D
 * context. Every drawable is a "sprite" that eases from its current position
 * toward the position the latest layout assigned to it, so frames slide into
 * place when the stack grows or shrinks. Pointer arrows are recomputed from
 * the sprites' in-flight positions on every frame, which keeps them attached
 * to their source and target while everything moves.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { GEOMETRY, hex } = CViz;

  const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const MIN_SCALE = 0.3;
  const MAX_SCALE = 2.5;
  const DRAW_ORDER = ['title', 'empty', 'frame', 'static', 'block', 'row', 'sp'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  const THEME_KEYS = {
    bg: '--cv-bg', grid: '--cv-grid', panel: '--cv-panel', line: '--cv-line',
    ink: '--cv-ink', ink2: '--cv-ink-2', ink3: '--cv-ink-3',
    accent: '--cv-accent', accentSoft: '--cv-accent-soft', onAccent: '--cv-on-accent',
    param: '--cv-param', ptr: '--cv-ptr', heap: '--cv-heap', str: '--cv-str',
    bad: '--cv-bad', hover: '--cv-hover',
    a1: '--cv-arrow-1', a2: '--cv-arrow-2', a3: '--cv-arrow-3',
    a4: '--cv-arrow-4', a5: '--cv-arrow-5', a6: '--cv-arrow-6',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  class Renderer {
    /**
     * @param canvas   the <canvas> element; it is sized to fill its parent
     * @param options  {tooltip: HTMLElement, onCameraChange: fn(auto)}
     */
    constructor(canvas, options) {
      const opts = options || {};
      this.canvas = canvas;
      this.host = canvas.parentElement;
      this.ctx = canvas.getContext('2d');
      this.tooltip = opts.tooltip || null;
      this.onCameraChange = opts.onCameraChange || null;

      this.sprites = new Map();
      this.pointers = [];
      this.arrowStates = new Map();
      this.arrowColors = new Map();
      this.targeted = new Set();
      this.layout = null;
      this.view = null;

      this.cam = { x: 0, y: 0, s: 1 };
      this.camTarget = { x: 0, y: 0, s: 1 };
      this.auto = true;
      this.viewW = 0;
      this.viewH = 0;
      this.dpr = 1;

      this.hoverId = null;
      this.pointersDown = new Map();
      this.dragMoved = false;
      this.dirty = true;
      this.lastTime = 0;
      this.fps = 0;
      this.fpsFrames = 0;
      this.fpsSince = 0;
      this.running = false;

      const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reducedMotion = !!(motion && motion.matches);
      if (motion && motion.addEventListener) {
        motion.addEventListener('change', (e) => {
          this.reducedMotion = e.matches;
        });
      }

      this.theme = {};
      this.hatch = null;
      this.refreshTheme();
      this.bindEvents();
      this.resize();
      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.host);
      }
      this.tick = this.tick.bind(this);
      this.start();
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle
     * ------------------------------------------------------------------ */

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(this.tick);
    }

    stop() {
      this.running = false;
    }

    /** Re-reads the colour tokens from CSS (call after the theme changes). */
    refreshTheme() {
      const style = getComputedStyle(this.canvas);
      for (const key of Object.keys(THEME_KEYS)) {
        this.theme[key] = style.getPropertyValue(THEME_KEYS[key]).trim() || '#888';
      }
      this.palette = [this.theme.a1, this.theme.a2, this.theme.a3, this.theme.a4, this.theme.a5, this.theme.a6];
      const tile = document.createElement('canvas');
      tile.width = tile.height = 6;
      const g = tile.getContext('2d');
      g.strokeStyle = this.theme.ink3;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-1, 7);
      g.lineTo(7, -1);
      g.stroke();
      this.hatch = this.ctx.createPattern(tile, 'repeat');
      this.dirty = true;
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (w === this.viewW && h === this.viewH && dpr === this.dpr) return;
      const modeBefore = this.layoutMode();
      this.viewW = w;
      this.viewH = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      if (this.view && modeBefore !== this.layoutMode()) {
        this.setView(this.view);
      } else {
        this.aimCamera();
      }
      this.snapCamera();
      this.dirty = true;
    }

    layoutMode() {
      return this.viewW < 640 ? 'narrow' : 'wide';
    }

    /* ------------------------------------------------------------------ *
     * Scene updates
     * ------------------------------------------------------------------ */

    /** Shows a new memory state; existing sprites animate to their new places. */
    setView(view) {
      const first = this.sprites.size === 0;
      const layout = CViz.computeLayout(view, this.layoutMode());
      this.view = view;
      this.layout = layout;

      const seen = new Set();
      for (const item of layout.items) {
        seen.add(item.id);
        let s = this.sprites.get(item.id);
        if (!s) {
          s = {
            id: item.id,
            x: item.x,
            y: item.y - (first ? 0 : 10),
            w: item.w,
            h: item.h,
            alpha: first ? 1 : 0,
            flash: 0,
            dead: false,
            item,
          };
          this.sprites.set(item.id, s);
        } else {
          if (item.kind === 'row' && s.item.kind === 'row' && item.cell && s.item.cell) {
            const a = s.item.cell;
            const b = item.cell;
            if (a.value !== b.value || a.live !== b.live || a.preview !== b.preview) s.flash = 1;
          } else if (item.kind === 'frame' && s.item.kind === 'frame' && item.frame.returning && !s.item.frame.returning) {
            s.flash = 1;
          }
          s.dead = false;
        }
        s.item = item;
        s.tx = item.x;
        s.ty = item.y;
        s.tw = item.w;
        s.th = item.h;
        s.talpha = 1;
      }
      for (const s of this.sprites.values()) {
        if (!seen.has(s.id)) {
          s.dead = true;
          s.talpha = 0;
        }
      }

      // Arrow bookkeeping: remember where each arrow ended so a retargeted
      // pointer glides from its old target to the new one.
      this.pointers = view.pointers;
      this.targeted = new Set();
      const live = new Set();
      for (const p of this.pointers) {
        live.add(p.from);
        const key = p.to || p.block || p.status;
        if (p.to) this.targeted.add(p.to);
        let st = this.arrowStates.get(p.from);
        if (!st) {
          st = { key, t: 1, last: null, from: null };
          this.arrowStates.set(p.from, st);
        } else if (st.key !== key) {
          st.key = key;
          st.from = st.last;
          st.t = st.last ? 0 : 1;
        }
        if (!this.arrowColors.has(p.from)) {
          this.arrowColors.set(p.from, this.arrowColors.size % this.palette.length);
        }
      }
      for (const id of Array.from(this.arrowStates.keys())) {
        if (!live.has(id)) this.arrowStates.delete(id);
      }

      this.aimCamera();
      if (first) this.snapCamera();
      this.dirty = true;
    }

    /** Removes everything (used when the program is edited or reset). */
    clear() {
      this.sprites.clear();
      this.arrowStates.clear();
      this.arrowColors.clear();
      this.pointers = [];
      this.targeted = new Set();
      this.view = null;
      this.layout = null;
      this.hoverId = null;
      this.hideTooltip();
      this.dirty = true;
    }

    /* ------------------------------------------------------------------ *
     * Camera
     * ------------------------------------------------------------------ */

    /** In auto mode, frames the content and keeps the executing frame in view. */
    aimCamera() {
      if (!this.auto || !this.layout) return;
      const b = this.layout.bounds;
      const margin = 20;
      const wide = this.layout.wide;
      const fit = (this.viewW - margin * 2) / (b.w - (wide ? GEOMETRY.ARROW_ROOM * 0.45 : GEOMETRY.ARROW_ROOM * 0.3));
      const s = clamp(fit, wide ? 0.5 : 0.62, 1.2);
      const vw = this.viewW / s;
      const vh = this.viewH / s;
      const m = margin / s;

      let x = -m;
      const contentW = wide ? GEOMETRY.COL_W * 2 + GEOMETRY.GAP : GEOMETRY.COL_W;
      if (contentW + 2 * m < vw) x = -(vw - contentW) / 2;

      let y = -m;
      if (b.h + 2 * m > vh) {
        const f = this.layout.focus;
        if (f) {
          const want = f.y + f.h + GEOMETRY.SP_H + 28 - vh;
          y = clamp(want, -m, Math.max(-m, f.y - 46));
          y = clamp(y, -m, b.h + m - vh);
        }
      }
      this.camTarget = { x, y, s };
    }

    snapCamera() {
      if (!this.auto) return;
      this.cam = Object.assign({}, this.camTarget);
    }

    setAuto(auto) {
      if (this.auto === auto) return;
      this.auto = auto;
      if (auto) this.aimCamera();
      if (this.onCameraChange) this.onCameraChange(auto);
      this.dirty = true;
    }

    /** Re-enables automatic framing. */
    fit() {
      this.auto = false;
      this.setAuto(true);
    }

    zoomAt(factor, sx, sy) {
      this.setAuto(false);
      const cx = sx === undefined ? this.viewW / 2 : sx;
      const cy = sy === undefined ? this.viewH / 2 : sy;
      const cam = this.cam;
      const wx = cam.x + cx / cam.s;
      const wy = cam.y + cy / cam.s;
      cam.s = clamp(cam.s * factor, MIN_SCALE, MAX_SCALE);
      cam.x = wx - cx / cam.s;
      cam.y = wy - cy / cam.s;
      this.dirty = true;
    }

    panBy(dx, dy) {
      this.setAuto(false);
      this.cam.x -= dx / this.cam.s;
      this.cam.y -= dy / this.cam.s;
      this.dirty = true;
    }

    screenToWorld(sx, sy) {
      return { x: this.cam.x + sx / this.cam.s, y: this.cam.y + sy / this.cam.s };
    }

    /* ------------------------------------------------------------------ *
     * Input
     * ------------------------------------------------------------------ */

    bindEvents() {
      const el = this.canvas;
      const local = (e) => {
        const r = el.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };

      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.pointersDown.set(e.pointerId, local(e));
        this.dragMoved = false;
        this.hideTooltip();
      });

      el.addEventListener('pointermove', (e) => {
        const pos = local(e);
        const prev = this.pointersDown.get(e.pointerId);
        if (!prev) {
          if (e.pointerType === 'mouse') this.updateHover(pos);
          return;
        }
        if (this.pointersDown.size === 2) {
          // Pinch: scale by the change in finger distance, around the midpoint.
          const other = Array.from(this.pointersDown.entries()).find(([id]) => id !== e.pointerId)[1];
          const before = Math.hypot(prev.x - other.x, prev.y - other.y);
          const after = Math.hypot(pos.x - other.x, pos.y - other.y);
          if (before > 0 && after > 0) this.zoomAt(after / before, (pos.x + other.x) / 2, (pos.y + other.y) / 2);
        } else {
          const dx = pos.x - prev.x;
          const dy = pos.y - prev.y;
          if (this.dragMoved || Math.abs(dx) + Math.abs(dy) > 2) {
            this.dragMoved = true;
            this.panBy(dx, dy);
            el.classList.add('is-dragging');
          } else {
            return;
          }
        }
        this.pointersDown.set(e.pointerId, pos);
      });

      const release = (e) => {
        const wasDown = this.pointersDown.delete(e.pointerId);
        el.classList.remove('is-dragging');
        // A tap (no drag) on touch devices shows the tooltip for the row under the finger.
        if (wasDown && !this.dragMoved && e.type === 'pointerup') this.updateHover(local(e));
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', (e) => {
        if (!this.pointersDown.has(e.pointerId)) {
          this.hoverId = null;
          this.hideTooltip();
          this.dirty = true;
        }
      });

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const pos = local(e);
        if (e.ctrlKey || e.metaKey) {
          this.zoomAt(Math.exp(-e.deltaY * 0.01), pos.x, pos.y);
        } else {
          const unit = e.deltaMode === 1 ? 20 : 1;
          this.panBy(-e.deltaX * unit, -e.deltaY * unit);
        }
        this.updateHover(pos);
      }, { passive: false });

      el.addEventListener('dblclick', () => this.fit());
    }

    updateHover(pos) {
      const w = this.screenToWorld(pos.x, pos.y);
      let hit = null;
      for (const s of this.sprites.values()) {
        if (s.dead || s.item.kind !== 'row' || !s.item.cell) continue;
        if (w.x >= s.x && w.x <= s.x + s.w && w.y >= s.y && w.y <= s.y + s.h) {
          hit = s;
          break;
        }
      }
      const id = hit ? hit.id : null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.dirty = true;
      }
      if (hit) this.showTooltip(hit.item.cell, pos);
      else this.hideTooltip();
    }

    describeTarget(cell) {
      const p = this.pointers.find((q) => q.from === cell.id);
      if (!p) return null;
      switch (p.status) {
        case 'ok':
        case 'scope': {
          const target = p.to ? this.sprites.get(p.to) : null;
          const name = target && target.item.cell ? target.item.cell.path : 'a heap block';
          return { text: name + (p.status === 'scope' ? ' (not in scope right now)' : ''), bad: false };
        }
        case 'end': {
          const target = this.sprites.get(p.to);
          const name = target && target.item.cell ? target.item.cell.path : 'an array';
          return { text: `one past ${name} — valid to hold, invalid to dereference`, bad: false };
        }
        case 'freed':
          return { text: 'a freed heap block — dangling pointer', bad: true };
        case 'dead-stack':
          return { text: 'the frame of a function that already returned — dangling pointer', bad: true };
        default:
          return { text: 'unmapped memory — dereferencing would crash', bad: true };
      }
    }

    showTooltip(cell, pos) {
      const tip = this.tooltip;
      if (!tip) return;
      const rows = [];
      const add = (k, v, cls) => rows.push(
        `<div class="tip-row"><span>${escapeHtml(k)}</span><b${cls ? ` class="${cls}"` : ''}>${escapeHtml(v)}</b></div>`
      );
      add('address', hex(cell.addr));
      add('size', `${cell.size} byte${cell.size === 1 ? '' : 's'}`);
      if (cell.kind === 'scalar') {
        if (!cell.live) add('state', 'not declared yet, or out of scope');
        else if (!cell.init) add('value', 'indeterminate (never assigned)', 'tip-warn');
        else add('value', cell.note && cell.role !== 'ret' && cell.role !== 'fp' ? `${cell.value}  (${cell.note})` : cell.value);
        if (cell.bytes && cell.bytes.length <= 8) {
          add('bytes', cell.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ') + '  (little-endian)');
        }
        if (cell.isPointer && cell.init && cell.raw !== 0) {
          const t = this.describeTarget(cell);
          if (t) add('points to', t.text, t.bad ? 'tip-bad' : '');
        }
        if (cell.role === 'ret') add('meaning', `execution resumes at ${cell.note.replace('→ ', '')}`);
        if (cell.role === 'fp') add('meaning', "the caller's frame pointer, restored on return");
      } else if (cell.preview) {
        add('as string', cell.preview);
      }
      const title = cell.role === 'ret' || cell.role === 'fp' ? cell.path : `${cell.decl}`;
      tip.innerHTML = `<div class="tip-title">${escapeHtml(title)}</div>` +
        `<div class="tip-path">${escapeHtml(cell.path || '')}</div>` + rows.join('');
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let x = pos.x + 16;
      let y = pos.y + 16;
      if (x + tw > this.viewW - 8) x = Math.max(8, pos.x - tw - 12);
      if (y + th > this.viewH - 8) y = Math.max(8, pos.y - th - 12);
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    hideTooltip() {
      if (this.tooltip) this.tooltip.hidden = true;
    }

    /* ------------------------------------------------------------------ *
     * Frame loop
     * ------------------------------------------------------------------ */

    tick(time) {
      if (!this.running) return;
      const dt = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0.016;
      this.lastTime = time;

      this.fpsFrames++;
      if (!this.fpsSince) this.fpsSince = time;
      if (time - this.fpsSince >= 500) {
        this.fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsSince));
        this.fpsFrames = 0;
        this.fpsSince = time;
      }

      const moving = this.update(dt);
      if (moving || this.dirty) {
        this.dirty = false;
        this.draw();
      }
      requestAnimationFrame(this.tick);
    }

    /** Advances every animation by dt seconds. Returns true while anything is still moving. */
    update(dt) {
      const instant = this.reducedMotion;
      const k = instant ? 1 : 1 - Math.exp(-dt * 15);
      const ka = instant ? 1 : 1 - Math.exp(-dt * 13);
      let moving = false;

      const ease = (s, prop, target) => {
        const d = target - s[prop];
        if (Math.abs(d) < 0.08) {
          s[prop] = target;
          return;
        }
        s[prop] += d * k;
        moving = true;
      };

      for (const s of this.sprites.values()) {
        if (!s.dead) {
          ease(s, 'x', s.tx);
          ease(s, 'y', s.ty);
          ease(s, 'w', s.tw);
          ease(s, 'h', s.th);
        }
        const da = s.talpha - s.alpha;
        if (Math.abs(da) < 0.01) {
          s.alpha = s.talpha;
        } else {
          s.alpha += da * ka;
          moving = true;
        }
        if (s.flash > 0) {
          s.flash = instant ? 0 : Math.max(0, s.flash - dt / 0.9);
          moving = true;
        }
        if (s.dead && s.alpha <= 0.01) this.sprites.delete(s.id);
      }

      for (const st of this.arrowStates.values()) {
        if (st.t < 1) {
          st.t = instant ? 1 : Math.min(1, st.t + dt / 0.3);
          moving = true;
        }
      }

      if (this.auto) {
        const kc = instant ? 1 : 1 - Math.exp(-dt * 9);
        const cam = this.cam;
        const target = this.camTarget;
        for (const prop of ['x', 'y', 's']) {
          const d = target[prop] - cam[prop];
          const eps = prop === 's' ? 0.0008 : 0.1;
          if (Math.abs(d) < eps) {
            cam[prop] = target[prop];
          } else {
            cam[prop] += d * kc;
            moving = true;
          }
        }
      }
      return moving;
    }

    /* ------------------------------------------------------------------ *
     * Drawing
     * ------------------------------------------------------------------ */

    draw() {
      const ctx = this.ctx;
      const t = this.theme;
      const cam = this.cam;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      this.drawGrid();

      ctx.save();
      ctx.scale(cam.s, cam.s);
      ctx.translate(-cam.x, -cam.y);
      ctx.textBaseline = 'middle';

      const minY = cam.y - 40;
      const maxY = cam.y + this.viewH / cam.s + 40;
      const buckets = {};
      for (const kind of DRAW_ORDER) buckets[kind] = [];
      for (const s of this.sprites.values()) {
        if (s.y + s.h < minY || s.y > maxY) continue;
        buckets[s.item.kind].push(s);
      }
      for (const s of buckets.title) this.drawTitle(s);
      for (const s of buckets.empty) this.drawEmpty(s);
      for (const s of buckets.frame) this.drawFrame(s);
      for (const s of buckets.static) this.drawStatic(s);
      for (const s of buckets.block) this.drawBlock(s);
      for (const s of buckets.row) this.drawRow(s);
      for (const s of buckets.sp) this.drawStackPointer(s);
      ctx.globalAlpha = 1;
      this.drawArrows();
      ctx.restore();
    }

    drawGrid() {
      const ctx = this.ctx;
      const cam = this.cam;
      const step = 24 * cam.s;
      if (step < 9) return;
      const ox = (-cam.x * cam.s) % step;
      const oy = (-cam.y * cam.s) % step;
      const r = Math.max(0.7, cam.s * 0.9);
      ctx.fillStyle = this.theme.grid;
      ctx.beginPath();
      for (let x = ox - step; x < this.viewW + step; x += step) {
        for (let y = oy - step; y < this.viewH + step; y += step) {
          ctx.rect(x - r / 2, y - r / 2, r, r);
        }
      }
      ctx.fill();
    }

    roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      ctx.lineTo(x + rr, y + h);
      ctx.arcTo(x, y + h, x, y + h - rr, rr);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.closePath();
    }

    /** Shortens text with an ellipsis until it fits maxWidth (uses the current font). */
    fitText(text, maxWidth) {
      const ctx = this.ctx;
      if (maxWidth <= 0) return '';
      if (ctx.measureText(text).width <= maxWidth) return text;
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      return lo > 0 ? text.slice(0, lo) + '…' : '';
    }

    pill(text, rightX, midY, bg, fg) {
      const ctx = this.ctx;
      ctx.font = `600 10.5px ${SANS}`;
      const w = ctx.measureText(text).width + 14;
      ctx.fillStyle = bg;
      this.roundRect(rightX - w, midY - 8.5, w, 17, 8.5);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.fillText(text, rightX - w / 2, midY + 0.5);
      ctx.textAlign = 'left';
      return w;
    }

    drawTitle(s) {
      const ctx = this.ctx;
      const t = this.theme;
      const it = s.item;
      ctx.globalAlpha = s.alpha;
      ctx.textAlign = 'left';
      ctx.font = `700 11px ${SANS}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
      ctx.fillStyle = t.ink;
      ctx.fillText(it.text.toUpperCase(), s.x + 2, s.y + 13);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.font = `11px ${SANS}`;
      ctx.fillStyle = t.ink3;
      ctx.fillText(it.sub, s.x + 2, s.y + 29);
    }

    drawEmpty(s) {
      const ctx = this.ctx;
      const t = this.theme;
      ctx.globalAlpha = s.alpha;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = t.line;
      this.roundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 9);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `11.5px ${SANS}`;
      ctx.fillStyle = t.ink3;
      ctx.textAlign = 'center';
      ctx.fillText(this.fitText(s.item.text, s.w - 20), s.x + s.w / 2, s.y + s.h / 2);
      ctx.textAlign = 'left';
    }

    drawFrame(s) {
      const ctx = this.ctx;
      const t = this.theme;
      const f = s.item.frame;
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = t.panel;
      this.roundRect(s.x, s.y, s.w, s.h, 9);
      ctx.fill();
      if (s.flash > 0) {
        ctx.globalAlpha = s.alpha * Math.min(1, s.flash) * 0.6;
        ctx.fillStyle = t.accentSoft;
        ctx.fill();
        ctx.globalAlpha = s.alpha;
      }
      ctx.lineWidth = f.active ? 1.6 : 1;
      ctx.strokeStyle = f.active ? t.accent : t.line;
      this.roundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 9);
      ctx.stroke();

      const mid = s.y + GEOMETRY.HEAD_H / 2 + 1;
      let right = s.x + s.w - 10;
      if (f.returning) {
        const text = f.retVal !== null ? `returns ${f.retVal}` : 'returning';
        right -= this.pill(text, right, mid, t.accent, t.onAccent) + 8;
      }
      ctx.font = `10.5px ${SANS}`;
      ctx.fillStyle = t.ink3;
      ctx.textAlign = 'right';
      const meta = `frame ${f.depth} · ${f.size} B`;
      ctx.fillText(meta, right, mid);
      right -= ctx.measureText(meta).width + 10;
      ctx.textAlign = 'left';
      ctx.font = `600 13px ${MONO}`;
      ctx.fillStyle = f.active ? t.accent : t.ink;
      ctx.fillText(this.fitText(f.name + '()', right - (s.x + 12)), s.x + 12, mid);
    }

    drawStatic(s) {
      const ctx = this.ctx;
      const t = this.theme;
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = t.panel;
      this.roundRect(s.x, s.y, s.w, s.h, 9);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = t.line;
      this.roundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 9);
      ctx.stroke();
    }

    drawBlock(s) {
      const ctx = this.ctx;
      const t = this.theme;
      const b = s.item.block;
      const used = b.state === 'used';
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = t.panel;
      this.roundRect(s.x, s.y, s.w, s.h, 9);
      ctx.fill();
      if (!used) {
        ctx.fillStyle = this.hatch;
        ctx.fill();
      }
      ctx.lineWidth = b.leaked ? 1.6 : 1.1;
      ctx.strokeStyle = b.leaked ? t.bad : used ? t.heap : t.ink3;
      if (!used) ctx.setLineDash([5, 4]);
      this.roundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 9);
      ctx.stroke();
      ctx.setLineDash([]);

      const mid = s.y + GEOMETRY.HEAD_H / 2 + 1;
      let right = s.x + s.w - 10;
      if (b.leaked) right -= this.pill('never freed', right, mid, t.bad, t.onAccent) + 8;
      ctx.font = `10.5px ${SANS}`;
      ctx.fillStyle = t.ink3;
      ctx.textAlign = 'right';
      const meta = used ? `${b.size} B` : `${b.size} B free`;
      ctx.fillText(meta, right, mid);
      right -= ctx.measureText(meta).width + 10;
      ctx.textAlign = 'left';

      ctx.font = `600 12px ${MONO}`;
      ctx.fillStyle = used ? t.heap : t.ink3;
      const addr = hex(b.addr);
      ctx.fillText(addr, s.x + 12, mid);
      let x = s.x + 12 + ctx.measureText(addr).width + 9;
      if (used) {
        ctx.font = `11px ${MONO}`;
        ctx.fillStyle = t.ink2;
        const type = this.fitText(b.typeStr || 'untyped', right - x);
        ctx.fillText(type, x, mid);
        x += ctx.measureText(type).width + 8;
        if (b.preview && right - x > 30) {
          ctx.fillStyle = t.str;
          ctx.fillText(this.fitText(b.preview, right - x), x, mid);
        }
      } else {
        ctx.font = `11px ${SANS}`;
        ctx.fillStyle = t.ink3;
        ctx.fillText(this.fitText('freed · available for reuse', right - x), x, mid);
      }
    }

    drawRow(s) {
      const ctx = this.ctx;
      const t = this.theme;
      const it = s.item;
      const x = s.x;
      const y = s.y;
      const w = s.w;
      const h = s.h;
      const mid = y + h / 2 + 0.5;
      ctx.globalAlpha = s.alpha;
      ctx.textAlign = 'left';

      // Hairline between rows.
      ctx.fillStyle = t.line;
      ctx.globalAlpha = s.alpha * 0.7;
      ctx.fillRect(x, y, w, 1);
      ctx.globalAlpha = s.alpha;

      if (it.rowType === 'more') {
        ctx.font = `italic 11px ${SANS}`;
        ctx.fillStyle = t.ink3;
        ctx.fillText(it.text, x + 64, mid);
        return;
      }

      const c = it.cell;
      const hovered = this.hoverId === s.id;
      if (s.flash > 0) {
        ctx.globalAlpha = s.alpha * Math.min(1, s.flash * 1.3);
        ctx.fillStyle = t.accentSoft;
        this.roundRect(x, y + 1, w, h - 1, 4);
        ctx.fill();
        ctx.globalAlpha = s.alpha;
      }
      if (hovered) {
        ctx.fillStyle = t.hover;
        this.roundRect(x, y + 1, w, h - 1, 4);
        ctx.fill();
      }
      if (this.targeted.has(s.id)) {
        ctx.strokeStyle = t.ptr;
        ctx.globalAlpha = s.alpha * 0.55;
        ctx.lineWidth = 1;
        this.roundRect(x + 0.5, y + 1.5, w - 1, h - 2, 4);
        ctx.stroke();
        ctx.globalAlpha = s.alpha;
      }

      const dim = c.live ? 1 : 0.38;
      ctx.globalAlpha = s.alpha * dim;

      // Address column.
      ctx.font = `10.5px ${MONO}`;
      ctx.fillStyle = t.ink3;
      ctx.fillText(hex(c.addr).slice(2), x + 6, mid);
      const labelX = x + 64;

      if (it.rowType === 'meta') {
        ctx.font = `11px ${SANS}`;
        ctx.fillStyle = t.ink3;
        ctx.fillText(c.label, labelX, mid);
        const labelEnd = labelX + ctx.measureText(c.label).width + 8;
        ctx.textAlign = 'right';
        ctx.font = `11px ${MONO}`;
        ctx.fillStyle = t.ink2;
        ctx.fillText(c.value, x + w - 8, mid);
        const valueLeft = x + w - 8 - ctx.measureText(c.value).width - 8;
        ctx.font = `10.5px ${SANS}`;
        ctx.fillStyle = t.ink3;
        const note = this.fitText(c.note || '', valueLeft - labelEnd);
        ctx.fillText(note, valueLeft, mid);
        ctx.textAlign = 'left';
        return;
      }

      // Value, right-aligned. Pointers leave room for the arrow's anchor dot.
      let valueLeft = x + w - 8;
      if (it.rowType === 'scalar') {
        const right = x + w - (c.isPointer ? 19 : 8);
        let text = c.live ? c.value : '—';
        let color = t.ink;
        let font = `600 12.5px ${MONO}`;
        if (!c.live) {
          color = t.ink3;
        } else if (!c.init) {
          color = t.ink2;
        } else if (c.isPointer) {
          color = c.raw === 0 ? t.ink3 : t.ptr;
          font = `500 12px ${MONO}`;
        } else if (c.type.kind === 'int' && c.type.size === 1 && !c.type.isBool) {
          color = t.str;
        }
        ctx.font = font;
        text = this.fitText(text, w - 64 - 60);
        const tw = ctx.measureText(text).width;
        if (c.live && !c.init) {
          // Indeterminate value: a hatched chip, so "never assigned" is visible at a glance.
          const cw = Math.max(22, tw + 12);
          this.roundRect(right - cw, mid - 8, cw, 16, 4);
          ctx.fillStyle = this.hatch;
          ctx.fill();
          ctx.strokeStyle = t.ink3;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(text, right - cw / 2, mid);
          ctx.textAlign = 'left';
          valueLeft = right - cw - 8;
        } else {
          ctx.textAlign = 'right';
          ctx.fillStyle = color;
          ctx.fillText(text, right, mid);
          valueLeft = right - tw - 8;
          if (c.note && c.live && c.init && c.type.kind === 'int' && c.type.size === 1) {
            ctx.font = `10.5px ${MONO}`;
            ctx.fillStyle = t.ink3;
            ctx.fillText(c.note, valueLeft, mid);
            valueLeft -= ctx.measureText(c.note).width + 8;
          }
          ctx.textAlign = 'left';
        }
      } else {
        ctx.font = `10.5px ${SANS}`;
        ctx.fillStyle = t.ink3;
        ctx.textAlign = 'right';
        const sizeText = `${c.size} B`;
        ctx.fillText(sizeText, x + w - 8, mid);
        valueLeft = x + w - 8 - ctx.measureText(sizeText).width - 8;
        ctx.textAlign = 'left';
      }

      // Name, then type, then (for char arrays) the string they spell.
      const nested = it.depth > 0 || c.role === 'heap';
      ctx.font = `${nested ? 500 : 600} 12px ${MONO}`;
      ctx.fillStyle = c.role === 'param' ? t.param : nested ? t.ink2 : t.ink;
      const label = this.fitText(c.label, valueLeft - labelX);
      ctx.fillText(label, labelX, mid);
      let tx = labelX + ctx.measureText(label).width + 8;
      if (valueLeft - tx > 24) {
        ctx.font = `11px ${MONO}`;
        ctx.fillStyle = t.ink3;
        const typeText = this.fitText(c.typeStr, valueLeft - tx);
        ctx.fillText(typeText, tx, mid);
        tx += ctx.measureText(typeText).width + 8;
        if (c.preview && valueLeft - tx > 30) {
          ctx.fillStyle = t.str;
          ctx.fillText(this.fitText(c.preview, valueLeft - tx), tx, mid);
        }
      }
    }

    drawStackPointer(s) {
      const ctx = this.ctx;
      const t = this.theme;
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + 3.5);
      ctx.lineTo(s.x + s.w, s.y + 3.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `10.5px ${MONO}`;
      ctx.fillStyle = t.accent;
      ctx.textAlign = 'left';
      ctx.fillText(`sp = ${hex(s.item.addr)}`, s.x + 6, s.y + 13);
      ctx.textAlign = 'right';
      ctx.font = `10.5px ${SANS}`;
      ctx.fillText('top of stack', s.x + s.w - 6, s.y + 13);
      ctx.textAlign = 'left';
    }

    /* ------------------------------ arrows ------------------------------ */

    drawArrows() {
      const ctx = this.ctx;
      const t = this.theme;
      const G = GEOMETRY;
      const wide = this.layout ? this.layout.wide : true;

      // First pass: pair each pointer with its sprites and count arrows per target
      // so several arrows into one row fan out instead of overlapping.
      const list = [];
      const incoming = new Map();
      for (const p of this.pointers) {
        const src = this.sprites.get(p.from);
        if (!src || src.dead || src.alpha < 0.05) continue;
        const dst = this.sprites.get(p.to || p.block) || null;
        const entry = { p, src, dst, slot: 0 };
        if (dst) {
          entry.slot = incoming.get(dst.id) || 0;
          incoming.set(dst.id, entry.slot + 1);
        } else if (p.status === 'ok' || p.status === 'end' || p.status === 'freed' || p.status === 'scope') {
          continue;
        }
        list.push(entry);
      }

      const hover = this.hoverId;
      const anyHover = hover !== null && list.some((a) => a.p.from === hover || (a.dst && a.dst.id === hover));

      for (const a of list) {
        const { p, src, dst } = a;
        const st = this.arrowStates.get(p.from);
        const bad = p.status === 'freed' || p.status === 'dead-stack' || p.status === 'wild';
        const color = bad ? t.bad : this.palette[this.arrowColors.get(p.from) || 0];
        const emphasised = anyHover && (p.from === hover || (dst && dst.id === hover));
        const alpha = Math.min(src.alpha, dst ? Math.max(dst.alpha, 0.25) : 1) * (anyHover && !emphasised ? 0.22 : 1);
        const sy = src.y + src.h / 2 + 0.5;
        const srcRight = src.x + src.w - 9;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = emphasised ? 2.6 : 1.7;
        ctx.lineCap = 'round';

        if (!dst) {
          // Dangling or wild pointer: a short stub that ends in a cross.
          const ex = srcRight + 40;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(srcRight, sy);
          ctx.lineTo(ex, sy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(ex - 4, sy - 4);
          ctx.lineTo(ex + 4, sy + 4);
          ctx.moveTo(ex + 4, sy - 4);
          ctx.lineTo(ex - 4, sy + 4);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(srcRight, sy, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = `600 10px ${SANS}`;
          ctx.textAlign = 'left';
          ctx.fillText(p.status === 'dead-stack' ? 'dangling' : 'invalid', ex + 8, sy);
          if (st) st.last = { x: ex, y: sy };
          continue;
        }

        // Where the arrow should end.
        const sameColumn = !wide || src.item.column === dst.item.column;
        const leftToRight = !sameColumn && src.item.column === 0;
        let ty = dst.item.kind === 'row' ? dst.y + dst.h / 2 + 0.5 : dst.y + G.HEAD_H / 2 + 1;
        if (p.status === 'end') ty = dst.y + dst.h;
        const n = incoming.get(dst.id) || 1;
        if (n > 1 && p.status !== 'end') {
          const spread = Math.min(6, (Math.min(dst.h, G.ROW_H) - 8) / (n - 1));
          ty += (a.slot - (n - 1) / 2) * spread;
        }
        let ex = sameColumn || !leftToRight ? dst.x + dst.w + 4 : dst.x - 4;
        let sx = sameColumn || leftToRight ? srcRight : src.x + 4;

        // Glide from the previous target when the pointer was just reassigned.
        let ey = ty;
        if (st && st.t < 1 && st.from) {
          const e = easeOut(st.t);
          ex = st.from.x + (ex - st.from.x) * e;
          ey = st.from.y + (ty - st.from.y) * e;
        }
        if (st) st.last = { x: ex, y: ey };

        let c1x;
        let c2x;
        if (sameColumn) {
          const reach = clamp(24 + Math.abs(ey - sy) * 0.2, 28, G.ARROW_ROOM - 14);
          const out = Math.max(sx, ex) + reach;
          c1x = out;
          c2x = out;
        } else {
          const dx = Math.max(64, Math.abs(ex - sx));
          const dir = leftToRight ? 1 : -1;
          c1x = sx + dir * dx * 0.5;
          c2x = ex - dir * dx * 0.5;
        }

        if (p.status !== 'ok') ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(c1x, sy, c2x, ey, ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrowhead along the curve's final tangent. The second control point shares
        // the end point's y, so the curve always arrives horizontally.
        const ang = ex >= c2x ? 0 : Math.PI;
        const size = emphasised ? 9 : 7.5;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - size * Math.cos(ang - 0.42), ey - size * Math.sin(ang - 0.42));
        ctx.lineTo(ex - size * Math.cos(ang + 0.42), ey - size * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();

        // Anchor dot on the pointer variable.
        ctx.beginPath();
        ctx.arc(sx, sy, emphasised ? 3.6 : 3, 0, Math.PI * 2);
        ctx.fill();

        if (p.status === 'freed') {
          ctx.font = `600 10px ${SANS}`;
          ctx.textAlign = leftToRight ? 'right' : 'left';
          ctx.fillText('dangling', leftToRight ? ex - 12 : ex + 12, ey - 9);
          ctx.textAlign = 'left';
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  CViz.Renderer = Renderer;
});

// ===================================================================
// NIGHTBURN RACING — core: helpers, data tables, save data, input
// ===================================================================
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const dampAng = (a, b, k, dt) => a + angDiff(b, a) * (1 - Math.exp(-k * dt));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o) { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; }
const col = hex => new THREE.Color(hex).convertSRGBToLinear();
const fmtTime = t => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const ordinal = n => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
const fmtNum = n => Math.round(n).toLocaleString('en-US');

// ---------------- data ----------------
const CARS = [
  { id: 'vesper',  name: 'Vesper GT',   cls: 'Street', price: 0,     top: 76, acc: 15, grip: 1.00, boost: 1.00, paint: 0, L: 1.00, W: 1.00, H: 1.00, wing: 1 },
  { id: 'kaido',   name: 'Kaido RS',    cls: 'Sport',  price: 9000,  top: 82, acc: 17, grip: 1.07, boost: 1.06, paint: 1, L: 0.96, W: 1.02, H: 0.97, wing: 2 },
  { id: 'tempest', name: 'Tempest X',   cls: 'Super',  price: 24000, top: 88, acc: 19, grip: 1.13, boost: 1.12, paint: 2, L: 1.04, W: 1.04, H: 0.93, wing: 2 },
  { id: 'solace',  name: 'Solace Zero', cls: 'Hyper',  price: 52000, top: 95, acc: 22, grip: 1.20, boost: 1.20, paint: 3, L: 1.07, W: 1.06, H: 0.88, wing: 3 },
];
const PAINTS = [0xf01848, 0x10b4f0, 0xffa800, 0x7a35ff, 0xeef0f4, 0x12c46e, 0x15171c];
const RIVALS = ['Rook', 'Mirage', 'Juno', 'Vex', 'Halcyon', 'Onyx', 'Sable'];

const TRACKS = [
  { id: 'harbor', name: 'Neon Harbor', tag: 'Night city', theme: 'city', laps: 3, seed: 7, pay: 1.0, diff: 0, rev: false,
    R: 400, sx: 1.28, sz: 0.86, h2: .10, p2: .6, h3: .07, p3: 2.1, h5: .06, p5: 1.0, h7: .03, p7: .3, H: 8, q2: 1.0, q3: 2.5, q5: .3 },
  { id: 'coast', name: 'Solar Coast', tag: 'Sunset shoreline', theme: 'coast', laps: 3, seed: 21, pay: 1.3, diff: .02, rev: true,
    R: 430, sx: 0.9, sz: 1.3, h2: .12, p2: 2.2, h3: .08, p3: .4, h5: .07, p5: 3.8, h7: .045, p7: .5, H: 15, q2: .2, q3: 1.3, q5: 2.2 },
  { id: 'aurora', name: 'Aurora Pass', tag: 'Mountain night', theme: 'snow', laps: 3, seed: 33, pay: 1.6, diff: .04, rev: false,
    R: 440, sx: 1.1, sz: 1.0, h2: .09, p2: 4.0, h3: .10, p3: 5.2, h5: .10, p5: 2.6, h7: .055, p7: 3.3, H: 22, q2: 3.1, q3: .7, q5: 4.0 },
];

// ---------------- save data ----------------
const SAVE_KEY = 'nightburn.save.v1';
const save = { credits: 0, owned: ['vesper'], car: 0, paints: {}, track: 0, best: {}, music: 'on', sfx: 'on', steer: 'buttons', quality: 'auto', orient: '' };
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') Object.assign(save, s); } catch (e) { /* storage unavailable */ }
  // phones default to landscape mode: an upright screen is turned sideways for the wider view
  if (save.orient !== 'landscape' && save.orient !== 'device') { let touch = false; try { touch = matchMedia('(pointer: coarse)').matches; } catch (e) {} save.orient = touch ? 'landscape' : 'device'; } }
function storeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }
const paintOf = i => (save.paints[CARS[i].id] !== undefined ? save.paints[CARS[i].id] : CARS[i].paint);

// ---------------- input ----------------
const input = { left: 0, right: 0, brake: 0, nitroTap: 0, analog: 0, kbL: 0, kbR: 0, kbB: 0 };
function bindHold(el, on, off) {
  const down = e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); on(); };
  const up = e => { e.preventDefault(); el.classList.remove('on'); off && off(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function initInput() {
  bindHold($('tLeft'), () => input.left = 1, () => input.left = 0);
  bindHold($('tRight'), () => input.right = 1, () => input.right = 0);
  bindHold($('tDrift'), () => input.brake = 1, () => input.brake = 0);
  bindHold($('tNitro'), () => input.nitroTap = 1, null);
  // slide steering: drag horizontally anywhere on the left half
  const zone = $('steerZone'), knob = $('slideKnob'); let sid = null, sx = 0;
  const setA = v => { input.analog = v; knob.style.transform = 'translateX(' + (v * 46) + 'px)'; }, along = e => gfx.rot ? e.clientY : e.clientX;
  zone.addEventListener('pointerdown', e => { e.preventDefault(); sid = e.pointerId; sx = along(e); try { zone.setPointerCapture(sid); } catch (_) {} });
  zone.addEventListener('pointermove', e => { if (e.pointerId === sid) setA(clamp((along(e) - sx) / 58, -1, 1)); });
  const end = e => { if (e.pointerId === sid) { sid = null; setA(0); } };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.kbL = 1;
    else if (k === 'arrowright' || k === 'd') input.kbR = 1;
    else if (k === 'shift' || k === 'arrowdown' || k === 's') input.kbB = 1;
    else if (k === ' ' || k === 'arrowup' || k === 'w') { input.nitroTap = 1; e.preventDefault(); }
    else if (k === 'escape' || k === 'p') togglePause();
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') input.kbL = 0;
    else if (k === 'arrowright' || k === 'd') input.kbR = 0;
    else if (k === 'shift' || k === 'arrowdown' || k === 's') input.kbB = 0;
  });
  // stop the page from scrolling / zooming under the game
  document.addEventListener('touchmove', e => { if (!e.target.closest('.overlay')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

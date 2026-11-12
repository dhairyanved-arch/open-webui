// ===================================================================
// showroom, menus, boot, main loop
// ===================================================================
function buildShow() {
  const s = new THREE.Scene(); show = { scene: s, cam: new THREE.PerspectiveCamera(38, 1, .3, 900), car: null, fx: null, t: 0, carIdx: -1, paint: -1, turn: .7 };
  s.fog = new THREE.Fog(col(0x1c0d34), 20, 85);
  show.env = makeEnv(THEMES.studio, [[0, 15, 0, 18, .5, 6, 0xffffff, 5], [11, 6, -5, .6, 11, 11, 0xff2e7e, 6], [-11, 6, -5, .6, 11, 11, 0x19e3ff, 6], [0, 4, 15, 16, 2.5, .5, 0xffffff, 3], [0, 6, -16, 22, 1, .5, 0xffb400, 2.5]]);
  s.environment = show.env.texture; show.sky = makeSky(THEMES.studio, 500); s.add(show.sky);
  s.add(new THREE.HemisphereLight(col(0x9a8ae8), col(0x150c24), .75)); const d = new THREE.DirectionalLight(0xffffff, .9); d.position.set(4, 10, 6); s.add(d);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col(0x07050e), roughness: .34, metalness: .5, envMapIntensity: .6 })); s.add(floor);
  const ring = (r, hex) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, .04, 6, 120).rotateX(Math.PI / 2), glowMat(hex, 2.6)); m.position.y = .03; s.add(m); };
  ring(4.6, 0xff2e7e); ring(6.6, 0x19e3ff);
  const bars = new Batch(UNIT_BOX(), glowMat(0xffffff, 2.4)), m = M4(), q = new THREE.Quaternion(), cs = [col(0xff2e7e), col(0x19e3ff), col(0xffb400)];
  for (let k = 0; k < 19; k++) { const a = Math.PI * (.5 + (k - 9) / 9 * .72), h = 3 + ((k * 7) % 5) * 1.6; m.compose(new THREE.Vector3(Math.cos(a) * 17, h / 2, -Math.sin(a) * 17 + 1), q, new THREE.Vector3(.16, h, .16)); bars.add(m, cs[k % 3]); }
  bars.build(s);
}
function setShowCar(idx, paintIdx) {
  if (show.carIdx === idx && show.paint === paintIdx) return;
  if (show.car) { show.scene.remove(show.car, show.fx); disposeCar(show.car); }
  show.car = buildCar(CARS[idx], PAINTS[paintIdx], true); show.fx = buildGroundFx(PAINTS[paintIdx], false); show.fx.userData.ug.material.opacity = .28;
  show.scene.add(show.car, show.fx); show.carIdx = idx; show.paint = paintIdx; applyGlow();
}
function updateShow(dt) {
  show.t += dt; show.turn += dt * .32; const cam = show.cam, aspect = gfx.w / gfx.h, gar = mode === 'garage';
  show.car.rotation.y = show.turn; show.fx.rotation.y = show.turn; spinWheels(show.car, 0, 0);
  cam.aspect = aspect; const dist = Math.max(8.6, 3.2 / (Math.tan(19 * Math.PI / 180) * aspect));
  const lift = aspect < 1 ? dist * (gar ? .2 : .1) : (gar ? .9 : .5), side = aspect >= 1 && gar ? dist * .13 : 0;
  cam.position.set(Math.sin(show.t * .1) * 1.2 + side, 1.55 + dist * .06, dist); cam.lookAt(side, .62 - lift, 0); cam.updateProjectionMatrix();
  show.sky.position.copy(cam.position);
}

// ---------------- screens ----------------
function setMode(m) {
  mode = m;
  $('home').hidden = m !== 'home'; $('garage').hidden = m !== 'garage';
  $('hud').hidden = m !== 'race'; $('touch').hidden = m !== 'race';
  if (m !== 'race') { $('results').hidden = true; $('menu').hidden = true; }
}
function refreshHome() {
  const t = TRACKS[save.track], b = save.best[t.id];
  $('trkName').textContent = t.name; $('trkMeta').textContent = t.tag + ' · ' + t.laps + ' laps' + (b ? ' · best ' + fmtTime(b.time) : '');
  $('homeCar').textContent = CARS[save.car].name; $('creditsHome').textContent = $('creditsGar').textContent = fmtNum(save.credits);
}
let garIdx = 0;
function refreshGarage() {
  const c = CARS[garIdx], owned = save.owned.includes(c.id), pi = owned ? paintOf(garIdx) : c.paint;
  setShowCar(garIdx, pi);
  $('carName').textContent = c.name; $('carClass').textContent = c.cls + ' class';
  const st = (id, v, lo, hi, txt) => { $(id).style.width = clamp((v - lo) / (hi - lo) * 100, 8, 100) + '%'; $(id + 'V').textContent = txt; };
  st('stTop', c.top, 60, 96, Math.round(c.top * 3.6)); st('stAcc', c.acc, 11, 22.5, (c.acc / 2.2).toFixed(1)); st('stGrip', c.grip, .85, 1.21, Math.round(c.grip * 80)); st('stBoost', c.boost, .85, 1.21, Math.round(c.boost * 80));
  const sw = $('swatches'); sw.innerHTML = '';
  PAINTS.forEach((hex, i) => { const b = document.createElement('button'); b.className = 'swatch'; b.style.background = '#' + hex.toString(16).padStart(6, '0'); b.setAttribute('aria-label', 'Paint ' + (i + 1)); b.setAttribute('aria-pressed', i === pi);
    b.disabled = !owned; b.style.opacity = owned ? 1 : .35; b.onclick = () => { save.paints[c.id] = i; storeSave(); audio.ui(); refreshGarage(); }; sw.appendChild(b); });
  const act = $('carAction'), lab = act.firstElementChild;
  if (!owned) { const can = save.credits >= c.price; lab.textContent = can ? 'Buy · ' + fmtNum(c.price) : 'Need ' + fmtNum(c.price - save.credits) + ' more'; act.disabled = !can; act.className = 'btn hot'; }
  else if (save.car === garIdx) { lab.textContent = 'Selected'; act.disabled = true; act.className = 'btn'; }
  else { lab.textContent = 'Select'; act.disabled = false; act.className = 'btn primary'; }
  refreshHome();
}
function goHome() { endRace(); audio.quiet(); audio.musicMode(false); paused = false; setShowCar(save.car, paintOf(save.car)); refreshHome(); setMode('home'); }
function goRace() {
  audio.init(); audio.ui(); const t = TRACKS[save.track];
  $('loadTag').textContent = t.tag; $('loadName').textContent = t.name; $('loading').hidden = false; $('results').hidden = true; $('menu').hidden = true; paused = false;
  setTimeout(() => {
    try { startRace(); } catch (e) { console.error(e); fatal('Could not build the circuit: ' + e.message); return; }
    $('touch').className = save.steer === 'slide' ? 'slide' : ''; setMode('race'); $('loading').hidden = true; audio.musicMode(true);
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (_) {}
  }, 80);
}
function togglePause() {
  if (mode !== 'race' || !race || race.shown || !$('loading').hidden) return;
  paused = !paused; $('menu').hidden = !paused; $('touch').hidden = paused;
  if (paused) { $('menuTitle').textContent = 'Paused'; $('menuRestart').hidden = $('menuQuit').hidden = false; $('menuResume').firstElementChild.textContent = 'Resume'; audio.quiet(); audio.musicMode(false); syncOptions(); }
  else audio.musicMode(true);
}
function syncOptions() {
  document.querySelectorAll('.seg').forEach(seg => { const v = save[seg.dataset.opt]; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); });
}
function fatal(text) { $('loading').hidden = false; $('loading').innerHTML = '<p id="fatal">' + text + '</p>'; }

function initUi() {
  const click = (id, fn) => $(id).addEventListener('click', e => { e.preventDefault(); fn(e); });
  click('btnRace', goRace);
  click('btnGarage', () => { audio.init(); audio.ui(); garIdx = save.car; setMode('garage'); refreshGarage(); });
  click('garBack', () => { audio.ui(); setShowCar(save.car, paintOf(save.car)); refreshHome(); setMode('home'); });
  const trk = d => { audio.init(); audio.ui(); save.track = (save.track + d + TRACKS.length) % TRACKS.length; storeSave(); refreshHome(); };
  click('trkPrev', () => trk(-1)); click('trkNext', () => trk(1));
  const car = d => { audio.ui(); garIdx = (garIdx + d + CARS.length) % CARS.length; refreshGarage(); };
  click('carPrev', () => car(-1)); click('carNext', () => car(1));
  click('carAction', () => { const c = CARS[garIdx];
    if (!save.owned.includes(c.id)) { if (save.credits < c.price) return; save.credits -= c.price; save.owned.push(c.id); save.car = garIdx; audio.cash(); }
    else { save.car = garIdx; audio.ui(); }
    storeSave(); refreshGarage(); });
  click('btnPause', togglePause);
  click('menuResume', () => { audio.ui(); if (mode === 'race') togglePause(); else $('menu').hidden = true; });
  click('menuRestart', goRace); click('menuQuit', () => { audio.ui(); goHome(); });
  click('resAgain', goRace); click('resHome', () => { audio.ui(); goHome(); });
  click('btnSettings', () => { audio.init(); audio.ui(); $('menuTitle').textContent = 'Settings'; $('menuRestart').hidden = $('menuQuit').hidden = true; $('menuResume').firstElementChild.textContent = 'Done'; syncOptions(); $('menu').hidden = false; });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    const k = b.parentElement.dataset.opt; save[k] = b.dataset.v; storeSave(); audio.init(); syncOptions();
    if (k === 'quality') { gfx.autoLow = false; gfx.pr = Math.min(gfx.prMax, 1.6); applyQuality(); } else if (k === 'steer') $('touch').className = save.steer === 'slide' ? 'slide' : ''; else audio.applySettings();
    audio.ui(); }));
  const fs = $('btnFull'), root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) fs.hidden = true;
  else click('btnFull', () => { audio.ui(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen().then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} }).catch(() => { fs.hidden = true; }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (mode === 'race' && !paused) togglePause(); audio.suspend(true); } else audio.suspend(false); });
}

let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, .1); lastT = t; if (!(dt > 0) || document.hidden) return;
  gfx.time += dt;
  if (mode === 'race' && race) {
    if (!paused) { updateRace(Math.min(dt, .05)); perfTick(dt); }
    renderScene(race.T.scene, race.cam, race.T.th.exposure, paused ? 0 : race.blur, race.T.th.bloom);
  } else if (show && (mode === 'home' || mode === 'garage')) { updateShow(dt); renderScene(show.scene, show.cam, 1.2, 0, .85); }
}
function boot() {
  if (!window.THREE) { fatal('The 3D engine did not load. Check your connection and reload.'); return; }
  loadSave();
  if (!CARS[save.car] || !save.owned.includes(CARS[save.car].id)) save.car = 0;
  if (!TRACKS[save.track]) save.track = 0;
  try { initGfx(); } catch (e) { fatal('This device or browser cannot start WebGL, which the game needs.'); return; }
  const go = () => { initTextures(); buildShow(); setShowCar(save.car, paintOf(save.car)); initInput(); initUi(); refreshHome(); setMode('home'); $('loading').hidden = true; requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); }); };
  const fonts = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('italic 700 40px "Chakra Petch"'), document.fonts.load('600 30px "Barlow Condensed"')]) : Promise.resolve();
  Promise.race([fonts, new Promise(r => setTimeout(r, 1800))]).catch(() => {}).then(() => { try { go(); } catch (e) { console.error(e); fatal('Something went wrong while starting: ' + e.message); } });
}
boot();

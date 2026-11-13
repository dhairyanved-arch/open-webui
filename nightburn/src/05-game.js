// ===================================================================
// race: physics, rivals, camera, effects, HUD
// ===================================================================
const GRAV = 21;
let race = null, show = null, mode = 'boot', paused = false;

class Particles {
  constructor(n, additive) {
    this.n = n; this.i = 0; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.a0 = new Float32Array(n); this.grow = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4)); g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { px: { value: 600 } },
      vertexShader: 'attribute float size; attribute vec4 pcolor; uniform float px; varying vec4 vC; void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*px/max(-mv.z,.5); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC.rgb,vC.a*smoothstep(.5,.12,d));\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}' });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow, grav) {
    const k = this.i; this.i = (k + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z; this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = this.max[k] = life; this.size[k] = size; this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = a; this.a0[k] = a; this.grow[k] = grow || 0; this.grav[k] = grav || 0;
  }
  update(dt) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue; this.life[k] -= dt;
      if (this.life[k] <= 0) { this.size[k] = 0; this.col[k * 4 + 3] = 0; continue; }
      this.vel[k * 3 + 1] -= this.grav[k] * dt; this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.size[k] += this.grow[k] * dt; this.col[k * 4 + 3] = this.a0[k] * this.life[k] / this.max[k];
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.pcolor.needsUpdate = this.geo.attributes.size.needsUpdate = true;
    this.mat.uniforms.px.value = gfx.h * gfx.pr * .9;
  }
}

function disposeCar(g) { if (!g) return; dropGlows(g); g.traverse(o => { if (o.geometry && o.geometry !== carParts.wheel) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); }

function startRace() {
  if (race) endRace();
  const def = TRACKS[save.track], T = buildTrack(def), pdef = CARS[save.car], o = {};
  const R = race = { T, def, cars: [], time: 0, clock: 0, state: 'count', countT: 0, countN: 0, laps: def.laps, finished: 0, stats: { drift: 0, air: 0, ko: 0, pick: 0 },
    cam: new THREE.PerspectiveCamera(60, 1, .3, 5600), camYaw: 0, camY: 0, shake: 0, blur: 0, endT: 0, driftRun: 0, airRun: 0, wrongT: 0, hitCool: 0, orbit: 0, shown: false, vel: new THREE.Vector3() };
  R.sparks = new Particles(260, true); R.smoke = new Particles(160, false); T.scene.add(R.sparks.points, R.smoke.points);
  const rnd = rng(Date.now() & 0xffff), pool = PAINTS.map((_, i) => i).filter(i => i !== paintOf(save.car));
  for (let k = 0; k < 8; k++) {
    const isP = k === 7, cdef = isP ? pdef : CARS[Math.floor(rnd() * CARS.length)], paint = isP ? PAINTS[paintOf(save.car)] : PAINTS[pool[k % pool.length]];
    const q = (6 - k) / 6, row = Math.floor(k / 2), s0 = T.L - 9 - row * 10 - (k % 2) * 5, d = k % 2 ? 3.3 : -3.3;
    const c = { isPlayer: isP, def: cdef, name: isP ? 'You' : RIVALS[k], mesh: buildCar(cdef, paint, isP), fx: buildGroundFx(isP ? T.th.accR : paint, T.th.night),
      s: s0, d, idx: 0, f: 0, x: 0, y: 0, z: 0, th: 0, yaw: 0, velAng: 0, speed: 0, vy: 0, air: false, prevGy: 0, gy: 0, steer: 0, slip: 0, pitch: 0, roll: 0, spinA: 0,
      nitro: isP ? .5 : 0, boost: 0, boosting: false, drifting: false, braking: false, prog: s0 - T.L, lap: -1, lapStart: 0, best: Infinity, finished: false, finishTime: 0, place: 0,
      aiTop: pdef.top * (.89 + .12 * q + def.diff), aiAcc: pdef.acc * (.88 + .14 * q), lane: d, laneT: 2 + rnd() * 3, boostT: 0, wreck: 0, koCool: 0, rnd: rng(k * 977 + 5) };
    T.at(s0, d, o); c.x = o.x; c.z = o.z; c.idx = o.idx; c.f = o.f; c.th = c.yaw = c.velAng = o.th; c.y = c.gy = c.prevGy = T.ground(c.idx, c.f, d, s0);
    T.scene.add(c.mesh, c.fx); R.cars.push(c); if (isP) R.player = c;
  }
  R.camYaw = R.player.yaw; R.camY = R.player.y;
  applyGlow(); buildMinimap();
  $('hudTotal').textContent = 8; $('hudLaps').textContent = R.laps;
  const b = save.best[def.id]; $('hudBest').textContent = b ? 'Best ' + fmtTime(b.time) : '';
  for (const c of R.cars) poseCar(c, .016);
  updateCamera(.016); updateHud(true);
  gfx.renderer.compile(T.scene, R.cam);
}
function endRace() {
  if (!race) return; for (const c of race.cars) { disposeCar(c.mesh); c.fx.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  race.T.dispose(); race = null;
}

function vertical(c, gy, dt) {
  if (c.air) {
    c.vy -= GRAV * dt; c.y += c.vy * dt;
    if (c.y <= gy) { c.air = false; c.impact = -c.vy; c.y = gy; c.vy = 0; }
  } else {
    const gvy = (gy - c.prevGy) / dt;
    if (gvy < c.vy - GRAV * dt - 2.6) { c.air = true; c.vy -= GRAV * dt; c.y += c.vy * dt; if (c.y <= gy) { c.y = gy; c.air = false; c.vy = 0; } }
    else { c.y = gy; c.vy = clamp(gvy, -30, 30); }
  }
  c.prevGy = gy; c.gy = gy;
}
function lapCheck(c) {
  const R = race, T = R.T, lap = Math.floor(c.prog / T.L);
  if (lap <= c.lap) return;
  if (c.lap >= 0) { const lt = R.time - c.lapStart; if (lt < c.best) c.best = lt; }
  c.lap = lap; c.lapStart = R.time;
  if (lap >= R.laps && !c.finished) { c.finished = true; c.finishTime = R.time; c.place = ++R.finished; if (c.isPlayer) { c.boosting = false; msg('FINISH', 'amber'); audio.cash(); } }
  else if (c.isPlayer && lap > 0) { msg(lap === R.laps - 1 ? 'FINAL LAP' : 'LAP ' + (lap + 1), 'amber'); audio.beep(true); }
}
function nudge(p, a) { p.x += -Math.cos(p.th) * a; p.z += Math.sin(p.th) * a; p.d += a; }
function sparkBurst(x, y, z, n, pw) { const S = race.sparks; for (let i = 0; i < n; i++) S.emit(x, y, z, (Math.random() - .5) * 14 * pw, Math.random() * 7 * pw + 1, (Math.random() - .5) * 14 * pw, .25 + Math.random() * .45, .22 + Math.random() * .2, 3, 1.5 + Math.random(), .4, 1, 0, 20); }

function stepPlayer(p, dt) {
  const R = race, T = R.T, def = p.def, go = R.state === 'go';
  let v = p.speed, steerIn = clamp((input.right || input.kbR) - (input.left || input.kbL) + input.analog, -1, 1), brake = !!(input.brake || input.kbB);
  if (!go) brake = false;
  if (p.finished) { brake = false; const want = T.head[(p.idx + 8) % T.N] + clamp(p.d * .045, -.35, .35); steerIn = clamp(-angDiff(want, p.yaw) * 3, -1, 1); }
  p.steer = damp(p.steer, steerIn, steerIn === 0 ? 11 : 8, dt);
  if (input.nitroTap) { input.nitroTap = 0; if (go && !p.finished && !p.boosting && p.nitro > .1) { p.boosting = true; audio.nitroOn(); R.shake = Math.max(R.shake, .6); } }
  if (p.boosting) { p.nitro -= dt * .2; if (p.nitro <= 0) { p.nitro = 0; p.boosting = false; } }
  else if (go) p.nitro = Math.min(1, p.nitro + dt * .012);
  p.boost = damp(p.boost, p.boosting ? 1 : 0, 7, dt);
  const top = def.top * (1 + .28 * p.boost * def.boost);
  if (brake && Math.abs(p.steer) > .22 && v > 24 && !p.air) p.drifting = true; else if (!brake || v < 15) p.drifting = false;
  p.braking = brake;
  if (!go) v = 0;
  else if (p.finished) v = damp(v, 30, .8, dt);
  else if (p.drifting) v -= (3 + (1 - Math.abs(p.steer)) * 9) * dt;
  else if (brake) v -= 34 * dt;
  else { const r = v / top; v += (def.acc * (1 - r * r) + p.boost * 15 * (r < 1 ? 1 : 0)) * dt * (p.air ? .3 : 1); }
  if (v < 0) v = 0;
  const yawMax = def.grip * lerp(1.5, .78, smooth(18, 95, v)) * smooth(0, 10, v) * (p.drifting ? 1.6 : 1) * (p.air ? .25 : 1);
  p.yaw -= p.steer * yawMax * dt;
  if (!p.air && Math.abs(steerIn) < .05 && !p.drifting && v > 10) p.yaw = dampAng(p.yaw, T.head[(p.idx + Math.round(v * .25 / T.step) + 1) % T.N], .9, dt);
  p.velAng = dampAng(p.velAng, p.yaw, p.air ? 0 : (p.drifting ? 1.8 : 9.5), dt);
  let slip = angDiff(p.yaw, p.velAng); if (Math.abs(slip) > .62) { slip = Math.sign(slip) * .62; p.yaw = p.velAng + slip; } p.slip = slip;
  if (!p.air) v -= Math.abs(slip) * v * (p.drifting ? .12 : .3) * dt;
  p.x += Math.sin(p.velAng) * v * dt; p.z += Math.cos(p.velAng) * v * dt;
  const s0 = p.s; T.project(p);
  let ds = p.s - s0; if (ds < -T.L / 2) ds += T.L; else if (ds > T.L / 2) ds -= T.L; p.prog += ds;
  // barriers
  const lim = T.hw - 1.05;
  if (Math.abs(p.d) > lim) {
    const side = Math.sign(p.d); nudge(p, side * lim - p.d);
    const rel = angDiff(p.velAng, p.th), into = -rel * side;
    if (into > 0) {
      const impact = v * Math.sin(Math.min(into, 1.2));
      v *= 1 - clamp(impact / 55, 0, .45); p.velAng = p.th - rel * .25; p.yaw = p.velAng + angDiff(p.yaw, p.velAng) * .4;
      const wx = p.x - Math.cos(p.th) * side * 1.0, wz = p.z + Math.sin(p.th) * side * 1.0;
      if (impact > 4) { sparkBurst(wx, p.y + .5, wz, 16, 1); audio.crash(impact / 40); R.shake = Math.max(R.shake, clamp(impact / 22, .3, 1)); }
      else { v -= 5 * dt; if (Math.random() < .5) sparkBurst(wx, p.y + .4, wz, 1, .6); }
    }
  }
  const gy = T.ground(p.idx, p.f, p.d, p.s), wasAir = p.air; vertical(p, gy, dt);
  if (wasAir && !p.air) {
    audio.land(); R.shake = Math.max(R.shake, clamp(p.impact / 12, .3, 1));
    for (let i = 0; i < 10; i++) R.smoke.emit(p.x + (Math.random() - .5) * 2, p.y + .2, p.z + (Math.random() - .5) * 2, (Math.random() - .5) * 5, 1 + Math.random() * 2, (Math.random() - .5) * 5, .7, 1.2, .7, .7, .75, .3, 5, 0);
    if (R.airRun > .5) { msg('AIR TIME ' + R.airRun.toFixed(1) + 's', 'volt'); R.stats.air += R.airRun; }
    R.airRun = 0;
  }
  if (p.air) { R.airRun += dt; p.nitro = Math.min(1, p.nitro + dt * .22); }
  if (p.drifting && Math.abs(slip) > .1 && !p.air) { R.driftRun += v * dt; p.nitro = Math.min(1, p.nitro + dt * .13); }
  else if (!p.drifting && R.driftRun > 0) { if (R.driftRun > 45) { R.stats.drift += R.driftRun; msg('DRIFT ' + Math.round(R.driftRun) + ' M', 'hot'); } R.driftRun = 0; }
  p.speed = v; lapCheck(p);
  // facing the wrong way for a while → put the car back on the racing line
  if (go && !p.finished && Math.abs(angDiff(p.yaw, p.th)) > 1.9) R.wrongT += dt; else R.wrongT = 0;
  if (R.wrongT > 2.2) { const o = {}; T.at(p.s, 0, o); p.x = o.x; p.z = o.z; p.yaw = p.velAng = o.th; p.speed = 12; R.wrongT = 0; T.project(p); }
}

function stepAI(c, dt) {
  const R = race, T = R.T, N = T.N, p = R.player;
  if (R.state !== 'go') return;
  c.koCool -= dt;
  if (c.wreck > 0) { c.wreck -= dt; const k = 1 - Math.max(c.wreck, 0) / 2.4; c.spinA = TAU * 2 * (1 - Math.pow(1 - k, 2.2)); c.speed = damp(c.speed, 16, 2.2, dt); if (c.wreck <= 0) c.spinA = 0; }
  // corner speed from curvature ahead
  const reach = Math.round(clamp(c.speed * .95, 12, 100) / T.step); let kMax = 0, kSum = 0;
  for (let k = 0; k <= reach; k += 3) { const kk = T.kap[(c.idx + k) % N]; kMax = Math.max(kMax, Math.abs(kk)); kSum += kk; }
  let target = Math.min(c.aiTop, Math.sqrt((47 + R.def.diff * 150) / Math.max(kMax, 1e-4)));
  const gap = p.prog - c.prog; target *= 1 + clamp(gap / 1400, -.05, .07);
  if (c.boostT > 0) { c.boostT -= dt; target *= 1.17; } else if (c.wreck <= 0 && c.speed > 45 && c.rnd() < dt * .035) c.boostT = 2.6;
  c.boost = damp(c.boost, c.boostT > 0 ? 1 : 0, 6, dt);
  if (c.finished) target = 30;
  if (c.wreck <= 0) { if (c.speed < target) c.speed += Math.max(c.aiAcc * (1 - Math.pow(c.speed / (target * 1.03), 2)), 1.5) * dt * (1 + c.boost * .6); else c.speed -= Math.min(16 * dt, c.speed - target); }
  c.braking = c.speed > target + 1;
  // lane choice: racing line + personal lane + avoiding slower cars
  c.laneT -= dt; if (c.laneT <= 0) { c.laneT = 2 + c.rnd() * 4; c.lane = (c.rnd() * 2 - 1) * 5.6; }
  let td = c.lane * .55 + clamp(-kSum / (reach / 3 + 1) * 520, -4.6, 4.6);
  for (const o of R.cars) { if (o === c) continue; let ds = o.s - c.s; if (ds > T.L / 2) ds -= T.L; else if (ds < -T.L / 2) ds += T.L;
    if (ds > 0 && ds < 18 && Math.abs(o.d - c.d) < 2.5 && o.speed < c.speed + 3) { td = o.d + (c.d >= o.d ? 3 : -3); if (Math.abs(td) > T.hw - 1.6) td = o.d - Math.sign(td) * 3; } }
  td = clamp(td, -T.hw + 1.6, T.hw - 1.6);
  const d0 = c.d; c.d = damp(c.d, td, 1.5, dt); c.d = clamp(c.d, -T.hw + 1.3, T.hw - 1.3);
  c.s += c.speed * dt; c.prog += c.speed * dt; if (c.s >= T.L) c.s -= T.L;
  T.at(c.s, c.d, c);
  c.yaw = c.velAng = c.th - Math.atan2((c.d - d0) / dt, Math.max(c.speed, 6));
  c.steer = clamp(-T.kap[c.idx] * 60, -1, 1);
  vertical(c, T.ground(c.idx, c.f, c.d, c.s), dt); lapCheck(c);
}

function collide() {
  const R = race, T = R.T, p = R.player; if (R.state !== 'go') return;
  for (const c of R.cars) {
    if (c.isPlayer) continue;
    let ds = c.s - p.s; if (ds > T.L / 2) ds -= T.L; else if (ds < -T.L / 2) ds += T.L;
    const dd = c.d - p.d;
    if (Math.abs(ds) > 4.4 || Math.abs(dd) > 1.95 || Math.abs(c.y - p.y) > 1.3) continue;
    const rel = p.speed - c.speed, sgn = dd >= 0 ? 1 : -1, pen = 1.95 - Math.abs(dd), mx = (c.x + p.x) / 2, mz = (c.z + p.z) / 2;
    if (c.wreck <= 0 && c.koCool <= 0 && !p.finished && ((p.boost > .5 && rel > 3) || rel > 16)) {
      c.wreck = 2.4; c.koCool = 8; c.speed *= .55; c.vy = 5.5; c.air = true; c.lane = clamp(c.d + sgn * 4, -6, 6); c.laneT = 3; c.boostT = 0;
      R.stats.ko++; p.nitro = Math.min(1, p.nitro + .3); p.speed *= .97; msg('KNOCKOUT', 'amber'); audio.crash(1); R.shake = 1; sparkBurst(mx, p.y + .6, mz, 34, 1.5);
      continue;
    }
    if (Math.abs(ds) < 3.5) { nudge(p, -sgn * pen * .5); c.d += sgn * pen * .5; c.lane = c.d + sgn * 2; p.velAng = dampAng(p.velAng, p.th, .5, 1); }
    else if (ds > 0) { if (rel > 0) { p.speed = c.speed * .985; c.speed += rel * .3; } nudge(p, -sgn * pen * .3); }
    else { if (rel < 0) c.speed = p.speed * .985; c.d += sgn * pen * .3; }
    if (R.hitCool <= 0) { R.hitCool = .35; audio.crash(clamp(Math.abs(rel) / 30, .12, .6)); R.shake = Math.max(R.shake, .35); sparkBurst(mx, p.y + .5, mz, 8, .8); }
  }
}

function poseCar(c, dt) {
  const T = race.T, u = c.mesh.userData, fu = c.fx.userData;
  c.pitch = damp(c.pitch, Math.atan2(c.vy, Math.max(c.speed, 12)), 10, dt);
  const bank = Math.asin(lerp(T.sb[c.idx], T.sb[(c.idx + 1) % T.N], c.f));
  c.roll = damp(c.roll, c.air ? 0 : -bank - c.steer * .07 * smooth(5, 40, c.speed), 8, dt);
  const yaw = c.yaw + (c.isPlayer ? c.slip * .55 : 0) + c.spinA;
  c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.set(-c.pitch, yaw, c.roll + (c.wreck > 0 ? Math.sin(c.spinA) * .25 : 0));
  spinWheels(c.mesh, c.speed * dt, -c.steer * .38); setFlames(c.mesh, c.boost, race.clock);
  const tk = c.braking ? 4.5 : 2; if (u.tail.k !== tk) { u.tail.k = tk; setGlow(u.tail); }
  const alt = Math.max(0, c.y - c.gy), k = clamp(1 - alt / 7, .2, 1);
  c.fx.position.set(c.x, c.gy, c.z); c.fx.rotation.set(-Math.asin(T.ty[c.idx]), yaw, -bank);
  fu.sh.material.opacity = .82 * k; fu.sh.scale.setScalar(1 + alt * .07); fu.ug.material.opacity = k * k; if (fu.bm) fu.bm.visible = alt < 1.5;
}

const camTmp = { x: 0, z: 0, idx: 0 }, camLook = new THREE.Vector3();
function updateCamera(dt) {
  const R = race, T = R.T, p = R.player, cam = R.cam, aspect = gfx.w / gfx.h;
  const sf = clamp(p.speed / p.def.top, 0, 1.4);
  const land = 56 + sf * 9 + p.boost * 8, port = 2 * Math.atan(Math.tan((50 + sf * 6 + p.boost * 6) * Math.PI / 360) / aspect) * 180 / Math.PI;
  cam.fov = Math.min(112, Math.max(land, port)); cam.aspect = aspect; cam.updateProjectionMatrix();
  R.camY = damp(R.camY, p.y, p.air ? 3 : 9, dt);
  let yaw, dist, hgt;
  if (R.state === 'count') { const k = smooth(0, 3.7, R.countT); yaw = p.yaw + lerp(2.7, 0, k); dist = lerp(10.5, 7.4, k); hgt = lerp(1.7, 2.55, k); R.camYaw = p.yaw; }
  else if (p.finished) { R.orbit += dt * .55; yaw = p.yaw + Math.PI + Math.sin(R.orbit) * 1.2; dist = 9.5; hgt = 2.2; }
  else { R.camYaw = dampAng(R.camYaw, p.velAng + p.slip * .25, 5.5, dt); yaw = R.camYaw; dist = 7.4 + p.boost * 1.6 + sf * .8; hgt = 2.55 + sf * .25; }
  const sh = R.shake * .32 + p.boost * .008;
  let cx = p.x - Math.sin(yaw) * dist + (Math.random() - .5) * sh, cz = p.z - Math.cos(yaw) * dist + (Math.random() - .5) * sh, cy = R.camY + hgt + (Math.random() - .5) * sh;
  // keep the camera inside the barriers and above the tarmac
  camTmp.x = cx; camTmp.z = cz; camTmp.idx = p.idx; T.project(camTmp);
  const lim = T.hw - .7; if (Math.abs(camTmp.d) > lim) { const a = Math.sign(camTmp.d) * lim - camTmp.d; cx += -Math.cos(camTmp.th) * a; cz += Math.sin(camTmp.th) * a; camTmp.d += a; }
  cy = Math.max(cy, T.ground(camTmp.idx, camTmp.f, camTmp.d, -1) + 1.3);
  R.vel.set((cx - cam.position.x) / dt, 0, (cz - cam.position.z) / dt);
  cam.position.set(cx, cy, cz);
  const fwd = R.state === 'count' || p.finished ? 0 : 6;
  camLook.set(p.x + Math.sin(yaw) * fwd, lerp(R.camY, p.y, .5) + 1.2, p.z + Math.cos(yaw) * fwd); cam.lookAt(camLook);
  if (fwd) cam.rotateZ(p.steer * .03 * sf - Math.asin(T.sb[p.idx]) * .35);
  T.sky.position.copy(cam.position); T.sky.material.uniforms.time.value = R.clock;
  R.shake = damp(R.shake, 0, 5, dt);
  R.blur = damp(R.blur, p.boost * .5, 5, dt);
}

function updateRace(dt) {
  const R = race, T = R.T, p = R.player; R.clock += dt;
  if (R.state === 'count') {
    R.countT += dt; const n = Math.floor(R.countT / .95);
    if (n !== R.countN) { R.countN = n; if (n >= 1 && n <= 3) { showCount(String(4 - n)); audio.beep(false); } else if (n >= 4) { showCount('GO'); audio.beep(true); R.state = 'go'; } }
  }
  if (R.state === 'go' && !p.finished) R.time += dt;
  R.hitCool -= dt;
  const sub = dt > 1 / 40 ? 2 : 1, h = dt / sub;
  for (let k = 0; k < sub; k++) { stepPlayer(p, h); for (const c of R.cars) if (!c.isPlayer) stepAI(c, h); collide(); }
  // pickups
  for (const pk of T.pickups) {
    if (pk.t > 0) { pk.t -= dt; if (pk.t <= 0) pk.g.visible = true; continue; }
    pk.g.rotation.y += dt * 2.4; pk.g.children[0].position.y = Math.sin(R.clock * 3 + pk.s) * .18;
    let ds = pk.s - p.s; if (ds > T.L / 2) ds -= T.L; else if (ds < -T.L / 2) ds += T.L;
    if (Math.abs(ds) < 3.6 && Math.abs(pk.d - p.d) < 2.4 && Math.abs(p.y + .8 - pk.y) < 2.8 && !p.finished) {
      pk.t = 10; pk.g.visible = false; p.nitro = Math.min(1, p.nitro + .34); R.stats.pick++; audio.pickup(); msg('NITRO +', 'volt');
      for (let i = 0; i < 14; i++) R.sparks.emit(p.x, p.y + 1, p.z, (Math.random() - .5) * 12, Math.random() * 8, (Math.random() - .5) * 12, .5, .3, .4, 2, 3, 1, 0, 6);
    }
  }
  // effects
  if (p.drifting && !p.air && Math.abs(p.slip) > .1) for (const s of [-1, 1]) {
    const bx = p.x - Math.sin(p.yaw) * 1.4 + Math.cos(p.yaw) * s * .85, bz = p.z - Math.cos(p.yaw) * 1.4 - Math.sin(p.yaw) * s * .85;
    R.smoke.emit(bx, p.y + .15, bz, (Math.random() - .5) * 2, .8 + Math.random(), (Math.random() - .5) * 2, .75, .9, .82, .82, .88, .3, 5.5, 0);
  }
  if (p.boost > .4) { const bx = p.x - Math.sin(p.yaw) * 2.6, bz = p.z - Math.cos(p.yaw) * 2.6; R.sparks.emit(bx + (Math.random() - .5) * .8, p.y + .4, bz + (Math.random() - .5) * .8, (Math.random() - .5) * 3, Math.random() * 2, (Math.random() - .5) * 3, .3, .2, .4, 1.6, 3.5, 1, 0, 0); }
  R.sparks.update(dt); R.smoke.update(dt);
  for (const c of R.cars) poseCar(c, dt);
  updateCamera(dt);
  for (const f of T.tick) f(dt, R.cam, R.vel);
  // audio
  const sfr = p.speed / (p.def.top * 1.3), gear = Math.min(5, Math.floor(sfr * 6)), inGear = sfr * 6 - gear;
  R.gear = gear + 1;
  const rpm = R.state === 'count' ? .28 + .1 * Math.sin(R.clock * 9) + (R.countN >= 1 ? .12 : 0) : clamp(.32 + .66 * (gear === 5 ? Math.min(inGear, 1) : inGear), 0, 1.05);
  audio.engine(rpm, p.finished ? .2 : (p.braking ? .15 : .7 + p.boost * .3), clamp(p.speed / 110, 0, 1), p.air ? 0 : Math.abs(p.slip) * (p.speed > 15 ? 1 : 0), p.boost);
  updateHud(false);
  if (p.finished) { R.endT += dt; if (R.endT > 2.6 && !R.shown) { R.shown = true; showResults(); } }
}

// ---------------- HUD ----------------
const H = {};
function setText(id, v) { const el = H[id] || (H[id] = $(id)); if (el._v !== v) { el._v = v; el.textContent = v; } }
let msgTimer = 0;
function msg(text, cls) { const el = $('hudMsg'); el.className = ''; void el.offsetWidth; el.textContent = text; el.className = 'show ' + (cls || ''); clearTimeout(msgTimer); msgTimer = setTimeout(() => el.className = '', 1550); }
function showCount(t) { const el = $('countdown'); el.className = ''; void el.offsetWidth; el.textContent = t; el.className = 'tick' + (t === 'GO' ? ' go' : ''); }
const mini = { bg: null, sx: 1, ox: 0, oz: 0, size: 208 };
function buildMinimap() {
  const T = race.T, S = mini.size, pad = 16; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.px[i]); x1 = Math.max(x1, T.px[i]); z0 = Math.min(z0, T.pz[i]); z1 = Math.max(z1, T.pz[i]); }
  mini.sx = (S - pad * 2) / Math.max(x1 - x0, z1 - z0); mini.ox = (x0 + x1) / 2; mini.oz = (z0 + z1) / 2;
  const c = mini.bg = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const path = () => { g.beginPath(); for (let i = 0; i <= T.N; i += 2) { const k = i % T.N, x = S / 2 - (T.px[k] - mini.ox) * mini.sx, y = S / 2 - (T.pz[k] - mini.oz) * mini.sx; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  g.lineJoin = 'round'; path(); g.strokeStyle = 'rgba(8,5,20,.75)'; g.lineWidth = 13; g.stroke(); path(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4.5; g.stroke();
  const x = S / 2 - (T.px[0] - mini.ox) * mini.sx, y = S / 2 - (T.pz[0] - mini.oz) * mini.sx; g.fillStyle = '#ffb400'; g.fillRect(x - 5, y - 5, 10, 10);
}
function drawMinimap() {
  const g = mini.ctx || (mini.ctx = $('minimap').getContext('2d')), S = mini.size; g.clearRect(0, 0, S, S); g.drawImage(mini.bg, 0, 0);
  for (const c of race.cars) { const x = S / 2 - (c.x - mini.ox) * mini.sx, y = S / 2 - (c.z - mini.oz) * mini.sx; g.beginPath(); g.arc(x, y, c.isPlayer ? 8 : 5.5, 0, TAU);
    g.fillStyle = c.isPlayer ? '#19e3ff' : '#ff2e7e'; g.fill(); if (c.isPlayer) { g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); } }
}
let hudFrame = 0;
function updateHud(force) {
  const R = race, p = R.player;
  setText('hudSpeed', Math.round(p.speed * 3.6));
  if (force || (hudFrame++ & 1)) {
    let pos = 1; for (const c of R.cars) if (c !== p && (c.finished ? (!p.finished || c.place < p.place) : (!p.finished && c.prog > p.prog))) pos++;
    R.pos = pos; setText('hudPos', pos); setText('hudOrd', ordinal(pos)); setText('hudLap', clamp(p.lap + 1, 1, R.laps)); setText('hudTime', fmtTime(R.time)); setText('hudGear', 'GEAR ' + (R.gear || 1));
    const n = Math.round(p.nitro * 100), nb = H.tNitro || (H.tNitro = $('tNitro'));
    if (nb._n !== n) { nb._n = n; nb.style.setProperty('--n', n); }
    const cls = 'tbtn' + (p.boosting ? ' burn' : p.nitro > .1 ? ' ready' : ''); if (nb._c !== cls) { nb._c = cls; nb.className = cls; }
    const ww = R.wrongT > .7, we = H.ww || (H.ww = $('wrongWay')); if (we.hidden === ww) we.hidden = !ww;
    drawMinimap();
  }
}
function showResults() {
  const R = race, p = R.player, def = R.def, place = p.place;
  const base = Math.round([4200, 3000, 2200, 1600, 1200, 900, 700, 500][place - 1] * def.pay), drift = Math.round(R.stats.drift * 3), air = Math.round(R.stats.air * 160), ko = R.stats.ko * 400;
  const total = base + drift + air + ko; save.credits += total;
  const old = save.best[def.id], record = !old || p.finishTime < old.time; if (record) save.best[def.id] = { time: p.finishTime, lap: p.best };
  storeSave();
  $('resTrack').textContent = def.name; $('resPlace').textContent = place + ordinal(place);
  $('resLine').textContent = place === 1 ? 'Victory' : place <= 3 ? 'Podium finish' : 'Race complete';
  const rows = [['Race time', fmtTime(p.finishTime) + (record ? '  ·  record' : '')], ['Best lap', fmtTime(p.best)], ['Finish bonus', fmtNum(base)]];
  if (drift) rows.push(['Drift ' + Math.round(R.stats.drift) + ' m', fmtNum(drift)]); if (air) rows.push(['Air time ' + R.stats.air.toFixed(1) + ' s', fmtNum(air)]); if (ko) rows.push(['Knockouts × ' + R.stats.ko, fmtNum(ko)]);
  $('resRows').innerHTML = rows.map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('') + '<div class="total"><span>Credits earned</span><b>+' + fmtNum(total) + '</b></div>';
  $('results').hidden = false; $('touch').hidden = true; audio.musicMode(false);
}

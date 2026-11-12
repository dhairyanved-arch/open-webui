// ===================================================================
// cars: lofted bodywork, wheels, lights, flames
// ===================================================================
// Car space: +z forward, +y up, +x is the driver's LEFT.
function loftGeo(secs, seg, sub) {
  const K = secs.length, rs = [];
  const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < sub; j++) {
    const t = j / sub, a = secs[Math.max(k - 1, 0)], b = secs[k], c = secs[k + 1], d = secs[Math.min(k + 2, K - 1)];
    rs.push([0, 1, 2, 3, 4].map(q => cr(a[q], b[q], c[q], d[q], t)));
  }
  rs.push(secs[K - 1]);
  const R = rs.length, pos = [], idx = [], e = 2 / 3.6;
  for (const [z, w, y0, y1, tw] of rs) for (let j = 0; j < seg; j++) {
    const th = (j + .5) / seg * TAU, c = Math.cos(th), s = Math.sin(th), yc = (y0 + y1) / 2, hh = (y1 - y0) / 2;
    const taper = s > 0 ? 1 - (1 - tw) * Math.pow(s, 1.4) : 1;
    pos.push(w * Math.sign(c) * Math.pow(Math.abs(c), e) * taper, yc + hh * Math.sign(s) * Math.pow(Math.abs(s), e), z);
  }
  for (let a = 0; a < R - 1; a++) for (let j = 0; j < seg; j++) {
    const p00 = a * seg + j, p01 = a * seg + (j + 1) % seg, p10 = p00 + seg, p11 = p01 + seg; idx.push(p00, p01, p10, p01, p11, p10);
  }
  // caps
  for (const [ring, front] of [[0, false], [R - 1, true]]) {
    const base = pos.length / 3; let cy = 0; for (let j = 0; j < seg; j++) { const k = (ring * seg + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); cy += pos[k + 1]; }
    pos.push(0, cy / seg, rs[ring][0]); const cI = base + seg;
    for (let j = 0; j < seg; j++) { const a = base + j, b = base + (j + 1) % seg; front ? idx.push(cI, a, b) : idx.push(cI, b, a); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
//             z      w    y0   y1   topWidth
const BODY = [[-2.30, .66, .44, .70, .92], [-2.20, .90, .33, .80, .92], [-1.86, 1.0, .24, .87, .88], [-1.20, 1.0, .20, .86, .84], [-.40, .97, .19, .78, .84],
  [.40, .96, .19, .70, .84], [1.10, .99, .19, .67, .86], [1.72, .96, .21, .59, .86], [2.12, .87, .25, .47, .9], [2.33, .68, .30, .40, .9]];
const CABIN = [[-1.62, .46, .74, .80, .8], [-1.10, .68, .72, .98, .74], [-.50, .76, .70, 1.11, .7], [.12, .76, .68, 1.09, .7], [.74, .71, .64, .88, .78], [1.22, .60, .60, .68, .86]];

const carParts = {};
function wheelGeo() {
  if (carParts.wheel) return carParts.wheel;
  const rub = col(0x08080a), rim = col(0xb9bcc6), hub = col(0x1a1b20), parts = [], rz = M4().makeRotationZ(Math.PI / 2);
  parts.push({ g: new THREE.CylinderGeometry(.36, .36, .3, 22), m: rz, c: rub });
  for (const s of [-1, 1]) {
    parts.push({ g: new THREE.CylinderGeometry(.255, .255, .02, 18), m: M4().makeTranslation(s * .153, 0, 0).multiply(rz), c: hub });
    for (let k = 0; k < 5; k++) parts.push({ g: new THREE.BoxGeometry(.03, .5, .06), m: M4().makeRotationX(k / 5 * Math.PI).premultiply(M4().makeTranslation(s * .165, 0, 0)), c: rim });
    parts.push({ g: new THREE.TorusGeometry(.25, .022, 5, 20), m: M4().makeRotationY(Math.PI / 2).premultiply(M4().makeTranslation(s * .16, 0, 0)), c: rim });
  }
  return carParts.wheel = mergeGeos(parts);
}
function buildCar(def, paintHex, hero) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const sc = (t, n) => t.map(r => [r[0] * def.L, r[1] * def.W, r[2], r[3] * (n ? def.H : 1) + (n ? 0 : (r[3] - .4) * (def.H - 1) * .6), r[4]]);
  const paint = new (hero ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ color: col(paintHex), metalness: .55, roughness: .32, envMapIntensity: 1.25 });
  if (hero) { paint.clearcoat = 1; paint.clearcoatRoughness = .06; }
  const glass = new THREE.MeshStandardMaterial({ color: col(0x05070c), metalness: .9, roughness: .06, envMapIntensity: 1.6 });
  const carbon = new THREE.MeshStandardMaterial({ color: col(0x0b0b0e), metalness: .4, roughness: .55 });
  const body = new THREE.Mesh(loftGeo(sc(BODY, false), 24, 3), paint); g.add(body);
  const cabin = new THREE.Mesh(loftGeo(sc(CABIN, true), 20, 3), glass); g.add(cabin);
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
  const W = def.W, L = def.L;
  add(new THREE.BoxGeometry(1.9 * W, .1, 4.36 * L), carbon, 0, .17, 0);                               // floor / splitter
  add(new THREE.BoxGeometry(1.5 * W, .16, .12), carbon, 0, .33, -2.27 * L);                           // diffuser
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(.05, .2, .8), carbon, s * .985 * W, .47, -.55 * L); add(new THREE.BoxGeometry(.1, .05, 2.2 * L), carbon, s * .97 * W, .2, 0); }
  // wheels
  const wg = wheelGeo(), wm = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .5, roughness: .45 });
  const arch = new THREE.CylinderGeometry(.44, .44, .34, 18).rotateZ(Math.PI / 2), archM = new THREE.MeshBasicMaterial({ color: 0x020203 });
  const wheels = [];
  for (const [x, z, r] of [[.86, 1.4, 1], [-.86, 1.4, 1], [.87, -1.36, 1.05], [-.87, -1.36, 1.05]]) {
    add(arch, archM, x * W * .985, .36 * r, z * L);
    const piv = new THREE.Group(); piv.position.set(x * W, .36 * r, z * L); const w = new THREE.Mesh(wg, wm); w.scale.set(1, r, r); piv.add(w); g.add(piv); wheels.push({ piv, w, front: z > 0 });
  }
  // lights
  const head = glowMat(0xdfeaff, 3), tail = glowMat(0xff1430, 2.2);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(.34, .055, .3), head, s * .6 * W, .485, 2.06 * L, .32, s * .25, 0); add(new THREE.BoxGeometry(.5, .05, .06), tail, s * .5 * W, .685, -2.245 * L); }
  add(new THREE.BoxGeometry(1.7 * W, .02, .05), tail, 0, .745, -2.215 * L);
  // wing
  if (def.wing >= 2) { const y = def.wing === 3 ? 1.2 : 1.1; add(new THREE.BoxGeometry(1.78 * W, .045, .4), def.wing === 3 ? paint : carbon, 0, y, -2.0 * L, -.12);
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(.05, y - .78, .22), carbon, s * .55 * W, (y + .8) / 2, -1.95 * L); add(new THREE.BoxGeometry(.04, .22, .5), carbon, s * .89 * W, y + .03, -2.0 * L); } }
  else add(new THREE.BoxGeometry(1.6 * W, .05, .26), carbon, 0, .9, -2.12 * L, -.25);
  if (def.wing === 3) add(new THREE.BoxGeometry(.08, .34, 1.5), carbon, 0, 1.0 * def.H + .08, -.9 * L, -.16);           // spine fin
  // exhaust + nitro flames
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, 1.3, 3.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const fg = new THREE.ConeGeometry(.13, 1, 8, 1, true).translate(0, .5, 0).rotateX(-Math.PI / 2), flames = [];
  for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(.075, .075, .2, 10).rotateX(Math.PI / 2), carbon, s * .34 * W, .4, -2.27 * L);
    const f = add(fg, flameM, s * .34 * W, .4, -2.36 * L); f.visible = false; flames.push(f); }
  g.userData = { wheels, flames, tail: tail.userData.glow, paint, spin: 0 };
  return g;
}
// contact shadow + neon underglow, kept on the tarmac while the car flies
function buildGroundFx(accent, beams) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const off = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, depthWrite: false, transparent: true };
  const pl = (w, l, mat, z, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mat); m.position.set(0, y, z || 0); g.add(m); return m; };
  const sh = pl(3.3, 6.2, new THREE.MeshBasicMaterial(Object.assign({ map: TEX.shadow, color: 0x000000, opacity: .82 }, off)), 0, .05);
  const ug = pl(5.2, 8.2, new THREE.MeshBasicMaterial(Object.assign({ map: TEX.glow, color: col(accent).multiplyScalar(.6), blending: THREE.AdditiveBlending, fog: false }, off)), 0, .06);
  let bm = null; if (beams) { bm = pl(9, 26, new THREE.MeshBasicMaterial(Object.assign({ map: TEX.beam, color: col(0xcfe0ff).multiplyScalar(.2), blending: THREE.AdditiveBlending }, off)), 15.2, .07); bm.rotation.y = Math.PI; }
  g.userData = { sh, ug, bm }; return g;
}
function spinWheels(car, dist, steer) { const u = car.userData; u.spin += dist / .36; for (const w of u.wheels) { w.w.rotation.x = u.spin; if (w.front) w.piv.rotation.y = steer; } }
function setFlames(car, k, t) { for (const f of car.userData.flames) { f.visible = k > .03; if (f.visible) { const fl = .8 + .3 * Math.sin(t * 61 + f.position.x * 9) + .15 * Math.sin(t * 137); f.scale.set(.7 + k * .6, .7 + k * .6, k * 2.6 * fl); } } }

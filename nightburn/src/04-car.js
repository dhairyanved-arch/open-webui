// ===================================================================
// cars: lofted bodywork with cut wheel arches, glazed cabin, alloy wheels, lights
// ===================================================================
// Car space: +z forward, +y up, +x is the driver's LEFT.
// Section rows: [z, halfWidth, yBottom, yTop, topWidth, centreDip, squareness]
function loftGeo(secs, seg, sub, split) {
  const K = secs.length, rs = [];
  const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < sub; j++) {
    const t = j / sub, a = secs[Math.max(k - 1, 0)], b = secs[k], c = secs[k + 1], d = secs[Math.min(k + 2, K - 1)];
    rs.push(b.map((_, q) => cr(a[q], b[q], c[q], d[q], t)));
  }
  rs.push(secs[K - 1]);
  const R = rs.length, pos = [], idx = [[], []];
  for (const [z, w, y0, y1, tw, dip, n] of rs) for (let j = 0; j < seg; j++) {
    const th = (j + .5) / seg * TAU, c = Math.cos(th), s = Math.sin(th), yc = (y0 + y1) / 2, hh = (y1 - y0) / 2, e = 2 / n;
    const x = w * Math.sign(c) * Math.pow(Math.abs(c), e) * (s > 0 ? 1 - (1 - tw) * Math.pow(s, 1.4) : 1);
    let y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), e); if (s > 0) y -= dip * (1 - Math.min(1, (x / w) * (x / w))) * s;
    pos.push(x, y, z);
  }
  for (let a = 0; a < R - 1; a++) for (let j = 0; j < seg; j++) {
    const p00 = a * seg + j, p01 = a * seg + (j + 1) % seg, p10 = p00 + seg, p11 = p01 + seg;
    idx[split ? split((rs[a][0] + rs[a + 1][0]) / 2, Math.sin((j + 1) / seg * TAU)) : 0].push(p00, p01, p10, p01, p11, p10);
  }
  for (const [ring, front] of [[0, false], [R - 1, true]]) {   // end caps
    const base = pos.length / 3; let cy = 0; for (let j = 0; j < seg; j++) { const k = (ring * seg + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); cy += pos[k + 1]; }
    pos.push(0, cy / seg, rs[ring][0]); const cI = base + seg, into = idx[split ? 1 : 0];
    for (let j = 0; j < seg; j++) { const a = base + j, b = base + (j + 1) % seg; front ? into.push(cI, a, b) : into.push(cI, b, a); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx[0].concat(idx[1]));
  if (split) { g.addGroup(0, idx[0].length, 0); g.addGroup(idx[0].length, idx[1].length, 1); }
  g.computeVertexNormals(); return g;
}
const BODY = [[-2.30, .70, .40, .66, .94, 0, 3.2], [-2.22, .93, .30, .80, .93, -.02, 3.6], [-1.90, 1.0, .20, .88, .90, -.03, 4], [-1.36, 1.01, .15, .90, .86, -.02, 4],
  [-.70, .97, .14, .84, .84, 0, 4], [0, .95, .14, .77, .84, .03, 4], [.70, .96, .14, .76, .85, .07, 4], [1.40, .99, .15, .82, .87, .13, 3.8],
  [1.90, .95, .18, .66, .88, .10, 3.4], [2.20, .86, .22, .50, .90, .05, 3], [2.36, .66, .27, .40, .90, 0, 2.8]];
const CABIN = [[-1.75, .50, .76, .82, .80, 0, 3], [-1.20, .68, .74, .98, .74, 0, 3], [-.55, .74, .72, 1.10, .68, 0, 3], [.05, .75, .70, 1.12, .68, 0, 3],
  [.60, .73, .66, .98, .72, 0, 3], [1.05, .68, .62, .78, .80, 0, 3], [1.35, .58, .58, .64, .86, 0, 3]];
// 0 = glass, 1 = painted metal (roof, pillars, buttresses)
const cabinSplit = L => (z, sn) => {
  z /= L; if (sn < .05) return 1;
  const top = sn > .78, corner = sn > .5 && !top;
  if (z > .12) return corner && z < 1.15 ? 1 : 0;
  if (z > -.95) return top || corner ? 1 : (z > -.72 ? 0 : 1);
  if (z > -1.5) return top ? 0 : 1;
  return 1;
};

const carParts = {};
function wheelGeo() {
  if (carParts.wheel) return carParts.wheel;
  const rub = col(0x070708), rimC = col(0x30333b), lip = col(0xa4a8b2), disc = col(0x5a5d66), parts = [], rz = M4().makeRotationZ(-Math.PI / 2);
  const lathe = (pts, c) => parts.push({ g: new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 30), m: rz, c });
  lathe([[.235, -.15], [.325, -.15], [.352, -.125], [.36, -.07], [.36, .07], [.352, .125], [.325, .15], [.235, .15]], rub);    // tyre with rounded shoulders
  lathe([[.235, .15], [.222, .11], [.222, -.11], [.235, -.15]], rimC);                                                            // rim barrel
  parts.push({ g: new THREE.CylinderGeometry(.19, .19, .025, 22), m: rz, c: disc });                                              // brake disc
  parts.push({ g: new THREE.CylinderGeometry(.052, .052, .3, 12), m: rz, c: rimC });
  for (const s of [-1, 1]) {
    parts.push({ g: new THREE.TorusGeometry(.232, .012, 6, 30), m: M4().makeTranslation(s * .148, 0, 0).multiply(M4().makeRotationY(Math.PI / 2)), c: lip });
    parts.push({ g: new THREE.CylinderGeometry(.032, .032, .012, 10), m: M4().makeTranslation(s * .152, 0, 0).multiply(rz), c: lip });
    for (let k = 0; k < 5; k++) for (const o of [-.15, .15])   // five split spokes
      parts.push({ g: new THREE.BoxGeometry(.028, .215, .026), m: M4().makeTranslation(s * .136, 0, 0).multiply(M4().makeRotationX(k / 5 * TAU + o)).multiply(M4().makeTranslation(0, .125, 0)), c: rimC });
  }
  return carParts.wheel = mergeGeos(parts);
}
// cuts the wheel openings out of the painted skin
function archify(mat, def) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uArch = { value: new THREE.Vector4(1.40 * def.L, -1.36 * def.L, .34, .36) };
    sh.vertexShader = 'varying vec3 vCarP; varying vec3 vCarN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarP = position; vCarN = normal;');
    sh.fragmentShader = 'uniform vec4 uArch; varying vec3 vCarP; varying vec3 vCarN;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (abs(vCarN.x) > .42 && abs(vCarP.x) > .4 && vCarP.y < .9) { vec2 a = vCarP.yz - vec2(uArch.z, uArch.x), b = vCarP.yz - vec2(uArch.w, uArch.y); float ra = uArch.z + .06, rb = uArch.w + .06; if (dot(a, a) < ra * ra || dot(b, b) < rb * rb) discard; }');
  };
}
function buildCar(def, paintHex, hero) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const W = def.W, L = def.L, H = def.H, none = new THREE.Color(0, 0, 0);
  const sc = (t, cab) => t.map(r => [r[0] * L, r[1] * W, r[2], cab ? .7 + (r[3] - .7) * H : r[3], r[4], r[5], r[6]]);
  const paint = new (hero ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ color: col(paintHex), metalness: .38, roughness: .3, envMapIntensity: 1.15 });
  if (hero) { paint.clearcoat = 1; paint.clearcoatRoughness = .05; }
  archify(paint, def);
  const glass = new THREE.MeshStandardMaterial({ color: col(0x04060a), metalness: .85, roughness: .05, envMapIntensity: 1.7 });
  const trimM = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .35, roughness: .45, envMapIntensity: .9 });
  const blackM = new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.BackSide });
  const head = glowMat(0xe4edff, 3), tail = glowMat(0xff1028, 2);
  const P = { paint: [], trim: [], black: [], head: [], tail: [] };
  const carbon = col(0x0b0b0f), gloss = col(0x050506), chrome = col(0x6c7078), red = col(0xc8101e), plate = col(0xb9b9c0);
  const at = (x, y, z, rx, ry, rz) => { const m = M4().makeTranslation(x, y, z); if (rx || ry || rz) m.multiply(M4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0))); return m; };
  const box = (list, sx, sy, sz, x, y, z, c, rx, ry, rz) => list.push({ g: new THREE.BoxGeometry(sx, sy, sz), m: at(x, y, z, rx, ry, rz), c: c || none });
  const tube = (list, r, len, x, y, z, c, alongX, open) => list.push({ g: new THREE.CylinderGeometry(r, r, len, 20, 1, !!open), m: at(x, y, z, alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0), c: c || none });

  P.paint.push({ g: loftGeo(sc(BODY, false), 28, 4), m: null, c: none });
  // underbody, aero and trim
  box(P.trim, 1.3 * W, .06, 4.3 * L, 0, .15, 0, carbon);
  box(P.trim, 1.62 * W, .03, .3, 0, .135, 2.2 * L, carbon);                       // splitter
  box(P.trim, 1.2 * W, .1, .08, 0, .29, 2.338 * L, gloss);                         // nose intake
  box(P.trim, 1.3 * W, .19, .05, 0, .55, -2.3 * L, gloss);                         // rear fascia
  box(P.trim, 1.38 * W, .13, .3, 0, .26, -2.15 * L, carbon);                      // diffuser
  for (let k = -2; k <= 2; k++) box(P.trim, .02, .13, .3, k * .26 * W, .245, -2.165 * L, carbon);
  box(P.trim, .34, .085, .02, 0, .385, -2.345 * L, plate);
  for (const s of [-1, 1]) {
    box(P.trim, .07, .07, 1.95 * L, s * .95 * W, .165, .02 * L, carbon);            // sill
    box(P.trim, .05, .25, .56, s * .968 * W, .52, -.6 * L, gloss, 0, s * -.06, 0);  // side intake
    box(P.trim, .11, .02, .05, s * .82 * W, .77, .62 * L, carbon); box(P.paint, .15, .09, .1, s * .9 * W, .8, .6 * L);   // mirror
    tube(P.trim, .045, .12, s * .12 * W, .5, -2.32 * L, chrome);                    // exhaust tips
    box(P.trim, .38, .07, .27, s * .6 * W, .505, 2.12 * L, gloss, .42, s * .3, 0);  // headlamp housing
    box(P.head, .3, .022, .05, s * .6 * W, .552, 2.08 * L, null, .42, s * .3, 0);   // running light
    box(P.head, .06, .045, .06, s * .54 * W, .492, 2.215 * L); box(P.head, .06, .045, .06, s * .665 * W, .498, 2.185 * L);
    box(P.tail, .3, .055, .04, s * .5 * W, .6, -2.332 * L);
    for (const [z, r, front] of [[1.40, .34, 1], [-1.36, .36, 0]]) {
      tube(P.black, r + .07, .47 * W, s * .735 * W, r, z * L, null, true, true);    // wheel well (seen from inside only)
      P.trim.push({ g: new THREE.CircleGeometry(r + .07, 20), m: at(s * .5 * W, r, z * L, 0, s * Math.PI / 2, 0), c: gloss });
      box(P.trim, .05, .1, .15, s * ((front ? .86 : .87) * W + .05), r + .06, z * L - .15, red, .5);   // brake caliper
    }
  }
  box(P.tail, 1.34 * W, .03, .04, 0, .655, -2.316 * L);
  // rear wing
  if (def.wing >= 2) { const y = def.wing === 3 ? 1.22 : 1.12; box(def.wing === 3 ? P.paint : P.trim, 1.78 * W, .04, .4, 0, y, -2.0 * L, carbon, -.12);
    for (const s of [-1, 1]) { box(P.trim, .04, y - .78, .2, s * .52 * W, (y + .8) / 2, -1.95 * L, carbon); box(P.trim, .035, .2, .48, s * .89 * W, y + .03, -2.0 * L, carbon); } }
  else box(P.paint, 1.56 * W, .04, .24, 0, .875, -2.14 * L, null, -.3);
  if (def.wing === 3) box(P.trim, .06, .3, 1.4, 0, .7 + .42 * H, -.95 * L, carbon, -.17);

  const mesh = (list, mat) => { const m = new THREE.Mesh(mergeGeos(list), mat); g.add(m); return m; };
  mesh(P.paint, paint); mesh(P.trim, trimM); mesh(P.black, blackM); mesh(P.head, head); mesh(P.tail, tail);
  g.add(new THREE.Mesh(loftGeo(sc(CABIN, true), 28, 5, cabinSplit(L)), [glass, paint]));
  // wheels
  const wg = wheelGeo(), wm = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .45, roughness: .42, envMapIntensity: .9 }), wheels = [];
  for (const [x, z, r] of [[.86, 1.40, .34], [-.86, 1.40, .34], [.87, -1.36, .36], [-.87, -1.36, .36]]) {
    const piv = new THREE.Group(); piv.position.set(x * W, r, z * L); const w = new THREE.Mesh(wg, wm); w.scale.set(1, r / .36, r / .36); piv.add(w); g.add(piv); wheels.push({ piv, w, front: z > 0 });
  }
  // nitro flames
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, 1.3, 3.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const fg = new THREE.ConeGeometry(.1, 1, 8, 1, true).translate(0, .5, 0).rotateX(-Math.PI / 2), flames = [];
  for (const s of [-1, 1]) { const f = new THREE.Mesh(fg, flameM); f.position.set(s * .13 * W, .5, -2.42 * L); f.visible = false; g.add(f); flames.push(f); }
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

// ===================================================================
// world: renderer + post, textures, sky, track, terrain and scenery
// ===================================================================
const gfx = { renderer: null, composer: null, renderPass: null, bloom: null, fin: null, post: false, hdr: false, autoLow: false,
  pr: 1, prMax: 2, prMin: .55, w: 1, h: 1, maxAniso: 1, acc: 0, frames: 0, glows: [], time: 0 };

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, blur: { value: 0 }, vig: { value: .9 }, exposure: { value: 1.2 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float blur, vig, exposure, time; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
    void main(){
      vec2 d = vUv - vec2(.5,.47);
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (blur > .01) {
        float s = blur*.075;
        vec3 a = c;
        a += texture2D(tDiffuse, vUv - d*s*.3).rgb;
        a += texture2D(tDiffuse, vUv - d*s*.6).rgb;
        a += texture2D(tDiffuse, vUv - d*s*.9).rgb;
        a += texture2D(tDiffuse, vUv - d*s*1.2).rgb;
        c = a*.2;
        c.r = mix(c.r, texture2D(tDiffuse, vUv - d*s*1.9).r, .4);
      }
      c = aces(max(c,0.)*exposure);
      c = pow(c, vec3(1./2.2));
      c *= 1. - vig*dot(d,d)*1.25;
      c += (fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898,78.233)))*43758.5453)-.5)/170.;
      gl_FragColor = vec4(c,1.);
    }`,
};

function initGfx() {
  const r = gfx.renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  r.outputEncoding = THREE.sRGBEncoding; r.setClearColor(0x05030d, 1);
  gfx.maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy());
  gfx.prMax = clamp(window.devicePixelRatio || 1, 1.25, 2);
  gfx.pr = Math.min(gfx.prMax, 1.6);
  if (THREE.EffectComposer && THREE.UnrealBloomPass && THREE.ShaderPass && THREE.RenderPass) {
    try {
      gfx.hdr = r.capabilities.isWebGL2 && !!(r.extensions.get('EXT_color_buffer_float') || r.extensions.get('EXT_color_buffer_half_float'));
      const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
        type: gfx.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, stencilBuffer: false });
      const c = gfx.composer = new THREE.EffectComposer(r, rt);
      gfx.renderPass = new THREE.RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera()); c.addPass(gfx.renderPass);
      gfx.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), .9, .55, gfx.hdr ? 1.0 : .82); c.addPass(gfx.bloom);
      gfx.fin = new THREE.ShaderPass(FinalShader); c.addPass(gfx.fin);
    } catch (e) { gfx.composer = null; }
  }
  applyQuality(); resize();
  addEventListener('resize', resize);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
}
function resize() {
  const b = $('app').getBoundingClientRect(), w = Math.max(1, Math.round(b.width)), h = Math.max(1, Math.round(b.height));
  gfx.w = w; gfx.h = h; const r = gfx.renderer;
  r.setPixelRatio(gfx.pr); r.setSize(w, h, false);
  if (gfx.composer) { const ew = Math.floor(w * gfx.pr), eh = Math.floor(h * gfx.pr); gfx.composer.setSize(ew, eh); gfx.bloom.setSize(ew * .5, eh * .5); }
}
function applyQuality() {
  const q = save.quality, was = gfx.post;
  gfx.post = !!gfx.composer && (q === 'high' || (q === 'auto' && !gfx.autoLow));
  gfx.prMin = q === 'high' ? .8 : .55;
  if (q === 'low') gfx.pr = Math.min(gfx.pr, 1.25);
  const r = gfx.renderer;
  r.toneMapping = gfx.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  applyGlow();
  if (was !== gfx.post) for (const s of [show && show.scene, race && race.T && race.T.scene]) if (s) s.traverse(o => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  resize();
}
// emissive materials are over-driven in HDR so that only real light sources bloom
function glowMat(hex, k, opts) {
  const m = new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff }, opts || {}));
  const g = { mat: m, base: col(hex), k: k || 2 }; gfx.glows.push(g); setGlow(g); m.userData.glow = g; return m;
}
function setGlow(g) { g.mat.color.copy(g.base).multiplyScalar(gfx.post && gfx.hdr ? g.k : Math.min(g.k, 1.15)); }
function applyGlow() { gfx.glows.forEach(setGlow); }
function dropGlows(scene) { const dead = new Set(); scene.traverse(o => { if (o.material && o.material.userData && o.material.userData.glow) dead.add(o.material.userData.glow); }); gfx.glows = gfx.glows.filter(g => !dead.has(g)); }
function renderScene(scene, camera, exposure, blur, bloomK) {
  if (gfx.post) {
    gfx.renderPass.scene = scene; gfx.renderPass.camera = camera;
    gfx.fin.uniforms.exposure.value = exposure; gfx.fin.uniforms.blur.value = blur; gfx.fin.uniforms.time.value = gfx.time % 10;
    gfx.bloom.strength = bloomK; gfx.composer.render();
  } else { gfx.renderer.toneMappingExposure = exposure * .82; gfx.renderer.render(scene, camera); }
}
// dynamic resolution: keep the frame time healthy on phones
function perfTick(dt) {
  gfx.acc += dt; gfx.frames++;
  if (gfx.frames < 50) return;
  const avg = gfx.acc / gfx.frames; gfx.acc = 0; gfx.frames = 0;
  if (avg > .024 && gfx.pr > gfx.prMin + .01) { gfx.pr = Math.max(gfx.prMin, gfx.pr * .86); resize(); }
  else if (avg > .034 && save.quality === 'auto' && gfx.post) { gfx.autoLow = true; applyQuality(); }
  else if (avg < .0125 && gfx.pr < gfx.prMax - .01 && save.quality !== 'low') { gfx.pr = Math.min(gfx.prMax, gfx.pr * 1.08); resize(); }
}

// ---------------- textures ----------------
function canvasTex(w, h, draw, o) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); o = o || {};
  if (o.srgb !== false) t.encoding = THREE.sRGBEncoding;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = o.aniso ? gfx.maxAniso : 1; return t;
}
const TEX = {};
function initTextures() {
  TEX.glow = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  TEX.shadow = canvasTex(64, 128, (g, w, h) => { const im = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const qx = Math.max(Math.abs(x - w / 2 + .5) - (w / 2 - 22), 0), qy = Math.max(Math.abs(y - h / 2 + .5) - (h / 2 - 22), 0), k = (y * w + x) * 4; im.data[k + 3] = 255 * smooth(21, 4, Math.hypot(qx, qy)); } g.putImageData(im, 0, 0); });
  TEX.beam = canvasTex(128, 256, (g, w, h) => { const r = g.createLinearGradient(0, h, 0, 0); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.4, 'rgba(255,255,255,.3)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.beginPath(); g.moveTo(w * .3, h); g.lineTo(w * .7, h); g.lineTo(w, 0); g.lineTo(0, 0); g.fill();
    const s = g.createLinearGradient(0, 0, w, 0); s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(.25, 'rgba(0,0,0,0)'); s.addColorStop(.75, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = s; g.fillRect(0, 0, w, h); });
  TEX.checker = canvasTex(256, 64, (g, w, h) => { const n = 16, s = w / n; for (let y = 0; y < h / s; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#f4f4f8' : '#101014'; g.fillRect(x * s, y * s, s, s); } });
  TEX.chevron = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#0a0a10'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineJoin = 'miter';
    for (const x of [18, 62]) { g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 42, 64); g.lineTo(x, 110); g.stroke(); } });
  TEX.ramp = canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#12101c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 12;
    for (let y = 30; y < h + 60; y += 60) { g.beginPath(); g.moveTo(12, y); g.lineTo(w / 2, y - 40); g.lineTo(w - 12, y); g.stroke(); } g.fillStyle = '#fff'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h); });
  TEX.banner = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = '#0b0818'; g.fillRect(0, 0, w, h); const s = 32; for (let x = 0; x < w / s; x++) for (let y = 0; y < 2; y++) if ((x + y) % 2) { g.fillStyle = '#fff'; g.fillRect(x * s, y ? h - s : 0, s, s); }
    g.font = 'italic 700 58px "Chakra Petch", "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffb400'; g.fillText('NIGHTBURN  ·  START / FINISH', w / 2, h / 2 + 3); });
  const board = (a, b, c1, c2) => canvasTex(512, 192, (g, w, h) => { g.fillStyle = '#07050f'; g.fillRect(0, 0, w, h); g.strokeStyle = c2; g.lineWidth = 6; g.strokeRect(9, 9, w - 18, h - 18);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = c1; g.font = 'italic 700 92px "Chakra Petch", "Trebuchet MS", sans-serif'; g.fillText(a, w / 2, 78);
    g.fillStyle = c2; g.font = '600 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText(b, w / 2, 150); });
  TEX.boards = [board('NIGHTBURN', 'S T R E E T   R A C I N G', '#ff2e7e', '#19e3ff'), board('VOLT N2O', 'B U R N   B R I G H T E R', '#19e3ff', '#ffb400'), board('APEX TYRES', 'G R I P   T H E   N I G H T', '#ffb400', '#ff2e7e')];
  TEX.rough = canvasTex(256, 256, (g, w, h) => { const im = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / 28, y / 28, 3), v = 255 * clamp(.3 + smooth(.42, .62, n) * .5, 0, 1), k = (y * w + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; } g.putImageData(im, 0, 0); }, { srgb: false, repeat: true });
}
function roadTex(base) {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h); const r = rng(5);
    for (let i = 0; i < 5200; i++) { g.fillStyle = r() > .5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.14)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 3); }
    for (const x of [36, 96, 160, 220]) { const gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 14, 0, 28, h); }
    g.fillStyle = '#e4e6ee'; g.fillRect(7, 0, 5, h); g.fillRect(w - 12, 0, 5, h);
    for (const x of [66, 190]) g.fillRect(x - 2, 0, 4, h * .38);
    g.fillStyle = '#ffb81f'; g.fillRect(126, 0, 4, h * .38);
  }, { repeat: true, aniso: true });
}

// ---------------- geometry helpers ----------------
function mergeGeos(parts) {
  let n = 0; const gs = parts.map(p => { const g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); if (p.m) g.applyMatrix4(p.m); n += g.attributes.position.count; return g; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cl = new Float32Array(n * 3); let o = 0;
  gs.forEach((g, k) => { const c = parts[k].c, cnt = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < cnt; i++) { cl[(o + i) * 3] = c.r; cl[(o + i) * 3 + 1] = c.g; cl[(o + i) * 3 + 2] = c.b; } o += cnt; g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  return out;
}
const M4 = () => new THREE.Matrix4();
const UNIT_BOX = () => new THREE.BoxGeometry(1, 1, 1);
class Batch {   // collects instances, then emits one InstancedMesh
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.m = []; this.c = []; }
  add(matrix, color) { this.m.push(matrix.clone()); this.c.push(color || null); }
  build(scene) {
    if (!this.m.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((m, i) => { mesh.setMatrixAt(i, m); if (this.c[i]) mesh.setColorAt(i, this.c[i]); });
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; scene.add(mesh); return mesh;
  }
}

// ---------------- themes ----------------
const THEMES = {
  city: { skyTop: 0x04030c, skyMid: 0x190b3a, skyHor: 0x3c1454, sun: 0xd4dcff, cloud: 0x4a2260, sunDir: [-.45, .42, .79], sunSize: .03, sunGlow: .3, stars: 1, clouds: .4, aurora: 0,
    fogNear: 90, fogFar: 980, hemiSky: 0x7a6ad8, hemiGnd: 0x1c1030, hemiI: .8, dir: 0xa8b6ff, dirI: .6, accL: 0xff2e7e, accR: 0x19e3ff, accA: 0xffb400,
    road: '#18171e', wet: true, night: true, exposure: 1.3, bloom: 1.0, wall: 0x2a2738, lamp: 0xffc890 },
  coast: { skyTop: 0x222d6c, skyMid: 0xc4587c, skyHor: 0xff9c5a, sun: 0xffe6b8, cloud: 0x7a3a66, sunDir: [.3, .13, .94], sunSize: .06, sunGlow: 1, stars: .12, clouds: .65, aurora: 0,
    fogNear: 160, fogFar: 1800, hemiSky: 0xffc4a8, hemiGnd: 0x4a3058, hemiI: .95, dir: 0xffb476, dirI: 1.35, accL: 0xffb400, accR: 0xff2e7e, accA: 0x19e3ff,
    road: '#2c2a31', wet: false, night: false, exposure: 1.12, bloom: .62, wall: 0x6a5560, lamp: 0xffd0a0 },
  snow: { skyTop: 0x01040c, skyMid: 0x06203c, skyHor: 0x14405e, sun: 0xeaf5ff, cloud: 0x123048, sunDir: [.5, .5, -.7], sunSize: .042, sunGlow: .45, stars: 1, clouds: .18, aurora: 1,
    fogNear: 80, fogFar: 1050, hemiSky: 0x86c0f0, hemiGnd: 0x1a2c40, hemiI: .85, dir: 0xc4e4ff, dirI: .75, accL: 0x19e3ff, accR: 0xb6ff3c, accA: 0xff2e7e,
    road: '#1d2128', wet: true, night: true, exposure: 1.3, bloom: .95, wall: 0x3a4658, lamp: 0xcfeaff },
  studio: { skyTop: 0x030208, skyMid: 0x0d0822, skyHor: 0x1c0d34, sun: 0xffffff, cloud: 0, sunDir: [0, 1, 0], sunSize: .001, sunGlow: 0, stars: 0, clouds: 0, aurora: 0 },
};
function makeSky(th, radius) {
  const v = a => new THREE.Vector3(a[0], a[1], a[2]).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { cTop: { value: col(th.skyTop) }, cMid: { value: col(th.skyMid) }, cHor: { value: col(th.skyHor) }, cSun: { value: col(th.sun) }, cCloud: { value: col(th.cloud) },
      sunDir: { value: v(th.sunDir) }, sunSize: { value: th.sunSize }, sunGlow: { value: th.sunGlow }, stars: { value: th.stars }, aurora: { value: th.aurora }, clouds: { value: th.clouds }, time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 cTop,cMid,cHor,cSun,cCloud,sunDir; uniform float sunSize,sunGlow,stars,aurora,clouds,time; varying vec3 vDir;
      float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
      float fbm(vec2 p){ return .5*vn(p)+.25*vn(p*2.1+3.)+.125*vn(p*4.3+7.); }
      void main(){
        vec3 d=normalize(vDir); float y=d.y;
        vec3 c=mix(cHor,cMid,smoothstep(0.,.28,y)); c=mix(c,cTop,smoothstep(.18,.8,y));
        float sd=max(dot(d,sunDir),0.); float ang=acos(min(sd,1.));
        if(stars>0. && y>.02){ vec2 sp=d.xz/(y+.6)*90.; vec2 id=floor(sp); float r=h21(id); vec2 o=fract(sp)-.5-(vec2(h21(id+3.1),h21(id+7.7))-.5)*.6;
          float s=step(.93,r)*(1.-smoothstep(.02,.1+r*.08,length(o))); c+=vec3(.8,.9,1.)*s*stars*smoothstep(.02,.3,y)*(.6+.4*sin(time*2.+r*40.)); }
        if(aurora>0. && y>.05){ vec2 ap=d.xz/(y+.25); float w=fbm(vec2(ap.x*1.2+time*.02, ap.y*.35)); float band=smoothstep(.4,.56,w)*(1.-smoothstep(.56,.8,w));
          float cur=.5+.5*sin(ap.x*14.+w*20.+time*.3); vec3 ac=mix(vec3(.1,1.,.55),vec3(.3,.45,1.),smoothstep(.2,.9,y));
          c+=ac*band*(.45+.55*cur)*aurora*smoothstep(.05,.3,y)*(1.-smoothstep(.6,.95,y))*1.3; }
        if(clouds>0. && y>0.){ vec2 cp=d.xz/(y+.18); float n=fbm(cp*1.3+vec2(time*.004,0.)); float m=smoothstep(.42,.72,n)*smoothstep(0.,.12,y)*clouds;
          c=mix(c, mix(cCloud,cSun,pow(sd,5.)*.75), m); }
        float disc=1.-smoothstep(sunSize*.9,sunSize,ang);
        c+=cSun*(disc*2.6+sunGlow*(pow(sd,24.)*.45+pow(sd,200.)*1.3));
        c=mix(c,cHor,smoothstep(.0,-.04,y));
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false; return mesh;
}
function makeEnv(th, panels) {
  const s = new THREE.Scene(); s.add(makeSky(th, 180));
  (panels || []).forEach(p => { const m = new THREE.Mesh(new THREE.BoxGeometry(p[3], p[4], p[5]), new THREE.MeshBasicMaterial({ color: col(p[6]).multiplyScalar(p[7]), side: THREE.DoubleSide })); m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); s.add(m); });
  const pm = new THREE.PMREMGenerator(gfx.renderer); const rt = pm.fromScene(s, 0.035, 1, 600); pm.dispose();
  s.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt;
}
function buildingMat(th) {
  return new THREE.ShaderMaterial({
    fog: true, extensions: { derivatives: true },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { cBase: { value: col(0x0b0915) }, cA: { value: col(th.accL).lerp(col(0xffd9a0), .55) }, cB: { value: col(th.accR).lerp(col(0xbfe0ff), .5) }, k: { value: 1 } }]),
    vertexShader: `
      varying vec3 vP; varying vec3 vN; varying vec3 vS; varying float vD;
      #include <fog_pars_vertex>
      void main(){
        vec3 sc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vP=position*sc; vP.y+=sc.y*.5; vN=normal; vS=instanceColor;
        vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.0); vD=-mvPosition.z;
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 cBase,cA,cB; uniform float k; varying vec3 vP; varying vec3 vN; varying vec3 vS; varying float vD;
      #include <fog_pars_fragment>
      float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){
        vec3 c=cBase;
        if(abs(vN.y)<.5){
          float side=abs(vN.x)>.5?1.:0.; vec2 g=vec2(mix(vP.x,vP.z,side),vP.y)/vec2(4.4,4.2); vec2 id=floor(g), f=fract(g);
          vec2 fw=fwidth(g); float lod=smoothstep(.2,.65,max(fw.x,fw.y));
          float win=step(.14,f.x)*step(f.x,.86)*step(.3,f.y)*step(f.y,.82);
          float r=h21(id+vS.x*91.7+side*13.); float lit=step(1.-vS.z,r)*step(.3,h21(vec2(id.y,vS.x*7.3)));
          vec3 wc=mix(cA,cB,step(.5,h21(vec2(id.y,vS.x*5.)+.3)));
          vec3 near=cBase+win*(lit*wc*(.3+.65*r)*k+(1.-lit)*vec3(.012,.014,.03));
          vec3 far=cBase+mix(cA,cB,.5)*vS.z*.16*k;
          c=mix(near,far,lod);
        }
        gl_FragColor=vec4(c,1.);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
}

// ---------------- scenery primitives ----------------
function palmGeo() {
  const parts = [], tc = col(0x5c4028), l1 = col(0x2c6e34), l2 = col(0x3d8c3c); let x = 0;
  for (let k = 0; k < 4; k++) { parts.push({ g: new THREE.CylinderGeometry(.2 - .025 * k, .25 - .025 * k, 2.4, 6), m: M4().makeTranslation(x, 1.15 + k * 2.25, 0), c: tc }); x += .16 * (k + 1); }
  for (let k = 0; k < 8; k++) { const g = new THREE.ConeGeometry(.6, 4, 4); g.translate(0, 2, 0);
    parts.push({ g, m: M4().makeTranslation(x - .16, 9.1, 0).multiply(M4().makeRotationY(k / 8 * TAU)).multiply(M4().makeRotationZ(-1.25 - (k % 2) * .5)).multiply(M4().makeScale(.16, 1, 1)), c: k % 2 ? l1 : l2 }); }
  return mergeGeos(parts);
}
function pineGeo() {
  const parts = [{ g: new THREE.CylinderGeometry(.16, .24, 1.8, 5), m: M4().makeTranslation(0, .9, 0), c: col(0x3a2a20) }];
  [[2.0, 3.2, 2.9, 0x143b2c], [1.5, 2.8, 4.7, 0x1b4a36], [1.0, 2.4, 6.3, 0xa9c8d8]].forEach(([r, h, y, c]) => parts.push({ g: new THREE.ConeGeometry(r, h, 7), m: M4().makeTranslation(0, y, 0), c: col(c) }));
  return mergeGeos(parts);
}

// ---------------- track ----------------
function buildTrack(def) {
  const th = THEMES[def.theme], rnd = rng(def.seed * 7919 + 13), hw = 9;
  const T = { def, th, hw, ramps: [], pickups: [], scene: new THREE.Scene(), tick: [] };
  const scene = T.scene;

  // --- centreline: polar blob with harmonics, resampled to even 3 m steps ---
  const M = 7200, fx = new Float64Array(M + 1), fy = new Float64Array(M + 1), fz = new Float64Array(M + 1), cum = new Float64Array(M + 1), dir = def.rev ? -1 : 1;
  for (let k = 0; k <= M; k++) {
    const a = dir * k / M * TAU;
    const r = def.R * (1 + def.h2 * Math.cos(2 * a + def.p2) + def.h3 * Math.cos(3 * a + def.p3) + def.h5 * Math.cos(5 * a + def.p5) + def.h7 * Math.cos(7 * a + def.p7));
    fx[k] = Math.cos(a) * r * def.sx; fz[k] = Math.sin(a) * r * def.sz;
    fy[k] = def.H * (.6 * Math.sin(2 * a + def.q2) + .4 * Math.sin(3 * a + def.q3) + .22 * Math.sin(5 * a + def.q5));
    if (k) cum[k] = cum[k - 1] + Math.hypot(fx[k] - fx[k - 1], fy[k] - fy[k - 1], fz[k] - fz[k - 1]);
  }
  const L = cum[M], N = Math.round(L / 3), step = L / N;
  let px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0, k = 0; i < N; i++) { const t = i * step; while (cum[k + 1] < t) k++; const f = (t - cum[k]) / (cum[k + 1] - cum[k]); px[i] = lerp(fx[k], fx[k + 1], f); py[i] = lerp(fy[k], fy[k + 1], f); pz[i] = lerp(fz[k], fz[k + 1], f); }
  const head = new Float32Array(N), kap = new Float32Array(N), ty = new Float32Array(N), sb = new Float32Array(N), hl = new Float32Array(N);
  const frames = () => {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a]; head[i] = Math.atan2(dx, dz); ty[i] = dy / Math.hypot(dx, dy, dz); hl[i] = Math.hypot(px[b] - px[i], pz[b] - pz[i]); }
    for (let i = 0; i < N; i++) raw[i] = angDiff(head[(i + 1) % N], head[(i + N - 1) % N]) / (2 * step);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -5; k <= 5; k++) s += raw[(i + k + N) % N]; kap[i] = s / 11; sb[i] = Math.sin(clamp(kap[i] * 9, -.17, .17)); }
  };
  frames();
  // put the start line on the calmest stretch
  let i0 = 0, bestK = 1e9;
  for (let i = 0; i < N; i += 4) { let m = 0; for (let k = -50; k <= 110; k += 5) m = Math.max(m, Math.abs(kap[(i + k + N) % N])); if (m < bestK) { bestK = m; i0 = i; } }
  const rot = a => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = a[(i + i0) % N]; return o; };
  px = rot(px); py = rot(py); pz = rot(pz); frames();
  Object.assign(T, { N, L, step, px, py, pz, head, kap, sb, ty, hl });
  let minY = 1e9, maxKap = 0; for (let i = 0; i < N; i++) { minY = Math.min(minY, py[i]); maxKap = Math.max(maxKap, Math.abs(kap[i])); }
  T.minRadius = 1 / maxKap;

  // --- queries ---
  T.at = (s, d, out) => {
    s = ((s % L) + L) % L; const fi = s / step, i = Math.floor(fi) % N, j = (i + 1) % N, f = fi - Math.floor(fi), h = head[i] + angDiff(head[j], head[i]) * f;
    out.x = lerp(px[i], px[j], f) - Math.cos(h) * d; out.z = lerp(pz[i], pz[j], f) + Math.sin(h) * d; out.th = h; out.idx = i; out.f = f; return out;
  };
  T.ground = (i, f, d, s) => {
    const j = (i + 1) % N; let y = lerp(py[i], py[j], f) + d * lerp(sb[i], sb[j], f);
    for (const r of T.ramps) { const ds = s - r.s0; if (ds >= 0 && ds <= r.len && Math.abs(d - r.d0) < r.w) { y += r.h * ds / r.len; break; } }
    return y;
  };
  T.project = c => {
    let best = c.idx, bd = 1e18;
    for (let k = -12; k <= 12; k++) { const i = (c.idx + k + N) % N, dx = c.x - px[i], dz = c.z - pz[i], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
    let i = best, sh = Math.sin(head[i]), ch = Math.cos(head[i]), along = (c.x - px[i]) * sh + (c.z - pz[i]) * ch;
    if (along < 0) { i = (i - 1 + N) % N; sh = Math.sin(head[i]); ch = Math.cos(head[i]); along = (c.x - px[i]) * sh + (c.z - pz[i]) * ch; }
    const f = clamp(along / hl[i], 0, 1), j = (i + 1) % N, h = head[i] + angDiff(head[j], head[i]) * f;
    c.idx = i; c.f = f; c.th = h; c.s = (i + f) * step;
    c.d = (c.x - lerp(px[i], px[j], f)) * -Math.cos(h) + (c.z - lerp(pz[i], pz[j], f)) * Math.sin(h);
  };
  // frame matrix at sample i, lateral d (right positive), height h — right-handed basis (left, up, forward)
  const vR = new THREE.Vector3(), vU = new THREE.Vector3(), vT = new THREE.Vector3(), vL = new THREE.Vector3(), vP = new THREE.Vector3();
  const basis = i => {
    i = ((i % N) + N) % N; const h = head[i], cb = Math.sqrt(1 - sb[i] * sb[i]), a = (i + N - 1) % N, b = (i + 1) % N;
    vT.set(px[b] - px[a], py[b] - py[a], pz[b] - pz[a]).normalize();
    vR.set(-Math.cos(h) * cb, sb[i], Math.sin(h) * cb); vU.crossVectors(vR, vT).normalize(); vR.crossVectors(vT, vU).normalize();
    vP.set(px[i], py[i], pz[i]); return i;
  };
  const frame = (i, d, h, out) => { basis(i); vL.copy(vR).negate(); out = out || M4(); out.makeBasis(vL, vU, vT); out.setPosition(vP.x + vR.x * d + vU.x * h, vP.y + vR.y * d + vU.y * h, vP.z + vR.z * d + vU.z * h); return out; };
  T.frame = frame;
  const ribbon = (d0, h0, d1, h1, vLen) => {
    const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = new Uint16Array(N * 6), reps = Math.max(1, Math.round(L / (vLen || 16)));
    for (let r = 0; r <= N; r++) {
      basis(r); const o = r * 6, v = r / N * reps;
      pos[o] = vP.x + vR.x * d0 + vU.x * h0; pos[o + 1] = vP.y + vR.y * d0 + vU.y * h0; pos[o + 2] = vP.z + vR.z * d0 + vU.z * h0;
      pos[o + 3] = vP.x + vR.x * d1 + vU.x * h1; pos[o + 4] = vP.y + vR.y * d1 + vU.y * h1; pos[o + 5] = vP.z + vR.z * d1 + vU.z * h1;
      uv[r * 4] = 0; uv[r * 4 + 1] = v; uv[r * 4 + 2] = 1; uv[r * 4 + 3] = v;
      if (r < N) { const a = r * 2, k = r * 6; idx[k] = a; idx[k + 1] = a + 1; idx[k + 2] = a + 2; idx[k + 3] = a + 1; idx[k + 4] = a + 3; idx[k + 5] = a + 2; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g;
  };
  const addMesh = (g, m, order) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.matrixAutoUpdate = false; if (order) o.renderOrder = order; scene.add(o); return o; };

  // --- lights, sky, fog ---
  scene.fog = new THREE.Fog(col(th.skyHor), th.fogNear, th.fogFar);
  scene.add(new THREE.HemisphereLight(col(th.hemiSky), col(th.hemiGnd), th.hemiI));
  const sun = new THREE.DirectionalLight(col(th.dir), th.dirI); sun.position.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).multiplyScalar(100); scene.add(sun);
  T.sky = makeSky(th, 2600); scene.add(T.sky);
  T.env = makeEnv(th, th.night ? [[60, 40, 0, 6, 60, 6, th.accL, 1.3], [-60, 40, 20, 6, 60, 6, th.accR, 1.3], [0, 90, 60, 80, 4, 8, 0xffffff, 1.2]] : []);
  scene.environment = T.env.texture;

  // --- road, walls, verge ---
  const rtex = roadTex(th.road); const roadMat = new THREE.MeshStandardMaterial({ map: rtex, metalness: 0, roughness: th.wet ? 1 : .82, envMapIntensity: th.wet ? .8 : .5 });
  if (th.wet) { roadMat.roughnessMap = TEX.rough; }
  addMesh(ribbon(-hw - .35, 0, hw + .35, 0, 16), roadMat);
  const wallMat = new THREE.MeshLambertMaterial({ color: col(th.wall), side: THREE.DoubleSide });
  const gL = glowMat(th.accL, 2.4, { side: THREE.DoubleSide }), gR = glowMat(th.accR, 2.4, { side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const e = s * (hw + .35);
    addMesh(ribbon(e, 0, e, 1.05), wallMat); addMesh(ribbon(e, 1.05, e + s * .6, 1.05), wallMat); addMesh(ribbon(e + s * .6, 1.05, e + s * .6, -.6), wallMat);
    addMesh(ribbon(e - s * .04, .72, e - s * .04, .95), s < 0 ? gL : gR);
    addMesh(ribbon(e - s * .5, .012, e - s * .3, .012), s < 0 ? gL : gR);
  }

  // --- ramps on the calmest stretches ---
  { let last = -1e9; const cand = [];
    for (let i = 60; i < N - 120; i += 4) { let m = 0; for (let k = -15; k <= 75; k += 5) m = Math.max(m, Math.abs(kap[(i + k + N) % N])); cand.push([m, i]); }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [m, i] of cand) { if (T.ramps.length >= 3 || m > .0034) break; if (T.ramps.every(r => Math.abs(r.i - i) > 150)) T.ramps.push({ i, s0: i * step, len: step * 5, h: 1.75, d0: 0, w: 4.2 }); }
    const rm = glowMat(th.accA, 1.5, { map: TEX.ramp, side: THREE.DoubleSide }), dark = new THREE.MeshLambertMaterial({ color: col(0x15131f), side: THREE.DoubleSide });
    for (const r of T.ramps) {
      const pos = [], uv = [], side = [], q = new THREE.Vector3(), pt = (i, d, h) => { basis(i); q.copy(vP).addScaledVector(vR, d).addScaledVector(vU, h); return [q.x, q.y, q.z]; };
      for (let k = 0; k < 5; k++) { const h0 = r.h * k / 5 + .03, h1 = r.h * (k + 1) / 5 + .03, a = pt(r.i + k, -r.w, h0), b = pt(r.i + k, r.w, h0), c = pt(r.i + k + 1, -r.w, h1), d = pt(r.i + k + 1, r.w, h1);
        pos.push(...a, ...b, ...c, ...b, ...d, ...c); uv.push(0, k / 5, 1, k / 5, 0, (k + 1) / 5, 1, k / 5, 1, (k + 1) / 5, 0, (k + 1) / 5);
        for (const w of [-r.w, r.w]) { const a0 = pt(r.i + k, w, 0), a1 = pt(r.i + k, w, h0), b0 = pt(r.i + k + 1, w, 0), b1 = pt(r.i + k + 1, w, h1); side.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0); } }
      const e0 = pt(r.i + 5, -r.w, 0), e1 = pt(r.i + 5, r.w, 0), e2 = pt(r.i + 5, -r.w, r.h), e3 = pt(r.i + 5, r.w, r.h); side.push(...e0, ...e1, ...e2, ...e1, ...e3, ...e2);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); addMesh(g, rm);
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(side, 3)); g2.computeVertexNormals(); addMesh(g2, dark);
    }
  }

  // --- terrain height field ---
  const inSign = def.rev ? -1 : 1; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); z0 = Math.min(z0, pz[i]); z1 = Math.max(z1, pz[i]); }
  const margin = def.theme === 'coast' ? 520 : 460; x0 -= margin; x1 += margin; z0 -= margin; z1 += margin;
  const G = 150, cx = (x1 - x0) / G, cz = (z1 - z0) / G, G1 = G + 1, hgt = new Float32Array(G1 * G1), dst = new Float32Array(G1 * G1), sea = minY - 7; T.sea = sea;
  for (let iz = 0; iz <= G; iz++) for (let ix = 0; ix <= G; ix++) {
    const x = x0 + ix * cx, z = z0 + iz * cz; let bd = 1e18, bi = 0;
    for (let i = 0; i < N; i += 3) { const dx = x - px[i], dz = z - pz[i], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = i; } }
    const dist = Math.sqrt(bd), lat = ((x - px[bi]) * -Math.cos(head[bi]) + (z - pz[bi]) * Math.sin(head[bi])) * inSign, base = py[bi] - 2.6, far = smooth(15, 80, dist);
    let h;
    if (def.theme === 'city') h = base + far * (fbm(x * .004, z * .004, 2) - .5) * 8;
    else if (def.theme === 'coast') h = lat > 0 ? base + far * (fbm(x * .006 + 9, z * .006, 3) * 46 - 9) : lerp(base, sea - 9, smooth(20, 130, dist)) + far * fbm(x * .02, z * .02, 2) * 3;
    else { const n = fbm(x * .0045 + 3, z * .0045, 4); h = base + far * ((1 - Math.abs(n * 2 - 1)) * 62 - 16 + smooth(70, 400, dist) * 95); }
    hgt[iz * G1 + ix] = h; dst[iz * G1 + ix] = dist;
  }
  for (let pass = 0; pass < 2; pass++) { const src = hgt.slice();
    for (let iz = 1; iz < G; iz++) for (let ix = 1; ix < G; ix++) { const k = iz * G1 + ix, w = smooth(16, 70, dst[k]); if (w <= 0) continue;
      const avg = (src[k - 1] + src[k + 1] + src[k - G1] + src[k + G1] + src[k - G1 - 1] + src[k - G1 + 1] + src[k + G1 - 1] + src[k + G1 + 1] + src[k]) / 9; hgt[k] = lerp(src[k], avg, w); } }
  const sampleGrid = (arr, x, z) => { const gx = clamp((x - x0) / cx, 0, G - .001), gz = clamp((z - z0) / cz, 0, G - .001), ix = Math.floor(gx), iz = Math.floor(gz), fx2 = gx - ix, fz2 = gz - iz, k = iz * G1 + ix;
    return lerp(lerp(arr[k], arr[k + 1], fx2), lerp(arr[k + G1], arr[k + G1 + 1], fx2), fz2); };
  const terrainH = (x, z) => sampleGrid(hgt, x, z), trackDist = (x, z) => sampleGrid(dst, x, z);
  { const pos = new Float32Array(G1 * G1 * 3), cl = new Float32Array(G1 * G1 * 3), idx = new Uint32Array(G * G * 6), c = new THREE.Color();
    const pal = { city: [0x0c0a17, 0x17131f, 0x1c1826], coast: [0xd4b184, 0x8a8a4a, 0x9a5a44], snow: [0xdcebfa, 0xb9d2ea, 0x364356] }[def.theme].map(col);
    for (let iz = 0; iz <= G; iz++) for (let ix = 0; ix <= G; ix++) { const k = iz * G1 + ix, x = x0 + ix * cx, z = z0 + iz * cz, h = hgt[k]; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const sl = Math.hypot(hgt[Math.min(k + 1, G1 * G1 - 1)] - h, hgt[Math.min(k + G1, G1 * G1 - 1)] - h) / cx, n = fbm(x * .02, z * .02, 2);
      if (def.theme === 'coast') c.copy(pal[0]).lerp(pal[1], smooth(sea + 3, sea + 12, h + n * 6)).lerp(pal[2], smooth(.45, .85, sl));
      else if (def.theme === 'snow') c.copy(pal[0]).lerp(pal[1], n).lerp(pal[2], smooth(.75, 1.25, sl + n * .3));
      else c.copy(pal[0]).lerp(pal[1], n).lerp(pal[2], smooth(.2, .6, sl));
      cl[k * 3] = c.r; cl[k * 3 + 1] = c.g; cl[k * 3 + 2] = c.b; }
    let o = 0; for (let iz = 0; iz < G; iz++) for (let ix = 0; ix < G; ix++) { const a = iz * G1 + ix, b = a + 1, c2 = a + G1, d = c2 + 1; idx[o++] = a; idx[o++] = c2; idx[o++] = b; idx[o++] = b; idx[o++] = c2; idx[o++] = d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    addMesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: def.theme === 'snow' ? 30 : 4, specular: col(def.theme === 'snow' ? 0x33485c : 0x080808) }));
    // verge between wall and terrain
    const vc = pal[0].clone().lerp(pal[1], .5), vm = new THREE.MeshLambertMaterial({ color: vc, side: THREE.DoubleSide });
    for (const s of [-1, 1]) addMesh(ribbon(s * (hw + .95), .2, s * (hw + 9), -4.6), vm);
  }
  if (def.theme === 'coast') { const w = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col(0x16314a), roughness: .12, metalness: .75, envMapIntensity: 1.5 })); w.position.y = sea; scene.add(w); }

  // --- scenery ---
  const solid = new Batch(UNIT_BOX(), new THREE.MeshLambertMaterial({ color: 0xffffff })), glow = new Batch(UNIT_BOX(), glowMat(0xffffff, 2.6));
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = new Batch(flat, new THREE.MeshBasicMaterial({ map: TEX.glow, color: col(th.lamp).multiplyScalar(th.night ? .42 : .0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const signs = new Batch(new THREE.PlaneGeometry(1, 1), glowMat(th.accA, 2.0, { map: TEX.chevron, side: THREE.DoubleSide }));
  const m = M4(), sc = M4(), tmp = M4(), faceDriver = M4().makeRotationY(Math.PI);
  const box = (b, i, d, h, sx, sy, sz, c) => { frame(i, d, h, m); m.multiply(sc.makeScale(sx, sy, sz)); b.add(m, c); };
  const dark = col(0x1b1926), cL = col(th.accL), cR = col(th.accR), cA = col(th.accA), cLamp = col(th.lamp);
  const nearRamp = i => T.ramps.some(r => i > r.i - 12 && i < r.i + 40);
  // start gantry + line
  box(solid, 0, -(hw + 1.3), 4.6, .6, 9.2, .6, dark); box(solid, 0, hw + 1.3, 4.6, .6, 9.2, .6, dark); box(solid, 0, 0, 9.3, hw * 2 + 3.4, 1.9, .7, dark);
  box(glow, 0, 0, 8.25, hw * 2 + 3, .14, .5, cA);
  { const b = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 2.6, 1.7), glowMat(0xffffff, 1.7, { map: TEX.banner })); frame(0, 0, 9.3, m); m.multiply(faceDriver); m.multiply(tmp.makeTranslation(0, 0, .37)); b.matrix.copy(m); b.matrixAutoUpdate = false; b.frustumCulled = false; scene.add(b);
    const ln = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: TEX.checker, color: col(0xcfcfd6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); frame(0, 0, .02, m); m.multiply(sc.makeScale(hw * 2, 1, 2.6)); ln.matrix.copy(m); ln.matrixAutoUpdate = false; ln.frustumCulled = false; scene.add(ln); }
  // lamps, arches, corner chevrons
  for (let i = 14, n = 0; i < N; i += 14, n++) {
    if (th.night || n % 2 === 0) { const s = n % 2 ? 1 : -1;
      box(solid, i, s * (hw + 1.4), 4.5, .26, 9, .26, dark); box(solid, i, s * (hw - .4), 9, 3.8, .2, .26, dark); box(glow, i, s * (hw - 1.9), 8.86, 1.5, .12, .5, cLamp);
      if (th.night) { frame(i, s * (hw - 4), .04, m); m.multiply(sc.makeScale(22, 1, 22)); pools.add(m); } }
  }
  for (let i = 70, n = 0; i < N - 30; i += 120, n++) { if (nearRamp(i)) continue; const c = n % 2 ? cL : cR;
    box(glow, i, -(hw + 1.3), 4.4, .3, 8.8, .3, c); box(glow, i, hw + 1.3, 4.4, .3, 8.8, .3, c); box(glow, i, 0, 8.8, hw * 2 + 2.9, .3, .3, c);
    box(solid, i, 0, 9.25, hw * 2 + 3.4, .6, .9, dark); }
  for (let i = 0; i < N; i += 6) { const k = kap[(i + 8) % N]; if (Math.abs(k) < .0048) continue; const out = k > 0 ? 1 : -1;   // board on the outside of the bend
    frame(i + 8, out * (hw + 1.1), 2.1, m); m.multiply(faceDriver); m.multiply(tmp.makeRotationY(out * .5)); m.multiply(sc.makeScale(-out * 3.2, 1.9, 1)); signs.add(m); }
  // billboards
  for (let k = 0; k < 7; k++) { const i = Math.floor(N * (k + .35) / 7), s = k % 2 ? 1 : -1; if (Math.abs(kap[i]) > .006) continue;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(17, 6.4), glowMat(0xffffff, 1.9, { map: TEX.boards[k % 3] })); frame(i, s * (hw + 12), 9.5, m); m.multiply(faceDriver); m.multiply(tmp.makeRotationY(s * .32)); b.matrix.copy(m); b.matrixAutoUpdate = false; b.frustumCulled = false; scene.add(b);
    box(solid, i, s * (hw + 9), 3.2, .5, 7.5, .5, dark); box(solid, i, s * (hw + 15), 3.2, .5, 7.5, .5, dark); }
  solid.build(scene); glow.build(scene); pools.build(scene); signs.build(scene);

  const free = (x, z, clear) => trackDist(x, z) > clear;
  const eu = new THREE.Euler(), qq = new THREE.Quaternion(), vv = new THREE.Vector3(), ss = new THREE.Vector3(), o = {};
  const put = (b, x, y, z, ry, sx, sy, sz, c) => { m.compose(vv.set(x, y, z), qq.setFromEuler(eu.set(0, ry, 0)), ss.set(sx, sy, sz)); b.add(m, c); };
  if (def.theme === 'city') {
    const bl = new Batch(UNIT_BOX(), buildingMat(th)), tops = new Batch(UNIT_BOX(), glowMat(0xffffff, 2.2));
    for (let n = 0; n < 620; n++) { const i = Math.floor(rnd() * N), s = rnd() > .5 ? 1 : -1, dd = 30 + Math.pow(rnd(), 1.6) * 330; T.at(i * step, s * dd, o);
      const w = 16 + rnd() * 22, dp = 16 + rnd() * 22, hh = 26 + Math.pow(rnd(), 2.2) * 170 + (dd > 150 ? 40 : 0); if (!free(o.x, o.z, hw + 14 + Math.max(w, dp) * .75)) continue;
      const y = terrainH(o.x, o.z) - 6, ry = head[i] + (rnd() > .7 ? .4 : 0);
      put(bl, o.x, y + hh / 2, o.z, ry, w, hh, dp, new THREE.Color(rnd(), rnd(), .14 + rnd() * .4));
      if (rnd() > .55) put(tops, o.x, y + hh + .25, o.z, ry, w + .3, .5, dp + .3, [cL, cR, cA][Math.floor(rnd() * 3)]);
      else if (rnd() > .6) put(tops, o.x, y + hh + 5, o.z, ry, .5, 10, .5, col(0xff3040)); }
    bl.build(scene); tops.build(scene);
  } else if (def.theme === 'coast') {
    const palms = new Batch(palmGeo(), new THREE.MeshLambertMaterial({ vertexColors: true })), rocks = new Batch(new THREE.CylinderGeometry(.72, 1, 1, 7, 2), new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 2 }));
    for (let i = 5; i < N; i += 7) for (const s of [-1, 1]) { if (rnd() > .78) continue; const dd = hw + 5 + rnd() * 4.5; T.at(i * step, s * dd, o); if (!free(o.x, o.z, hw + 3.5)) continue;
      const k = .85 + rnd() * .5; put(palms, o.x, py[i] + sb[i] * s * dd - 2.6, o.z, rnd() * TAU, k, k, k); }
    for (let n = 0; n < 300; n++) { const i = Math.floor(rnd() * N), dd = inSign * (26 + rnd() * 200); T.at(i * step, dd, o); if (!free(o.x, o.z, hw + 16)) continue; const k = .9 + rnd() * .9; put(palms, o.x, terrainH(o.x, o.z) - .4, o.z, rnd() * TAU, k, k, k); }
    for (let n = 0; n < 46; n++) { const i = Math.floor(rnd() * N), dd = -inSign * (150 + rnd() * 330); T.at(i * step, dd, o); if (!free(o.x, o.z, 120)) continue;
      const w = 40 + rnd() * 90, hh = 40 + rnd() * 120; put(rocks, o.x, sea + hh / 2 - 8, o.z, rnd() * TAU, w, hh, w * (.6 + rnd() * .6), col(0xa8583e).lerp(col(0x5c3440), rnd() * .7)); }
    palms.build(scene); rocks.build(scene);
  } else {
    const pines = new Batch(pineGeo(), new THREE.MeshLambertMaterial({ vertexColors: true })), rocks = new Batch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 8 }));
    for (let n = 0; n < 1500; n++) { const i = Math.floor(rnd() * N), s = rnd() > .5 ? 1 : -1, dd = hw + 7 + Math.pow(rnd(), 1.5) * 190; T.at(i * step, s * dd, o); if (!free(o.x, o.z, hw + 5.5) || fbm(o.x * .012, o.z * .012, 2) < .42) continue;
      const k = 1 + rnd() * 1.3; put(pines, o.x, terrainH(o.x, o.z) - .5, o.z, rnd() * TAU, k, k * (.9 + rnd() * .4), k); }
    for (let n = 0; n < 160; n++) { const i = Math.floor(rnd() * N), s = rnd() > .5 ? 1 : -1, dd = hw + 12 + rnd() * 120; T.at(i * step, s * dd, o); if (!free(o.x, o.z, hw + 9)) continue;
      const k = 2 + rnd() * 7; put(rocks, o.x, terrainH(o.x, o.z), o.z, rnd() * TAU, k, k * .7, k * (.7 + rnd() * .6), col(0x3a4658).lerp(col(0xdcebfa), rnd() * .5)); }
    pines.build(scene); rocks.build(scene);
    // snowfall that travels with the camera
    const n = 900, p = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) p[i] = (rnd() - .5) * 80;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const sm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { off: { value: new THREE.Vector3() }, px: { value: 1 } },
      vertexShader: 'uniform vec3 off; uniform float px; void main(){ vec3 p=mod(position+off+40.,80.)-40.; vec4 mv=viewMatrix*vec4(p+cameraPosition,1.0); gl_PointSize=px*.16/max(-mv.z,1.); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(.9,.95,1.),smoothstep(.5,.15,d)*.75);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}' });
    const pts = new THREE.Points(g, sm); pts.frustumCulled = false; scene.add(pts);
    T.tick.push((dt, cam, vel) => { sm.uniforms.off.value.x -= (vel.x * .9 + 2) * dt; sm.uniforms.off.value.y -= 5 * dt; sm.uniforms.off.value.z -= vel.z * .9 * dt; sm.uniforms.px.value = gfx.h * gfx.pr; });
  }

  // --- nitro pickups ---
  { const geo = new THREE.OctahedronGeometry(.75, 0), mat = glowMat(0x19e3ff, 2.6), halo = new THREE.SpriteMaterial({ map: TEX.glow, color: col(0x19e3ff), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .8 });
    const add = (s, d, hh) => { const g = new THREE.Group(), a = new THREE.Mesh(geo, mat), sp = new THREE.Sprite(halo); sp.scale.set(4.6, 4.6, 1); a.scale.set(.8, 1.25, .8); g.add(a, sp);
      T.at(s, d, o); g.position.set(o.x, T.ground(o.idx, o.f, d, -1) + hh, o.z); scene.add(g); T.pickups.push({ s: ((s % L) + L) % L, d, y: g.position.y, g, t: 0 }); };
    for (let k = 0; k < 10; k++) { const s = L * (k + .55) / 10, i = Math.floor(s / step); if (nearRamp(i) || nearRamp(i + 20)) continue; add(s, [-5, 0, 5][Math.floor(rnd() * 3)], 1.25); }
    for (const r of T.ramps) add(r.s0 + r.len + 26, 0, 4.4);
  }
  T.dispose = () => { dropGlows(scene); scene.traverse(ob => { if (ob.geometry) ob.geometry.dispose(); if (ob.material) (Array.isArray(ob.material) ? ob.material : [ob.material]).forEach(mm => { if (mm.map && mm.map !== TEX.glow && !Object.values(TEX).includes(mm.map) && !TEX.boards.includes(mm.map)) mm.map.dispose(); mm.dispose(); }); }); T.env.dispose(); };
  return T;
}

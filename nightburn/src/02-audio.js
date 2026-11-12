// ===================================================================
// audio: synthesized engine, effects and a small generative soundtrack
// ===================================================================
const audio = {
  ctx: null, ready: false, musTimer: null, step: 0, nextT: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(c.destination);
      this.master = c.createGain(); this.master.gain.value = .9; this.master.connect(comp);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.mus = c.createGain(); this.musF = c.createBiquadFilter(); this.musF.type = 'lowpass'; this.musF.frequency.value = 700;
      this.mus.connect(this.musF); this.musF.connect(this.master);
      // noise buffer shared by wind / skid / nitro / hits
      const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = nb;
      // engine: two saws + sub square through a moving low-pass
      this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.Q.value = 2.5;
      this.engG = c.createGain(); this.engG.gain.value = 0; this.engF.connect(this.engG); this.engG.connect(this.sfx);
      this.osc = [['sawtooth', 1, .5], ['sawtooth', 1.012, .35], ['square', .5, .45]].map(([type, mul, g]) => {
        const o = c.createOscillator(), gn = c.createGain(); o.type = type; o.frequency.value = 60 * mul; gn.gain.value = g;
        o.connect(gn); gn.connect(this.engF); o.start(); return { o, mul };
      });
      const loop = (type, freq, q) => {
        const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfx); s.start(); return { f, g };
      };
      this.wind = loop('bandpass', 500, .6);
      this.skid = loop('bandpass', 1700, 3.5);
      this.jet = loop('bandpass', 900, .9);
      this.ready = true; this.applySettings();
    } catch (e) { this.ready = false; }
  },
  applySettings() {
    if (!this.ready) return;
    this.sfx.gain.value = save.sfx === 'on' ? 1 : 0;
    this.mus.gain.value = save.music === 'on' ? .5 : 0;
    if (save.music === 'on') this.startMusic(); else this.stopMusic();
  },
  suspend(on) { if (!this.ctx) return; (on ? this.ctx.suspend() : this.ctx.resume()).catch(() => {}); },
  engine(rpm, load, speedF, slip, boost) {
    if (!this.ready) return; const t = this.ctx.currentTime, f = 46 + rpm * 150;
    for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(f * mul, t, .04);
    this.engF.frequency.setTargetAtTime(260 + rpm * 1900 + load * 700, t, .05);
    this.engG.gain.setTargetAtTime(.10 + load * .09, t, .06);
    this.wind.g.gain.setTargetAtTime(speedF * speedF * .22, t, .1);
    this.wind.f.frequency.setTargetAtTime(350 + speedF * 900, t, .1);
    this.skid.g.gain.setTargetAtTime(clamp(slip * 1.6, 0, .32), t, .05);
    this.jet.g.gain.setTargetAtTime(boost * .42, t, .08);
    this.jet.f.frequency.setTargetAtTime(700 + boost * 1500, t, .15);
  },
  quiet() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    for (const n of [this.engG, this.wind.g, this.skid.g, this.jet.g]) n.gain.setTargetAtTime(0, t, .08);
  },
  tone(freq, dur, type, vol, slide, dest, when) {
    if (!this.ready) return; const c = this.ctx, t = when || c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || .2, t + .008); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + .03);
  },
  burst(dur, freq, vol, type, dest, when) {
    if (!this.ready) return; const c = this.ctx, t = when || c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random()); s.stop(t + dur + .03);
  },
  beep(go) { go ? this.tone(990, .55, 'square', .22) : this.tone(495, .16, 'square', .2); },
  crash(power) { this.burst(.35, 500 + power * 900, clamp(.25 + power * .5, 0, .8)); this.tone(90, .25, 'sine', .4 * clamp(power + .3, 0, 1), 40); },
  pickup() { [660, 880, 1320].forEach((f, i) => this.tone(f, .16, 'triangle', .2, 0, null, this.ctx ? this.ctx.currentTime + i * .055 : 0)); },
  nitroOn() { this.burst(.7, 1400, .5, 'bandpass'); this.tone(140, .6, 'sawtooth', .22, 520); },
  whoosh() { this.burst(.45, 900, .22, 'bandpass'); },
  land() { this.tone(70, .22, 'sine', .5, 38); this.burst(.18, 300, .3); },
  ui() { this.tone(720, .07, 'triangle', .14); },
  cash() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .22, 'triangle', .18, 0, null, this.ctx ? this.ctx.currentTime + i * .08 : 0)); },

  // ---- music: 16-step sequencer, A minor ----
  startMusic() { if (!this.ready || this.musTimer) return; this.nextT = this.ctx.currentTime + .12; this.step = 0; this.musTimer = setInterval(() => this.sched(), 90); },
  stopMusic() { if (this.musTimer) { clearInterval(this.musTimer); this.musTimer = null; } },
  musicMode(race) { if (!this.ready) return; this.musF.frequency.setTargetAtTime(race ? 9000 : 650, this.ctx.currentTime, .4); },
  sched() {
    const c = this.ctx; if (c.state !== 'running') return;
    if (this.nextT < c.currentTime - .5) this.nextT = c.currentTime + .05;
    while (this.nextT < c.currentTime + .4) { this.playStep(this.step, this.nextT); this.nextT += 60 / 118 / 4; this.step = (this.step + 1) % 128; }
  },
  playStep(i, t) {
    const PROG = [[45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [36, [55, 60, 64, 67]], [43, [55, 59, 62, 67]]];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const bar = Math.floor(i / 16), s = i % 16, [root, ch] = PROG[bar % 4], d = this.mus, fill = bar % 8 === 7;
    if (s % 4 === 0) { this.tone(150, .22, 'sine', .9, 42, d, t); }
    if (s === 4 || s === 12 || (fill && s > 12)) this.burst(.16, 1900, .32, 'bandpass', d, t);
    if (s % 2 === 0) this.burst(.035, 8000, s % 4 === 2 ? .16 : .07, 'highpass', d, t);
    if (s % 2 === 0) this.tone(hz(root - 12 + (s % 4 === 2 ? 12 : 0)), .2, 'sawtooth', .3, 0, d, t);
    const pat = [0, 2, 1, 3, 2, 1, 3, 2, 0, 3, 1, 2, 3, 1, 2, 3];
    if (bar % 8 >= 2) this.tone(hz(ch[pat[s]] + (bar % 8 >= 6 ? 12 : 0)), .14, 'square', .055, 0, d, t);
    if (s === 0) for (const m of ch) this.tone(hz(m), 60 / 118 * 4, 'sawtooth', .028, 0, d, t);
  },
};

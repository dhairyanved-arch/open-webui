
// test-only hooks (not part of the shipped build)
window.__nb = {
  get race() { return race; }, get show() { return show; }, gfx, save, input,
  info() { const T = race.T; return { L: Math.round(T.L), minR: Math.round(T.minRadius), ramps: T.ramps.map(r => Math.round(r.s0)), pickups: T.pickups.length }; },
  // run the race with a simple robot driver; returns a summary
  sim(maxT, useNitro, useDrift) {
    const R = race, T = R.T, p = R.player, dt = 1 / 60; let hits = 0, lastV = 0, maxV = 0, t = 0; const laps = [];
    const crash0 = audio.crash; audio.crash = () => { hits++; };
    while (t < maxT && !R.shown) {
      const k = T.kap[(p.idx + 14) % T.N], want = T.head[(p.idx + 10) % T.N] + clamp(p.d * .05 + k * 6 * 0, -.35, .35);
      input.analog = p.finished ? 0 : clamp(-angDiff(want, p.yaw) * 3.2, -1, 1);
      if (useNitro && p.nitro > .5 && Math.abs(k) < .003) input.nitroTap = 1;
      input.brake = useDrift && Math.abs(k) > .0062 && p.speed > 60 ? 1 : 0;
      const lap = p.lap; updateRace(dt); t += dt; maxV = Math.max(maxV, p.speed);
      if (p.lap !== lap && lap >= 0) laps.push(+(p.best).toFixed(2));
    }
    audio.crash = crash0; input.analog = 0; input.brake = 0;
    return { t: +t.toFixed(1), time: +R.time.toFixed(2), place: p.place, pos: R.pos, hits, maxKmh: Math.round(maxV * 3.6), best: +p.best.toFixed(2), stats: R.stats, nitro: +p.nitro.toFixed(2),
      rivals: R.cars.filter(c => !c.isPlayer).map(c => c.finished ? +c.finishTime.toFixed(1) : Math.round(c.prog)) };
  },
};

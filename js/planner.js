/* Turns sky geometry, moonlight, light pollution and cloud into one photo score. */
const Planner = (() => {
  const STEP = 10 * 60000;
  const DARK_SITES = [
    { b: 8, label: 'City', hint: 'Only the brightest stars show' },
    { b: 6, label: 'Suburb', hint: 'A few dozen stars, orange glow all round' },
    { b: 5, label: 'Edge of town', hint: 'Milky Way only overhead, and weak' },
    { b: 3, label: 'Countryside', hint: 'Milky Way is clear on a good night' },
    { b: 1, label: 'Remote dark site', hint: 'Milky Way is bright and full of detail' },
  ];
  const LIGHT = { // by Bortle class 1..9
    faint: [1, 1, .97, .85, .65, .42, .22, .1, .05],
    medium: [1, 1, 1, .93, .8, .65, .5, .35, .25],
    bright: [1, 1, 1, .97, .92, .85, .75, .65, .55],
  };
  const lerp = (x, pts) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  };

  const darkFactor = sun => lerp(sun, [[-18, 1], [-15, .65], [-12, .3], [-10, 0]]);
  const altFactor = (alt, min) => alt < min ? 0 : lerp(alt, [[8, .22], [15, .38], [30, .72], [45, .92], [60, 1]]);
  function moonFactor(sens, frac, moonAlt, sep) {
    if (moonAlt < -2) return 1;
    const up = Math.pow(Astro.clamp((moonAlt + 2) / 27, 0, 1), .6);
    const near = lerp(sep, [[20, 1], [120, .65]]);
    return 1 - sens * Math.pow(frac, 1.1) * up * near;
  }
  const lightFactor = (kind, b) => LIGHT[kind][Astro.clamp(Math.round(b), 1, 9) - 1];
  const cloudFactor = c => c == null ? 1 : c <= 10 ? 1 : Math.max(0, 1 - Math.pow((c - 10) / 85, .9));

  /* Linear interpolation between hourly forecast values; null outside the forecast. */
  function cloudAt(weather, t) {
    if (!weather) return null;
    const i = (t - weather.t0) / 3600000, a = Math.floor(i);
    if (a < 0 || a >= weather.cloud.length) return null;
    const x = weather.cloud[a], y = weather.cloud[Math.min(a + 1, weather.cloud.length - 1)];
    if (x == null) return null;
    return y == null ? x : x + (y - x) * (i - a);
  }

  function skyAt(t, loc) {
    const m = Astro.moonAltAz(loc.lat, loc.lon, t);
    return { t, sun: Astro.sunAlt(loc.lat, loc.lon, t), moonAlt: m.alt, moonAz: m.az, moonRa: m.ra, moonDec: m.dec };
  }

  /* One night: local noon to the following local noon. */
  const nights = new Map();
  function night(date, loc) {
    const key = `${date}|${loc.lat}|${loc.lon}|${loc.tz}`;
    if (nights.has(key)) return nights.get(key);
    const t0 = Zone.toUtc(date, 12, 0, loc.tz), t1 = Zone.toUtc(Zone.addDays(date, 1), 12, 0, loc.tz);
    const s = [];
    for (let t = t0; t <= t1; t += STEP) s.push(skyAt(t, loc));
    const n = { date, t0, t1, s, moon: Astro.moonPhase((t0 + t1) / 2) };
    const cross = (k, level, dir) => {
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1][k] - level, b = s[i][k] - level;
        if (dir < 0 ? a > 0 && b <= 0 : a <= 0 && b > 0) return s[i - 1].t + STEP * a / (a - b);
      }
      return null;
    };
    Object.assign(n, {
      sunset: cross('sun', -.833, -1), sunrise: cross('sun', -.833, 1),
      darkStart: cross('sun', -18, -1), darkEnd: cross('sun', -18, 1),
      moonrise: cross('moonAlt', -.833, 1), moonset: cross('moonAlt', -.833, -1),
      lowestSun: Math.min(...s.map(x => x.sun)),
      darkHours: s.filter(x => x.sun <= -18).length * STEP / 3600000,
    });
    if (nights.size > 500) nights.clear();
    nights.set(key, n);
    return n;
  }

  function scoreSample(target, pos, sky, frac, ctx) {
    const p = Astro.altAz(pos.ra, pos.dec, ctx.loc.lat, ctx.loc.lon, sky.t);
    const cloud = cloudAt(ctx.weather, sky.t);
    const f = {
      dark: darkFactor(sky.sun), alt: altFactor(p.alt, target.minAlt),
      moon: moonFactor(target.moon, frac, sky.moonAlt, Astro.separation(pos.ra, pos.dec, sky.moonRa, sky.moonDec)),
      light: lightFactor(target.light, ctx.bortle), cloud: cloudFactor(cloud),
    };
    return { t: sky.t, alt: p.alt, az: p.az, sun: sky.sun, moonAlt: sky.moonAlt, cloud, f,
      score: 100 * f.dark * f.alt * f.moon * f.light * f.cloud };
  }

  function scoreAt(target, t, ctx) {
    return scoreSample(target, Astro.precess(target.ra, target.dec, t), skyAt(t, ctx.loc), Astro.moonPhase(t).frac, ctx);
  }

  /* Whole-night result: best hour, usable window, and grade. */
  function evaluate(target, date, ctx) {
    const n = night(date, ctx.loc), pos = Astro.precess(target.ra, target.dec, n.t0);
    const s = n.s.map(x => scoreSample(target, pos, x, n.moon.frac, ctx));
    let best = 0, bi = -1;
    for (let i = 3; i < s.length - 3; i++) {
      let m = 0;
      for (let k = -3; k <= 3; k++) m += s[i + k].score;
      if (m / 7 > best) { best = m / 7; bi = i; }
    }
    // The best hour can straddle an edge (dusk, or the target setting): point at its best moment.
    if (bi >= 0) for (let k = bi - 3, c = bi; k <= c + 3; k++) if (s[k].score > s[bi].score) bi = k;
    const score = Math.round(best);
    let window = null;
    if (score >= 8) {
      const floor = Math.max(6, best * .65);
      let a = bi, b = bi;
      while (a > 0 && s[a - 1].score >= floor) a--;
      while (b < s.length - 1 && s[b + 1].score >= floor) b++;
      window = { start: s[a].t, end: s[b].t, peak: s[bi] };
    }
    const maxAlt = Math.max(...s.map(x => x.alt));
    const maxAltDark = Math.max(-90, ...s.filter(x => x.sun <= -12).map(x => x.alt));
    const hasForecast = (window ? window.peak : s[Math.floor(s.length / 2)]).cloud != null;
    return { target, night: n, s, score, window, maxAlt, maxAltDark, hasForecast, grade: grade(score) };
  }

  const grade = x => x >= 70 ? { word: 'Excellent', k: 4 } : x >= 50 ? { word: 'Good', k: 3 }
    : x >= 28 ? { word: 'Fair', k: 2 } : x >= 8 ? { word: 'Poor', k: 1 } : { word: 'Not possible', k: 0 };

  /* Why a night cannot work, in one sentence. */
  function blocker(r, ctx) {
    const { target: t, night: n } = r;
    if (r.maxAlt < t.minAlt) return r.maxAlt < 0
      ? `${t.name} never rises above the horizon from ${ctx.loc.name}.`
      : `${t.name} only climbs to ${Math.round(r.maxAlt)}° here, too low in the haze for a clean photo.`;
    if (n.lowestSun > -12) return 'The sky does not get dark enough that night at this latitude.';
    if (r.maxAltDark < t.minAlt) return `${t.name} is only high enough in daylight or twilight at this time of year.`;
    const up = r.s.filter(x => x.f.dark > 0 && x.f.alt > 0);
    const top = k => Math.max(0, ...up.map(x => x.f[k]));
    if (top('cloud') < .25) return 'The forecast shows heavy cloud while it is up.';
    if (top('light') < .3) return 'Your sky is too bright for it. Try it from a darker place.';
    if (top('moon') < .4) return 'The bright Moon washes it out.';
    return 'Low height, moonlight and sky glow add up to a washed-out photo.';
  }

  /* Which night to show for a moment: the one in progress, or the next one after dawn. */
  function nightOf(ms, loc) {
    const d = Zone.date(ms, loc.tz);
    if (Zone.hour(ms, loc.tz) >= 12) return d;
    return Astro.sunAlt(loc.lat, loc.lon, ms) < -10 ? Zone.addDays(d, -1) : d;
  }

  /* Hours per night that a target is well placed in a dark sky, for each of 52 weeks. */
  function season(target, year, loc) {
    const out = [];
    for (let w = 0; w < 52; w++) {
      const date = Zone.addDays(`${year}-01-04`, w * 7);
      const t0 = Zone.toUtc(date, 12, 0, loc.tz), pos = Astro.precess(target.ra, target.dec, t0);
      let h = 0;
      for (let t = t0; t < t0 + 864e5; t += 12e5) {
        if (Astro.sunAlt(loc.lat, loc.lon, t) > -15) continue;
        if (Astro.altAz(pos.ra, pos.dec, loc.lat, loc.lon, t).alt >= Math.max(15, target.minAlt)) h += 1 / 3;
      }
      out.push({ date, h });
    }
    return out;
  }

  return { STEP, DARK_SITES, night, skyAt, scoreAt, evaluate, grade, blocker, nightOf, season, cloudAt };
})();

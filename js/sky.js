/* Drawing: the sky window (canvas) and the night ribbon (SVG). */
const Sky = (() => {
  const { R, clamp } = Astro;
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
  const rgb = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;
  function ramp(x, stops) { // stops: ascending [value, [r,g,b]]
    if (x <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0])
      return mix(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return stops[stops.length - 1][1];
  }
  const S = a => a.map(([x, h]) => [x, hex(h)]);
  const ZENITH = S([[-18, '#03060d'], [-12, '#0a1530'], [-6, '#16294d'], [0, '#2b4f7d'], [8, '#2a6299']]);
  const HORIZON = S([[-18, '#0e1726'], [-12, '#26365a'], [-6, '#a0644f'], [0, '#e6a873'], [8, '#8fbad6']]);
  const STRIP = S([[-18, '#0a0f1c'], [-12, '#1a2748'], [-6, '#473f66'], [-1, '#8a5a48'], [4, '#3a6d97'], [12, '#3a739f']]);
  const STRIP_RED = S([[-18, '#0c0000'], [-12, '#1d0302'], [-6, '#330805'], [4, '#4d0f09']]);
  const strip = (sun, red) => rgb(ramp(sun, red ? STRIP_RED : STRIP));

  /* Milky Way as a fixed cloud of points, brighter at the core, split by the dark rift. */
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(6.2832 * rnd());
  const bump = (l, c, w) => { const d = ((l - c + 540) % 360) - 180; return Math.exp(-(d * d) / (w * w)); };
  const bright = l => .25 + .75 * bump(l, 0, 38) + .3 * bump(l, 78, 20) + .3 * bump(l, 288, 24);
  function cloud(n, spread) {
    const out = [];
    while (out.length < n) {
      const l = rnd() * 360, w = bright(l);
      if (rnd() > w) continue;
      const b = gauss() * spread * (3.6 + 4.5 * bump(l, 0, 16));
      const rift = (l < 75 || l > 345) && Math.abs(b - 1.2 - Math.sin(l / 9)) < 1.7;
      if (rift && rnd() < .82) continue;
      const e = Astro.galToEq(l, b);
      out.push({ ra: e.ra, dec: e.dec, w, k: rnd() });
    }
    return out;
  }
  const DOTS = cloud(5200, 1), GLOW = cloud(900, .75);

  /* Equatorial to East-North-Up unit vectors for one instant, via a rotation matrix (fast). */
  function rotator(lat, lon, ms) {
    const th = (Astro.gmst(ms) + lon) * R, sl = Math.sin(lat * R), cl = Math.cos(lat * R), st = Math.sin(th), ct = Math.cos(th);
    return (ra, dec) => {
      const cd = Math.cos(dec * R), x = cd * Math.cos(ra * R), y = cd * Math.sin(ra * R), z = Math.sin(dec * R);
      const hx = ct * x + st * y, e = -st * x + ct * y;
      return [e, -sl * hx + cl * z, cl * hx + sl * z];
    };
  }
  const enu = (az, alt) => [Math.cos(alt * R) * Math.sin(az * R), Math.cos(alt * R) * Math.cos(az * R), Math.sin(alt * R)];

  let puff = null;
  function glowSprite() {
    if (puff) return puff;
    puff = document.createElement('canvas'); puff.width = puff.height = 64;
    const c = puff.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(206,196,190,1)'); g.addColorStop(1, 'rgba(206,196,190,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return puff;
  }

  /* o: {loc, t, az, alt, bortle, target, others, red} ; returns hit list for the caller. */
  function draw(canvas, o) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return [];
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = Planner.skyAt(o.t, o.loc), moonP = Astro.moonPhase(o.t);
    const toV = rotator(o.loc.lat, o.loc.lon, o.t);

    const halfW = W > 700 ? 62 : 46;
    const scale = (W / 2) / (2 * Math.tan(halfW * R / 2));
    const f = enu(o.az, o.alt), r = enu(o.az + 90, 0);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cy = H * .52;
    function proj(v) {
      const d = dot(v, f);
      if (d < -.35) return null;
      const k = 2 / (1 + d) * scale;
      return [W / 2 + dot(v, r) * k, cy - dot(v, u) * k];
    }
    const eq = (ra, dec) => proj(toV(ra, dec));
    const on = p => p && p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40;

    // Sky
    const dark = clamp((-sky.sun - 5) / 11, 0, 1);
    const moonUp = clamp(sky.moonAlt / 25, 0, 1) * moonP.frac;
    let top = ramp(sky.sun, ZENITH), low = ramp(sky.sun, HORIZON);
    const glow = (o.bortle - 1) / 8;
    low = mix(low, hex('#7a5a34'), glow * .62 * dark); top = mix(top, hex('#2b2a2c'), glow * .55 * dark);
    top = mix(top, hex('#1b2c46'), moonUp * .6 * dark); low = mix(low, hex('#33435c'), moonUp * .5 * dark);
    const hz = proj(enu(o.az, 0)), hy = hz ? hz[1] : H;
    const g = c.createLinearGradient(0, Math.min(0, hy - H), 0, hy);
    g.addColorStop(0, rgb(top)); g.addColorStop(.55, rgb(mix(top, low, .3))); g.addColorStop(1, rgb(low));
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // Milky Way
    const mw = dark * (1 - .85 * moonUp) * [1, 1, .95, .8, .55, .32, .18, .1, .07][clamp(Math.round(o.bortle), 1, 9) - 1];
    if (mw > .02) {
      const sp = glowSprite(), gs = W > 700 ? 74 : 60;
      c.globalCompositeOperation = 'lighter';
      for (const p of GLOW) { const q = eq(p.ra, p.dec); if (on(q)) { c.globalAlpha = mw * .05 * p.w; c.drawImage(sp, q[0] - gs / 2, q[1] - gs / 2, gs, gs); } }
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#eee6dc';
      for (const p of DOTS) { const q = eq(p.ra, p.dec); if (on(q)) { c.globalAlpha = mw * (.15 + .5 * p.k * p.w); const s = .6 + p.k * .7; c.fillRect(q[0], q[1], s, s); } }
      c.globalAlpha = 1;
    }

    const tj = Astro.precess(o.target.ra, o.target.dec, o.t), tq = eq(tj.ra, tj.dec);
    // Constellations and stars (ghosted by day so you can still find your way)
    const vis = Math.max(.22, dark);
    const cloudDim = o.cloud == null ? 1 : 1 - .6 * o.cloud / 100;
    c.lineWidth = 1; c.font = `500 12px ${o.font}`; c.textAlign = 'left';
    const limit = 4.2 - glow * 2.2;
    for (const fig of FIGURES) {
      const pts = fig.s.map(s => eq(s[0] * 15, s[1]));
      c.strokeStyle = `rgba(190,208,226,${.26 * vis})`;
      c.beginPath();
      for (const [a, b] of fig.l) if (on(pts[a]) && on(pts[b]) && Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) < W) { c.moveTo(...pts[a]); c.lineTo(...pts[b]); }
      c.stroke();
      let sx = 0, sy = 0, n = 0;
      fig.s.forEach((s, i) => {
        const q = pts[i];
        if (!on(q)) return;
        sx += q[0]; sy += q[1]; n++;
        if (s[2] > limit && !fig.l.length) return;
        c.globalAlpha = vis * cloudDim * (s[2] > limit ? .45 : 1);
        c.fillStyle = '#fff'; c.beginPath(); c.arc(q[0], q[1], clamp(2.7 - s[2] * .5, .8, 3.4), 0, 7); c.fill();
        if (s[3] && W > 560 && !(tq && Math.abs(tq[1] - q[1]) < 26 && q[0] > tq[0] - 130 && q[0] < tq[0] + 190)) { c.globalAlpha = vis * .62; c.fillText(s[3], q[0] + 7, q[1] + 4); }
        c.globalAlpha = 1;
      });
      if (fig.name && n === fig.s.length && W > 560) {
        c.fillStyle = `rgba(190,208,226,${.5 * vis})`; c.textAlign = 'center';
        c.fillText(fig.name, sx / n, sy / n + 20); c.textAlign = 'left';
      }
    }

    // Moon
    const mq = proj(enu(sky.moonAz, sky.moonAlt));
    if (on(mq) && sky.moonAlt > -1) {
      const mg = c.createRadialGradient(mq[0], mq[1], 4, mq[0], mq[1], 70);
      mg.addColorStop(0, `rgba(255,240,205,${.5 * moonP.frac * Math.max(.2, dark)})`); mg.addColorStop(1, 'rgba(255,240,205,0)');
      c.fillStyle = mg; c.fillRect(mq[0] - 70, mq[1] - 70, 140, 140);
      c.fillStyle = `rgba(255,243,214,${.25 + .75 * Math.max(.4, dark)})`; c.beginPath(); c.arc(mq[0], mq[1], 8, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText('Moon', mq[0] + 13, mq[1] + 4);
    }

    // Targets
    const hits = [];
    const mark = (t, main) => {
      const p = Astro.precess(t.ra, t.dec, o.t), v = toV(p.ra, p.dec);
      if (v[2] < -.02) return;
      const q = proj(v);
      if (!on(q)) return;
      hits.push({ id: t.id, x: q[0], y: q[1] });
      if (main) {
        c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.arc(q[0], q[1], 17, 0, 7); c.stroke();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(q[0] + dx * 21, q[1] + dy * 21); c.lineTo(q[0] + dx * 28, q[1] + dy * 28); c.stroke(); }
        c.font = `600 15px ${o.font}`;
        const w = c.measureText(t.name).width, right = q[0] + 34 + w + 12 < W, tx = right ? q[0] + 34 : q[0] - 34 - w;
        c.fillStyle = 'rgba(4,8,14,.72)'; c.beginPath(); c.roundRect(tx - 7, q[1] - 13, w + 14, 26, 5); c.fill();
        c.fillStyle = '#fff'; c.fillText(t.name, tx, q[1] + 5);
      } else {
        c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1.3;
        c.strokeRect(q[0] - 4, q[1] - 4, 8, 8);
      }
    };
    for (const t of o.others) if (t.id !== o.target.id) mark(t, false);

    // Ground with a low ridge, and the compass
    c.beginPath();
    let started = false;
    for (let a = -110; a <= 110; a += 1) {
      const az = o.az + a, ridge = .9 + .7 * Math.sin(az * .11) + .5 * Math.sin(az * .31 + 1) + .25 * Math.sin(az * .83);
      const q = proj(enu(az, Math.max(0, ridge)));
      if (!q) continue;
      started ? c.lineTo(...q) : c.moveTo(...q); started = true;
    }
    c.lineTo(W * 3, H * 3); c.lineTo(-W * 2, H * 3); c.closePath();
    c.fillStyle = rgb(mix(hex('#05080a'), hex('#2c3a35'), clamp((sky.sun + 10) / 16, 0, 1))); c.fill();
    c.textAlign = 'center';
    const NAMES = { 0: 'North', 45: 'NE', 90: 'East', 135: 'SE', 180: 'South', 225: 'SW', 270: 'West', 315: 'NW' };
    for (let az = 0; az < 360; az += 15) {
      const q = proj(enu(az, 0));
      if (!on(q)) continue;
      const major = NAMES[az];
      c.strokeStyle = `rgba(255,255,255,${major ? .7 : .35})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(q[0], q[1] + 6); c.lineTo(q[0], q[1] + (major ? 13 : 10)); c.stroke();
      if (major && q[1] + 30 < H) { c.fillStyle = 'rgba(255,255,255,.92)'; c.font = `600 13px ${o.font}`; c.fillText(major, q[0], q[1] + 29); }
    }
    // Height guide: one tick per fist (10 degrees) above the horizon under the target
    const tp = Astro.precess(o.target.ra, o.target.dec, o.t), ta = Astro.altAz(tp.ra, tp.dec, o.loc.lat, o.loc.lon, o.t);
    if (ta.alt > 3) {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.beginPath();
      let first = true;
      for (let a = 0; a <= ta.alt - 4; a += 2) { const q = proj(enu(ta.az, a)); if (!q) continue; first ? c.moveTo(...q) : c.lineTo(...q); first = false; }
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,.95)';
      for (let a = 10; a < ta.alt - 3; a += 10) { const q = proj(enu(ta.az, a)); if (q) { c.beginPath(); c.arc(q[0], q[1], 3, 0, 7); c.fill(); } }
    }
    c.textAlign = 'left';
    mark(o.target, true);

    if (o.cloud != null && o.cloud > 25) { c.fillStyle = `rgba(150,160,172,${(o.cloud - 25) / 75 * .14})`; c.fillRect(0, 0, W, hy); }
    if (o.red) { c.globalCompositeOperation = 'multiply'; c.fillStyle = '#ff2a14'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
    return hits;
  }

  /* Night ribbon. o: {el, r, t, tz, red} */
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function ribbon(o) {
    const { r } = o, n = r.night, W = Math.max(280, o.el.clientWidth), L = 34, RR = 8, T = 26, PH = W > 600 ? 190 : 160;
    const cloudOn = r.s.some(x => x.cloud != null);
    const y1 = T + PH, yq = y1 + 46, yc = yq + 40, H = (cloudOn ? yc + 12 : yq + 12) + 6;
    const x = t => L + (W - L - RR) * (t - n.t0) / (n.t1 - n.t0), y = a => y1 - PH * clamp(a, 0, 90) / 90;
    const stops = r.s.filter((_, i) => i % 3 === 0).map(s => `<stop offset="${((s.t - n.t0) / (n.t1 - n.t0)).toFixed(4)}" stop-color="${strip(s.sun, o.red)}"/>`).join('');
    const path = key => {
      let d = '', pen = false;
      for (const s of r.s) { if (s[key] < 0) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(s.t).toFixed(1)} ${y(s[key]).toFixed(1)}`; pen = true; }
      return d;
    };
    const peak = key => r.s.reduce((a, b) => b[key] > a[key] ? b : a);
    let out = `<defs><linearGradient id="rb">${stops}</linearGradient></defs><rect x="${L}" y="${T}" width="${W - L - RR}" height="${PH}" rx="6" fill="url(#rb)"/>`;
    for (const a of [30, 60]) out += `<line x1="${L}" x2="${W - RR}" y1="${y(a)}" y2="${y(a)}" class="grid"/>`;
    for (const a of [0, 30, 60, 90]) out += `<text x="${L - 6}" y="${y(a) + 4}" class="tick" text-anchor="end">${a}°</text>`;
    if (r.window) {
      const a = x(r.window.start), b = x(r.window.end);
      out += `<rect x="${a}" y="${T}" width="${Math.max(2, b - a)}" height="${PH}" class="win"/><rect x="${a}" y="${T - 7}" width="${Math.max(3, b - a)}" height="5" rx="2" class="winbar"/>`;
      const label = `Best ${Zone.time(r.window.start, o.tz)} to ${Zone.time(r.window.end, o.tz)}`;
      out += `<text x="${clamp((a + b) / 2, L + 66, W - RR - 66)}" y="${T - 12}" class="winlabel" text-anchor="middle">${label}</text>`;
    }
    out += `<path d="${path('moonAlt')}" class="moonline"/><path d="${path('alt')}" class="targetline"/>`;
    const pt = peak('alt'), pm = peak('moonAlt');
    const tl = [clamp(x(pt.t), L + 60, W - RR - 60), y(pt.alt) < T + 22 ? y(pt.alt) + 34 : y(pt.alt) - 8];
    if (pt.alt > 4) out += `<text x="${tl[0]}" y="${tl[1]}" class="onsky strong" text-anchor="middle">${esc(r.target.name)}</text>`;
    if (pm.moonAlt > 8) {
      const ml = [clamp(x(pm.t), L + 24, W - RR - 24), y(pm.moonAlt) < T + 22 ? y(pm.moonAlt) + 18 : y(pm.moonAlt) - 8];
      if (Math.abs(ml[0] - tl[0]) < 100 && Math.abs(ml[1] - tl[1]) < 18) ml[1] = Math.max(ml[1], tl[1]) + 20;
      out += `<text x="${ml[0]}" y="${ml[1]}" class="onsky moon" text-anchor="middle">Moon</text>`;
    }
    const every = W > 720 ? 2 : W > 420 ? 3 : 4;
    for (let t = n.t0; t <= n.t1; t += 3600000) {
      const h = Zone.hour(t, o.tz);
      if (h % every === 0 && (every !== 3 || h % 3 === 0)) {
        const anchor = t === n.t0 ? 'start' : t >= n.t1 ? 'end' : 'middle';
        out += `<text x="${x(t)}" y="${y1 + 16}" class="tick" text-anchor="${anchor}">${String(h).padStart(2, '0')}</text>`;
      }
    }
    const cells = (yy, val, cls, max) => {
      let s = '';
      for (let i = 0; i < r.s.length - 1; i += 2) {
        const v = val(r.s[i]), a = x(r.s[i].t), b = x(r.s[Math.min(i + 2, r.s.length - 1)].t);
        if (v != null && v > 0) s += `<rect x="${a.toFixed(1)}" y="${yy}" width="${(b - a + .3).toFixed(1)}" height="12" class="${cls}" fill-opacity="${(.08 + .92 * v / max).toFixed(2)}"/>`;
      }
      return `<rect x="${L}" y="${yy}" width="${W - L - RR}" height="12" rx="3" class="track"/>${s}`;
    };
    out += `<text x="${L}" y="${yq - 6}" class="striplabel">Photo score, darker is worse</text>`.replace('darker is worse', o.light ? 'stronger is better' : 'brighter is better') + cells(yq, s => s.score, 'q', 100);
    if (cloudOn) out += `<text x="${L}" y="${yc - 6}" class="striplabel">Cloud forecast</text>` + cells(yc, s => s.cloud, 'cl', 100);
    if (Date.now() > n.t0 && Date.now() < n.t1) { const a = x(Date.now()); out += `<line x1="${a}" x2="${a}" y1="${T}" y2="${y1}" class="nowline"/><text x="${clamp(a, L + 14, W - 22)}" y="${y1 - 6}" class="onsky" text-anchor="${a > W - 60 ? 'end' : 'start'}" dx="${a > W - 60 ? -5 : 5}">now</text>`; }
    const cx = x(clamp(o.t, n.t0, n.t1)), at = r.s.reduce((a, b) => Math.abs(b.t - o.t) < Math.abs(a.t - o.t) ? b : a);
    out += `<line x1="${cx}" x2="${cx}" y1="${T}" y2="${H - 4}" class="cursor"/>`;
    if (at.alt > 0) out += `<circle cx="${cx}" cy="${y(at.alt)}" r="6" class="knob"/>`;
    out += `<line class="hoverline" y1="${T}" y2="${H - 4}" x1="-9" x2="-9"/>`;
    o.el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="presentation">${out}</svg>`;
    return { toTime: px => clamp(n.t0 + (px - L) / (W - L - RR) * (n.t1 - n.t0), n.t0, n.t1), x };
  }

  /* Moon phase glyph. phase 0 new .. 180 full .. 360. South of the equator it appears flipped. */
  function moonGlyph(phase, size, south) {
    const k = Math.cos(phase * R), wax = phase < 180, rx = Math.abs(k) * 9;
    // Lit half plus or minus the terminator ellipse.
    const d = `M10 1A9 9 0 0 1 10 19A${rx.toFixed(2)} 9 0 0 ${k > 0 ? 0 : 1} 10 1Z`;
    const flip = (wax ? 1 : -1) * (south ? -1 : 1);
    return `<svg class="moonglyph" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" class="mdark"/><path d="${d}" class="mlit" ${flip < 0 ? 'transform="matrix(-1 0 0 1 20 0)"' : ''}/><circle cx="10" cy="10" r="9" class="mrim"/></svg>`;
  }

  return { draw, ribbon, moonGlyph, esc };
})();

/* Positional astronomy. Angles are degrees, times are Unix milliseconds (UTC).
   Formulas follow Jean Meeus, "Astronomical Algorithms" (truncated series). */
const Astro = (() => {
  const R = Math.PI / 180;
  const sin = d => Math.sin(d * R), cos = d => Math.cos(d * R), tan = d => Math.tan(d * R);
  const norm = d => ((d % 360) + 360) % 360;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const days = ms => ms / 86400000 + 2440587.5 - 2451545.0; // days from J2000

  const gmst = ms => norm(280.46061837 + 360.98564736629 * days(ms));
  const obliquity = ms => 23.4393 - 3.563e-7 * days(ms);

  function eclToEq(lon, lat, ms) {
    const e = obliquity(ms);
    const ra = norm(Math.atan2(sin(lon) * cos(e) - tan(lat) * sin(e), cos(lon)) / R);
    const dec = Math.asin(sin(lat) * cos(e) + cos(lat) * sin(e) * sin(lon)) / R;
    return { ra, dec };
  }

  function sun(ms) {
    const n = days(ms), g = 357.528 + 0.9856003 * n;
    const lon = norm(280.460 + 0.9856474 * n + 1.915 * sin(g) + 0.020 * sin(2 * g));
    return { lon, ...eclToEq(lon, 0, ms) };
  }

  function moon(ms) {
    const T = days(ms) / 36525;
    const L = 218.3164477 + 481267.88123421 * T, D = 297.8501921 + 445267.1114034 * T;
    const M = 357.5291092 + 35999.0502909 * T, P = 134.9633964 + 477198.8675055 * T;
    const F = 93.2720950 + 483202.0175233 * T;
    const lon = norm(L + 6.288774 * sin(P) + 1.274027 * sin(2 * D - P) + 0.658314 * sin(2 * D)
      + 0.213618 * sin(2 * P) - 0.185116 * sin(M) - 0.114332 * sin(2 * F) + 0.058793 * sin(2 * D - 2 * P)
      + 0.057066 * sin(2 * D - M - P) + 0.053322 * sin(2 * D + P) + 0.045758 * sin(2 * D - M)
      - 0.040923 * sin(M - P) - 0.034720 * sin(D) - 0.030383 * sin(M + P) + 0.015327 * sin(2 * D - 2 * F)
      - 0.012528 * sin(P + 2 * F) + 0.010980 * sin(P - 2 * F));
    const lat = 5.128122 * sin(F) + 0.280602 * sin(P + F) + 0.277693 * sin(P - F) + 0.173237 * sin(2 * D - F)
      + 0.055413 * sin(2 * D - P + F) + 0.046271 * sin(2 * D - P - F) + 0.032573 * sin(2 * D + F)
      + 0.017198 * sin(2 * P + F) + 0.009266 * sin(2 * D + P - F) + 0.008822 * sin(2 * P - F);
    const dist = 385000.56 - 20905.355 * cos(P) - 3699.111 * cos(2 * D - P) - 2955.968 * cos(2 * D)
      - 569.925 * cos(2 * P) + 48.888 * cos(M) + 246.158 * cos(2 * D - 2 * P) - 152.138 * cos(2 * D - M - P)
      - 170.733 * cos(2 * D + P) - 204.586 * cos(2 * D - M) - 129.620 * cos(M - P) + 108.743 * cos(D);
    return { lon, lat, dist, ...eclToEq(lon, lat, ms) };
  }

  /* Illuminated fraction (0..1) and phase angle: 0 new, 90 first quarter, 180 full. */
  function moonPhase(ms) {
    const m = moon(ms), s = sun(ms);
    const elong = Math.acos(clamp(cos(m.lat) * cos(m.lon - s.lon), -1, 1)) / R;
    return { frac: (1 - cos(elong)) / 2, phase: norm(m.lon - s.lon) };
  }

  /* Apparent width of the Moon in arcminutes. */
  const moonSize = ms => 2 * Math.asin(1737.4 / moon(ms).dist) / R * 60;

  /* The next time the Moon reaches a phase angle (0 new, 90 first quarter, 180 full, 270 last quarter). */
  function nextPhase(angle, from) {
    const gap = ms => ((moonPhase(ms).phase - angle + 540) % 360) - 180; // signed, zero at the phase
    let a = from;
    for (; a < from + 31 * 864e5; a += 432e5) {
      const g0 = gap(a), g1 = gap(a + 432e5);
      if (g0 <= 0 && g1 > 0 && g1 - g0 < 90) break;
    }
    let b = a + 432e5;
    for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (gap(m) <= 0) a = m; else b = m; }
    return a;
  }

  /* Altitude, and azimuth measured from north through east. */
  function altAz(ra, dec, lat, lon, ms) {
    const H = gmst(ms) + lon - ra;
    const alt = Math.asin(clamp(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H), -1, 1)) / R;
    const az = norm(Math.atan2(sin(H), cos(H) * sin(lat) - tan(dec) * cos(lat)) / R + 180);
    return { alt, az };
  }

  function sunAlt(lat, lon, ms) { const s = sun(ms); return altAz(s.ra, s.dec, lat, lon, ms).alt; }

  function moonAltAz(lat, lon, ms) {
    const m = moon(ms), p = altAz(m.ra, m.dec, lat, lon, ms);
    // The Moon is close enough that the observer's position shifts it by up to 1 degree.
    p.alt -= Math.asin(6378.14 / m.dist * cos(p.alt)) / R;
    return { ...p, ra: m.ra, dec: m.dec };
  }

  /* J2000 catalogue position to the equinox of the given date. */
  function precess(ra, dec, ms) {
    const T = days(ms) / 36525, z = 0.6406161 * T, th = 0.5567530 * T;
    const A = cos(dec) * sin(ra + z), B = cos(th) * cos(dec) * cos(ra + z) - sin(th) * sin(dec);
    const C = sin(th) * cos(dec) * cos(ra + z) + cos(th) * sin(dec);
    return { ra: norm(Math.atan2(A, B) / R + z), dec: Math.asin(clamp(C, -1, 1)) / R };
  }

  function separation(ra1, d1, ra2, d2) {
    return Math.acos(clamp(sin(d1) * sin(d2) + cos(d1) * cos(d2) * cos(ra1 - ra2), -1, 1)) / R;
  }

  /* Galactic to equatorial J2000. */
  function galToEq(l, b) {
    const s = sin(b) * sin(27.12825) + cos(b) * cos(27.12825) * cos(122.93192 - l);
    const dec = Math.asin(clamp(s, -1, 1)) / R;
    const ra = norm(192.85948 + Math.atan2(cos(b) * sin(122.93192 - l),
      sin(b) * cos(27.12825) - cos(b) * sin(27.12825) * cos(122.93192 - l)) / R);
    return { ra, dec };
  }

  return { R, sin, cos, tan, norm, clamp, gmst, sun, moon, moonPhase, moonSize, nextPhase, altAz, sunAlt, moonAltAz, precess, separation, galToEq };
})();

/* Wall-clock times in any IANA time zone. */
const Zone = (() => {
  const cache = {};
  const parts = tz => cache[tz] || (cache[tz] = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  function wall(ms, tz) {
    const o = {};
    for (const p of parts(tz).formatToParts(ms)) if (p.type !== 'literal') o[p.type] = +p.value;
    return o;
  }
  function offset(ms, tz) {
    const w = wall(ms, tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
  }
  function toUtc(dateStr, h, m, tz) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, m);
    return guess - offset(guess - offset(guess, tz), tz);
  }
  const pad = n => String(n).padStart(2, '0');
  const date = (ms, tz) => { const w = wall(ms, tz); return `${w.year}-${pad(w.month)}-${pad(w.day)}`; };
  const time = (ms, tz) => { const w = wall(ms, tz); return `${pad(w.hour)}:${pad(w.minute)}`; };
  const hour = (ms, tz) => wall(ms, tz).hour;
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function pretty(dateStr, opt = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return new Intl.DateTimeFormat('en-GB', { ...opt, timeZone: 'UTC' }).format(new Date(dateStr + 'T12:00:00Z'));
  }
  const valid = tz => { try { parts(tz); return true; } catch { return false; } };
  const fromLongitude = lon => {
    const n = Math.round(lon / 15);
    return n === 0 ? 'Etc/GMT' : `Etc/GMT${n > 0 ? '-' : '+'}${Math.abs(n)}`;
  };
  return { wall, offset, toUtc, date, time, hour, addDays, pretty, valid, fromLongitude };
})();

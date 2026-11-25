/* Interface: state, rendering and events. */
(() => {
  const $ = id => document.getElementById(id), esc = Sky.esc, clamp = Astro.clamp;
  const all = sel => [...document.querySelectorAll(sel)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('fl.' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('fl.' + k, JSON.stringify(v)); } catch { /* private window */ } },
  };
  const byId = id => TARGETS.find(t => t.id === id);

  // ---------- state ----------
  const deviceZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
  const guess = PLACES.find(p => p.tz === deviceZone && !p.dark)
    || PLACES.find(p => !p.dark && Zone.valid(deviceZone) && Zone.offset(Date.now(), p.tz) === Zone.offset(Date.now(), deviceZone)) || PLACES[0];
  const saved = store.get('settings') || {};
  const st = {
    loc: saved.loc && Zone.valid(saved.loc.tz) && isFinite(saved.loc.lat) ? saved.loc : { ...guess },
    bortle: saved.bortle || 6, gear: saved.gear ?? 1,
    cam: { sensor: 'apsc', f: 24, n: 2.8, ...(saved.cam || {}) },
    theme: saved.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
    tab: 'tonight', mode: 'night', kind: 'all', target: null, date: null, t: Date.now(), az: 180, alt: 34, weather: null, wx: 'idle',
  };
  const persist = () => store.set('settings', { loc: st.loc, bortle: st.bortle, gear: st.gear, cam: st.cam, theme: st.theme });
  const ctx = () => ({ loc: st.loc, bortle: st.bortle, weather: st.weather });
  const tz = () => st.loc.tz, hm = t => Zone.time(t, tz());

  let cache = new Map();
  const result = (target, date) => {
    const k = target.id + date;
    if (!cache.has(k)) cache.set(k, Planner.evaluate(target, date, ctx()));
    return cache.get(k);
  };
  const rank = r => r.score * (r.target.gear <= st.gear ? 1 : .2);
  const top = rs => rs.reduce((a, b) => rank(b) > rank(a) ? b : a);
  function bestTarget() {
    const r = top(TARGETS.map(t => result(t, st.date)));
    // On a hopeless night, show the target that would win under a clear sky, so the reason given is useful.
    return r.score >= 28 && r.target.gear <= st.gear ? r.target
      : top(TARGETS.map(t => Planner.evaluate(t, st.date, { ...ctx(), weather: null }))).target;
  }

  // ---------- words ----------
  const DIR = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
  const dir = az => DIR[Math.round(az / 22.5) % 16];
  const fists = alt => { const n = Math.round(alt / 5) / 2; return n >= 8 ? 'almost straight up' : `${n === Math.floor(n) ? n : Math.floor(n) + '½'} fist${n === 1 ? '' : 's'} above the horizon`; };
  const span = ms => { const m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };
  const pips = g => `<span class="pips" aria-hidden="true">${[1, 2, 3, 4].map(i => `<i class="${i <= g.k ? 'on' : ''}"></i>`).join('')}</span>`;
  const kindWord = t => t.type === 'Milky Way' ? 'Milky Way' : t.type === 'Supernova remnant' ? t.type : `${t.type} nebula`;
  const SYM = { // star-atlas style symbols
    'Milky Way': '<path d="M2 15C6 8 14 12 18 5M4 18c4-5 10-3 14-8"/>', Emission: '<rect x="4" y="4" width="12" height="12"/>', Reflection: '<rect x="4" y="4" width="12" height="12" stroke-dasharray="2.5 2"/>',
    Dark: '<rect x="4" y="4" width="12" height="12" style="fill:var(--ink2)"/>', Planetary: '<circle cx="10" cy="10" r="5"/><path d="M10 1v4M10 15v4M1 10h4M15 10h4"/>', 'Supernova remnant': '<path d="M10 2l2 5 5-2-2 5 4 3-5 1 0 5-4-3-4 3v-5l-5-1 4-3-2-5 5 2z"/>',
  };
  const sym = t => `<svg class="sym" viewBox="0 0 20 20" aria-hidden="true">${SYM[t.type]}</svg>`;
  function toast(msg) { const e = $('toast'); e.textContent = msg; e.classList.add('on'); clearTimeout(toast.k); toast.k = setTimeout(() => e.classList.remove('on'), 2600); }
  const nightName = d => d === Planner.nightOf(Date.now(), st.loc) ? 'tonight' : `on ${Zone.pretty(d)}`;

  // ---------- rendering: tonight ----------
  function renderHeader() {
    const off = Zone.offset(Date.now(), tz()) / 60000, s = off < 0 ? '−' : '+', a = Math.abs(off);
    $('placeBtn').innerHTML = `<b>${esc(st.loc.name)}</b><small>${hm(Date.now())} local (UTC${s}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}), ${esc(siteName())}. Change</small>`;
    document.documentElement.dataset.theme = st.theme;
    all('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === st.theme));
  }
  const siteName = () => (Planner.DARK_SITES.find(d => d.b === st.bortle) || { label: 'custom' }).label.toLowerCase() + ' sky';

  function renderNow() {
    const now = Date.now(), sky = Planner.skyAt(now, st.loc), n = Planner.night(Planner.nightOf(now, st.loc), st.loc);
    let msg;
    if (sky.sun > -12) {
      const word = sky.sun > -.8 ? 'it is daylight' : 'it is twilight';
      msg = n.lowestSun > -12 ? `${word}, and the sky will not get dark enough tonight at this latitude.`
        : n.darkStart && n.darkStart > now ? `${word}. Full darkness starts at ${hm(n.darkStart)}, in ${span(n.darkStart - now)}.`
        : n.darkStart ? `${word}.` : `${word}. The sky gets fairly dark tonight, but never fully.`;
    } else {
      const c = Planner.cloudAt(st.weather, now);
      const up = TARGETS.filter(t => t.gear <= st.gear).map(t => ({ t, s: Planner.scoreAt(t, now, ctx()) })).sort((a, b) => b.s.score - a.s.score)[0];
      msg = up && up.s.score >= 20 ? `it is dark. Best target this minute: <button type="button" data-pick="${up.t.id}">${esc(up.t.name)}</button>, in the ${dir(up.s.az)}.`
        : c > 70 ? `it is dark but ${Math.round(c)}% cloudy.` : 'it is dark, but nothing suits your equipment and sky this minute.';
    }
    $('nowbar').innerHTML = `<b>Right now, ${hm(now)} in ${esc(st.loc.name)}:</b> ${msg}`;
  }

  function renderWhen() {
    $('dateIn').value = st.date; $('timeIn').value = hm(st.t);
    const n = Planner.night(st.date, st.loc), bits = [];
    if (n.sunset) bits.push(`Sunset ${hm(n.sunset)}`);
    if (n.darkStart && n.darkEnd) bits.push(`Dark ${hm(n.darkStart)} to ${hm(n.darkEnd)}`);
    else bits.push(n.lowestSun > 0 ? 'Sun stays up' : n.darkHours > 20 ? 'Dark all day' : n.lowestSun > -18 ? 'Never fully dark' : `${n.darkHours.toFixed(0)} h of darkness`);
    $('sundata').innerHTML = bits.map(b => `<span>${b}</span>`).join('') + `<span>${Sky.moonGlyph(n.moon.phase, 20, st.loc.lat < 0)} Moon ${Math.round(n.moon.frac * 100)}%</span>`;
  }

  function nextGood(target, from, days = 30) {
    for (let i = 0; i < days; i++) { const r = result(target, Zone.addDays(from, i)); if (r.score >= 50) return r; }
    return null;
  }

  function renderVerdict() {
    const t = byId(st.target), r = result(t, st.date), when = nightName(st.date), w = r.window;
    let h, lead, buttons = '';
    if (w && r.score >= 28) {
      h = `${esc(t.name)} at ${hm(w.peak.t)}`;
      lead = `Best between <b>${hm(w.start)}</b> and <b>${hm(w.end)}</b> ${when}. At ${hm(w.peak.t)}, face ${dir(w.peak.az)} and look ${fists(w.peak.alt)}.`;
      buttons = `<button type="button" class="main" data-act="ics">Add to calendar</button><button type="button" class="quiet" data-act="save">Save plan</button>`;
    } else {
      h = `${esc(t.name)}: ${when === 'tonight' ? 'not tonight' : 'not this night'}`;
      lead = esc(Planner.blocker(r, ctx()));
      if (w) lead += ` If you try anyway, the best moment is ${hm(w.peak.t)}.`;
      const g = nextGood(t, Zone.addDays(st.date, 1));
      if (g) { lead += ` Next good night: <b>${Zone.pretty(g.night.date)}</b>.`; buttons = `<button type="button" class="main" data-goto="${g.night.date}">See ${Zone.pretty(g.night.date)}</button>`; }
      else buttons = `<button type="button" class="quiet" data-act="season">See its best months</button>`;
    }
    const fr = framing(t);
    const warn = t.gear > st.gear ? `Best with ${GEAR_NEED[t.gear]}. You chose: ${GEAR[st.gear].toLowerCase()}.`
      : w && st.gear > 0 && fr.frac < .05 ? `It will look very small at ${st.cam.f} mm. Aim for a ${fr.sugg} lens if you can.` : '';
    $('verdict').innerHTML = `<div class="gradeline"><span class="grade">${pips(r.grade)}${r.grade.word}</span><span>${r.score} out of 100${r.hasForecast ? '' : ', cloud not included'}</span></div><h1>${h}</h1><p class="lead">${lead}</p><p class="about">${esc(t.about)}</p>${warn ? `<p class="gearwarn">${warn}</p>` : ''}<div class="row">${buttons}<button type="button" class="quiet" data-act="camera">Camera settings</button></div>`;
  }

  let hits = [], axis = null;
  function drawSky() {
    const t = byId(st.target), p = Planner.scoreAt(t, st.t, ctx());
    hits = Sky.draw($('sky'), { loc: st.loc, t: st.t, az: st.az, alt: st.alt, bortle: st.bortle, target: t, others: TARGETS, cloud: p.cloud, red: st.theme === 'red', font: getComputedStyle(document.body).fontFamily });
    const text = p.alt > 0 ? `${t.name} is in the ${dir(p.az)}, ${fists(p.alt)} (${Math.round(p.alt)}°). One fist at arm’s length covers about 10° of sky.` : `${t.name} is below the horizon at ${hm(st.t)}.`;
    $('skycap').textContent = `${hm(st.t)}, facing ${dir(st.az)}. ${text}`;
    $('sky').setAttribute('aria-label', `Simulated sky at ${hm(st.t)} facing ${dir(st.az)}. ${text} Use left and right arrow keys to look around.`);
  }
  function face() {
    const p = Planner.scoreAt(byId(st.target), st.t, ctx());
    if (p.alt > 0) { st.az = p.az; st.alt = clamp(p.alt - 6, 26, 52); } else { st.az = p.az; st.alt = 26; }
  }

  function drawRibbon() {
    const r = result(byId(st.target), st.date);
    axis = Sky.ribbon({ el: $('ribbon'), r, t: st.t, tz: tz(), red: st.theme === 'red', light: st.theme === 'light' });
    const el = $('ribbon'), n = r.night;
    el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', Math.round((n.t1 - n.t0) / 60000));
    el.setAttribute('aria-valuenow', Math.round((st.t - n.t0) / 60000)); el.setAttribute('aria-valuetext', hm(st.t));
  }
  function renderTable() {
    const r = result(byId(st.target), st.date);
    $('ribbonTable').innerHTML = `<table><thead><tr><th>Time</th><th>Height</th><th>Direction</th><th>Moon height</th><th>Cloud</th><th>Score</th></tr></thead><tbody>${r.s.filter((_, i) => i % 6 === 0).map(s => `<tr><td>${hm(s.t)}</td><td>${s.alt > 0 ? Math.round(s.alt) + '°' : 'Below horizon'}</td><td>${dir(s.az)}</td><td>${s.moonAlt > 0 ? Math.round(s.moonAlt) + '°' : 'Down'}</td><td>${s.cloud == null ? 'No forecast' : Math.round(s.cloud) + '%'}</td><td>${Math.round(s.score)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderFactors() {
    const t = byId(st.target), s = Planner.scoreAt(t, st.t, ctx()), f = s.f, m = Math.round(Astro.moonPhase(st.t).frac * 100);
    const lvl = v => v >= .7 ? ['g', '✓ Good'] : v >= .35 ? ['m', '– So-so'] : ['x', '✕ Poor'];
    const dark = s.sun > -.8 ? 'The Sun is up.' : s.sun > -12 ? 'Twilight. Stars are just coming out or fading.' : s.sun > -18 ? 'Nearly full darkness.' : 'Full darkness.';
    const high = s.alt <= 0 ? 'Below the horizon.' : s.alt < t.minAlt ? `${Math.round(s.alt)}° up, lost in horizon haze.` : s.alt < 30 ? `${Math.round(s.alt)}° up. Low, so you look through more air.` : `${Math.round(s.alt)}° up, in clear air.`;
    const moon = s.moonAlt < 0 ? 'The Moon is down.' : m < 15 ? `Thin Moon (${m}% lit), little effect.` : `Moon is ${m}% lit and ${Math.round(s.moonAlt)}° up.${t.moon < .6 ? ' This target copes fairly well.' : ''}`;
    const light = { faint: 'This target is faint, so dark skies matter most.', medium: 'Moderately affected by sky glow.', bright: 'Bright enough to survive some sky glow.' }[t.light];
    const rows = [['Darkness', lvl(f.dark), dark], ['Height', lvl(f.alt), high], ['Moonlight', lvl(f.moon), moon], ['Sky glow', lvl(f.light), `${siteName()[0].toUpperCase() + siteName().slice(1)}. ${light}`],
      ['Cloud', s.cloud == null ? ['n', 'Unknown'] : lvl(f.cloud), s.cloud == null ? (st.wx === 'failed' ? 'Forecast could not be loaded. Check your local weather.' : st.wx === 'loading' ? 'Loading the forecast.' : 'No forecast for this date yet. Check again closer to the night.') : `${Math.round(s.cloud)}% cloud forecast.`]];
    $('factorHead').textContent = `Conditions at ${hm(st.t)}`;
    $('factors').innerHTML = rows.map(([a, [c, w], d]) => `<li><b>${a}</b><span class="lvl ${c}">${w}</span><span>${esc(d)}</span></li>`).join('');
  }

  function renderList() {
    all('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
    all('[data-kind]').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind));
    $('modeTime').textContent = `At ${hm(st.t)}`;
    const rows = TARGETS.filter(t => st.kind === 'all' || (st.kind === 'mw') === (t.type === 'Milky Way')).map(t => {
      if (st.mode === 'night') {
        const r = result(t, st.date);
        return { t, score: r.score, sub: r.window ? `${hm(r.window.start)} to ${hm(r.window.end)}` : kindWord(t) };
      }
      const s = Planner.scoreAt(t, st.t, ctx());
      return { t, score: Math.round(s.score), sub: s.alt > 0 ? `${Math.round(s.alt)}° up, ${dir(s.az)}` : 'Below horizon' };
    }).sort((a, b) => b.score - a.score);
    const item = x => `<button type="button" class="t${x.score < 8 ? ' off' : ''}" data-pick="${x.t.id}" aria-current="${x.t.id === st.target}">${sym(x.t)}<span><b>${esc(x.t.name)}</b><small>${esc(x.sub)}</small></span><span class="sc">${x.score < 8 ? '–' : x.score}<small>${Planner.grade(x.score).word}</small></span></button>`;
    const ok = rows.filter(x => x.score >= 8 && x.t.gear <= st.gear), more = rows.filter(x => x.score >= 8 && x.t.gear > st.gear), no = rows.filter(x => x.score < 8);
    const fold = (title, xs, open) => xs.length ? `<details ${open ? 'open' : ''}><summary>${title} (${xs.length})</summary>${xs.map(item).join('')}</details>` : '';
    const openNo = xs => xs.some(x => x.t.id === st.target);
    $('list').innerHTML = (ok.length ? `<h3>Works with your ${GEAR[st.gear].toLowerCase()}</h3>${ok.map(item).join('')}` : `<h3>Nothing suits your equipment ${st.mode === 'night' ? 'this night' : 'at this time'}</h3>`)
      + fold('Needs more equipment', more, !ok.length || openNo(more)) + fold(st.mode === 'night' ? 'Not possible this night' : 'Not possible at this time', no, openNo(no));
  }

  function renderTime() { $('timeIn').value = hm(st.t); drawSky(); drawRibbon(); renderFactors(); if (st.mode === 'time') renderList(); else $('modeTime').textContent = `At ${hm(st.t)}`; }
  function renderTonight() { renderNow(); renderWhen(); renderVerdict(); renderList(); renderTable(); renderTime(); }

  // ---------- rendering: plan ahead ----------
  function renderAhead() {
    const t = byId(st.target), start = Planner.nightOf(Date.now(), st.loc), dow = (new Date(start + 'T12:00Z').getUTCDay() + 6) % 7;
    $('aheadTarget').value = t.id;
    const rs = Array.from({ length: 35 - dow }, (_, i) => result(t, Zone.addDays(start, i)));
    const top = rs.filter(r => r.score >= 28).sort((a, b) => b.score - a.score).slice(0, 3);
    const best = new Set(top.map(r => r.night.date));
    $('bestnights').innerHTML = top.length
      ? `<h1>Best night: ${Zone.pretty(top[0].night.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h1><p>Score ${top[0].score}, ${hm(top[0].window.start)} to ${hm(top[0].window.end)}.${top.length > 1 ? ` Also good: ${top.slice(1).map(r => `${Zone.pretty(r.night.date)} (${r.score})`).join(' and ')}.` : ''}</p>`
      : `<h1>No good night in the next five weeks</h1><p>${esc(Planner.blocker(rs.reduce((a, b) => b.score > a.score ? b : a), ctx()))}</p>`;
    const fc = rs.filter(r => r.hasForecast).length;
    $('calnote').textContent = `Scores out of 100. ${fc ? `The first ${fc} nights include the cloud forecast, which gets less reliable after about five days. Later nights count Moon and darkness only.` : 'Cloud is not included.'} Choose a night to see it in detail.`;
    $('cal').innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('') + '<div></div>'.repeat(dow)
      + rs.map((r, i) => {
        const d = r.night.date, w = r.window, first = i === 0 || d.endsWith('-01');
        return `<button type="button" class="day${r.score < 8 ? ' zero' : ''}${best.has(d) ? ' best' : ''}" style="--h:${r.score}%" data-goto="${d}" aria-label="${Zone.pretty(d)}: ${r.grade.word}, score ${r.score}${w ? `, ${hm(w.start)} to ${hm(w.end)}` : ''}, Moon ${Math.round(r.night.moon.frac * 100)}% lit"><span class="d"><span>${Zone.pretty(d, first ? { day: 'numeric', month: 'short' } : { day: 'numeric' })}</span>${Sky.moonGlyph(r.night.moon.phase, 16, st.loc.lat < 0)}</span><span class="n">${r.score < 8 ? '–' : r.score}</span><span class="w">${w ? `${hm(w.start)}–${hm(w.end)}` : ''}${r.hasForecast && r.s[84] && w && w.peak.cloud > 50 ? ' cloudy' : ''}</span></button>`;
      }).join('');
    const year = +start.slice(0, 4), wk = Planner.season(t, year, st.loc), months = Array.from({ length: 12 }, () => []);
    wk.forEach(x => months[+x.date.slice(5, 7) - 1].push(x.h));
    const avg = months.map(m => m.reduce((a, b) => a + b, 0) / (m.length || 1)), mx = Math.max(...avg, .1);
    $('seasonHead').textContent = `Best months for ${t.name} from ${st.loc.name}`;
    $('season').innerHTML = mx <= .1 ? '<p class="note" style="grid-column:1/-1;text-align:left">It is never well placed in a dark sky from here.</p>'
      : avg.map((h, i) => `<div class="col${i === +start.slice(5, 7) - 1 ? ' cur' : ''}"><div class="bar"><span>${h < .05 ? '0' : h < 9.95 ? h.toFixed(1) : Math.round(h)}</span><i style="height:${(h / mx * 104).toFixed(0)}px"></i></div><div class="m">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]}</div></div>`).join('');
    renderPlans();
  }
  function renderPlans() {
    const ps = store.get('plans') || [];
    $('plans').innerHTML = ps.length ? ps.map((p, i) => `<div class="plan"><div><b>${esc(p.title)}</b><small>${esc(p.detail)}</small></div><button type="button" class="quiet" data-planics="${i}">Add to calendar</button><button type="button" class="quiet" data-plandel="${i}">Remove</button></div>`).join('') : '<p class="note">Nothing saved yet. Choose a night above, then press Save plan.</p>';
  }

  // ---------- rendering: camera ----------
  const SENSORS = { full: ['Full frame', 36, 24], apsc: ['APS-C (most beginner cameras)', 23.5, 15.6], mft: ['Micro Four Thirds', 17.3, 13], one: ['1-inch compact', 13.2, 8.8] };
  const SHUTTERS = [.5, .6, .8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13, 15, 20, 25];
  const PIXEL = 4.3; // typical pixel size in microns
  function settings(t) {
    const b = st.bortle, g = st.gear, mw = t.type === 'Milky Way', { f, n } = st.cam, rows = [];
    const total = (mw ? 8 : { bright: 30, medium: 90, faint: 180 }[t.light]) * (b <= 3 ? 1 : b <= 5 ? 1.5 : 2.5);
    const frames = s => Math.min(g === 1 ? 300 : 200, Math.max(10, Math.ceil(total * 60 / s / 10) * 10));
    if (g === 0) {
      rows.push(['Mode', 'Night or Astro', 'Look for Astrophotography, Night Sky or Pro mode.']);
      rows.push(['Shutter', b >= 6 ? '10 s' : '15 to 30 s', 'Or the longest the phone allows on a tripod.']);
      rows.push(['ISO', b >= 6 ? '400 to 800' : '1600 to 3200', 'Lower it if the sky looks orange or grey.']);
      rows.push(['Focus', 'Infinity', 'The mountain icon, or slide manual focus all the way out.']);
      rows.push(['Timer', '3 s', 'So tapping the screen does not shake the shot.']);
    } else {
      let s, why;
      if (g === 1) {
        const npf = (35 * n + 30 * PIXEL) / f / Math.max(.25, Math.cos(t.dec * Astro.R));
        s = SHUTTERS.filter(x => x <= Math.min(25, npf)).pop() || .5; why = 'The longest before stars smear into lines as Earth turns.';
      } else if (g === 2) { s = f > 200 ? 45 : f > 85 ? 60 : 120; if (b >= 6) s = Math.min(s, 60); why = 'Try it, zoom in, and shorten it if stars look stretched.'; }
      else { s = t.light === 'bright' ? 60 : b >= 6 ? 90 : 180; why = 'Use guiding if your mount supports it.'; }
      const iso = g === 1 ? (b >= 8 ? 800 : b >= 5 ? 1600 : 3200) : b >= 6 ? 800 : 1600;
      rows.push(['Shutter', `${s} s`, why], ['Aperture', `f/${n}`, n > 4 ? 'Open it as wide as it goes. A faster lens helps a lot.' : 'Wide open gathers the most light. Close one stop if corner stars look like birds.'],
        ['ISO', String(iso), b >= 6 ? 'Kept low because the bright sky fills the photo quickly.' : 'A dark sky lets you go higher.'],
        ['Frames', String(frames(s)), `About ${span(frames(s) * s * 1000)} in all. Stack them in Siril, Sequator or DeepSkyStacker, all free.`],
        ['File type', 'RAW', 'Keeps faint colour you can bring out later.'], ['White balance', '4000 K', 'Easy to change later if you shoot RAW.'], ['Focus', 'Manual', 'Magnify a bright star on screen and turn until it is the smallest dot.']);
    }
    if (['Emission', 'Planetary', 'Supernova remnant'].includes(t.type) && b >= 5 && g > 0) rows.push(['Filter', 'Dual-band', 'Optional. Passes the glow of this nebula and blocks most city light.']);
    return rows;
  }
  /* How large the target appears with the chosen lens, and a better focal length for this sensor. */
  function framing(t) {
    const [, sw, sh] = st.gear === 0 ? ['', 36, 27] : SENSORS[st.cam.sensor], f = st.gear === 0 ? 26 : st.cam.f;
    const fov = d => 2 * Math.atan(d / 2 / f) / Astro.R, crop = 36 / sw;
    const mm = t.mm.map(x => Math.round(x / crop / 5) * 5 || Math.round(x / crop));
    return { sw, sh, fw: fov(sw), fh: fov(sh), frac: t.size / 60 / fov(sw), sugg: mm[0] === mm[1] ? `${mm[0]} mm` : `${mm[0]} to ${mm[1]} mm` };
  }
  function renderCamera() {
    const t = byId(st.target), g = st.gear;
    $('camTarget').value = t.id; $('camGear').value = g; $('camSensor').value = st.cam.sensor;
    if (document.activeElement !== $('camF')) $('camF').value = st.cam.f;
    if (document.activeElement !== $('camN')) $('camN').value = st.cam.n;
    $('camLens').hidden = g === 0;
    $('camHead').textContent = `Start with these settings for ${t.name}`;
    $('settings').innerHTML = settings(t).map(([a, v, e]) => `<div><dt>${a}</dt><dd class="v">${v}</dd><dd class="e">${esc(e)}</dd></div>`).join('');
    const { sw, sh, fw, fh, frac, sugg } = framing(t);
    const w = 220, h = w * sh / sw, rx = clamp(w * frac / 2, 1.2, 160), ry = Math.min(rx * (t.type === 'Milky Way' ? .45 : .72), 110);
    const hash = i => Math.abs(Math.sin(i * 127.1 + 3.7) * 43758.5453) % 1;
    const dots = Array.from({ length: 46 }, (_, i) => `<circle cx="${(hash(i) * w).toFixed(1)}" cy="${(hash(i + 99) * h).toFixed(1)}" r="${.4 + (i % 5) * .18}" fill="#fff" opacity=".7"/>`).join('');
    const fill = { Emission: '#d9566b', Reflection: '#6f9bea', Planetary: '#4fc7b8', 'Supernova remnant': '#c986a0', Dark: '#000', 'Milky Way': '#d8c7ad' }[t.type];
    $('frameBox').innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="How large the target looks in your frame">${dots}<defs><radialGradient id="nb"><stop offset="0" stop-color="${fill}" stop-opacity=".95"/><stop offset=".6" stop-color="${fill}" stop-opacity=".5"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs><ellipse cx="${w / 2}" cy="${h / 2}" rx="${rx}" ry="${ry}" fill="url(#nb)" transform="rotate(-18 ${w / 2} ${h / 2})"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-opacity=".5" transform="rotate(-18 ${w / 2} ${h / 2})"/></svg>`;
    const pct = Math.round(frac * 100), deg = x => x < 2 ? x.toFixed(1) : Math.round(x);
    $('frameText').innerHTML = `Your view is ${deg(fw)}° by ${deg(fh)}°. ${esc(t.name)} would fill ${pct < 1 ? 'less than 1' : pct > 100 ? 'more than 100' : 'about ' + pct}% of the width. `
      + (g === 0 && t.type !== 'Milky Way' ? 'Too small for a phone. Try the Milky Way instead.' : frac > 1.05 ? `Too big to fit whole. Use ${sugg}, or shoot a panorama.` : frac < .07 ? `That is tiny. Aim for ${sugg}.` : frac < .18 ? `A wide view with sky around it. For a closer look, use ${sugg}.` : 'That is a good fit.');
    const r = result(t, st.date), wn = r.window;
    $('steps').innerHTML = [
      `<b>Arrive early.</b> ${wn ? `Be set up by ${hm(wn.start - 45 * 60000)} so your eyes and camera can settle before ${hm(wn.start)} ${nightName(st.date)}.` : 'Be set up 45 minutes before your window starts.'}`,
      `<b>Point.</b> ${wn ? `Face ${dir(wn.peak.az)} at ${hm(wn.peak.t)}, ${fists(wn.peak.alt)}. ` : ''}Check the sky window on the Tonight tab.`,
      g >= 2 ? `<b>Polar align</b> your mount on ${st.loc.lat >= 0 ? 'Polaris, due north' : 'the south celestial pole, due south'}, about ${Math.round(Math.abs(st.loc.lat))}° up.` : '<b>Steady the tripod.</b> Keep it low, hang a bag from it, and turn off image stabilisation.',
      '<b>Focus on a bright star</b>, then do not touch the focus ring again.', '<b>Take one test shot.</b> Zoom in: round stars mean focus and shutter are right. Adjust one thing at a time.',
      '<b>Shoot the full set</b> with a timer or remote.', g === 0 ? '<b>Keep warm and charged.</b> Cold drains a phone quickly.' : '<b>Finish with 20 dark frames:</b> same settings, lens cap on. Stacking software uses them to remove noise.',
      '<b>Use the Red screen</b> outdoors so your eyes stay adapted to the dark.'].map(x => `<li>${x}</li>`).join('');
  }

  // ---------- actions ----------
  function render() {
    renderHeader();
    all('[data-tab]').forEach(b => { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; $(b.dataset.tab).hidden = !on; });
    ({ tonight: renderTonight, ahead: renderAhead, camera: renderCamera })[st.tab]();
    $('wxnote').textContent = st.wx === 'ok' ? 'Cloud forecast loaded from Open-Meteo.' : st.wx === 'failed' ? 'Cloud forecast could not be loaded, so scores leave cloud out.' : st.wx === 'loading' ? 'Loading the cloud forecast.' : '';
  }
  function setTab(x) { st.tab = x; render(); window.scrollTo(0, 0); }
  function jumpBest() {
    const r = result(byId(st.target), st.date), n = r.night;
    st.t = r.window ? r.window.peak.t : r.s.reduce((a, b) => b.sun < a.sun ? b : a).t;
    face();
  }
  function setDate(d) { if (!/^\d{4}-\d\d-\d\d$/.test(d)) return; st.date = d; jumpBest(); render(); }
  function pick(id) { st.target = id; jumpBest(); render(); }
  function resetNight() { st.date = Planner.nightOf(Date.now(), st.loc); cache.clear(); st.target = bestTarget().id; jumpBest(); }

  function planOf() {
    const t = byId(st.target), r = result(t, st.date), w = r.window;
    return { title: `Photograph ${t.name}`, start: w.start, end: w.end, where: `${st.loc.name} (${st.loc.lat.toFixed(2)}, ${st.loc.lon.toFixed(2)})`,
      detail: `${Zone.pretty(st.date)}, ${hm(w.start)} to ${hm(w.end)} from ${st.loc.name}. Best at ${hm(w.peak.t)}: face ${dir(w.peak.az)}, ${fists(w.peak.alt)}. Score ${r.score}.` };
  }
  function ics(p) {
    const z = ms => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, ''), q = s => s.replace(/[\\;,]/g, m => '\\' + m);
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//First Light//EN', 'BEGIN:VEVENT', `UID:${p.start}-${Math.random().toString(36).slice(2)}@first-light`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(p.start)}`, `DTEND:${z(Math.max(p.end, p.start + 6e5))}`, `SUMMARY:${q(p.title)}`, `LOCATION:${q(p.where)}`, `DESCRIPTION:${q(p.detail)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Check the sky', 'TRIGGER:-PT2H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); a.download = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.ics';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Calendar file saved. Open it to add the event.');
  }

  // ---------- weather ----------
  let wxRun = 0;
  async function loadWeather() {
    const run = ++wxRun, loc = st.loc;
    st.weather = null; st.wx = 'loading'; cache.clear();
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(2)}&longitude=${loc.lon.toFixed(2)}&hourly=cloud_cover&past_days=1&forecast_days=16&timeformat=unixtime&timezone=auto`;
      const res = await fetch(u, { signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      if (run !== wxRun) return;
      st.weather = { t0: j.hourly.time[0] * 1000, cloud: j.hourly.cloud_cover }; st.wx = 'ok';
      if (loc.guessTz && j.timezone && Zone.valid(j.timezone)) { st.loc = { ...loc, tz: j.timezone, guessTz: false }; persist(); }
    } catch { if (run !== wxRun) return; st.wx = 'failed'; }
    cache.clear();
    const touched = st.touched;
    if (!touched) resetNight();
    render();
  }

  // ---------- setup dialog ----------
  let draft = null, searchRun = 0, searchTimer;
  function openSetup(first) {
    draft = { loc: st.loc, bortle: st.bortle };
    $('setupIntro').textContent = first ? `Welcome. Your time zone suggests you are near ${st.loc.name}. Keep that or choose another place, and First Light will tell you what to photograph and when.` : 'Pick any place in the world. Times are shown in that place’s local time.';
    $('q').value = ''; $('results').innerHTML = '';
    $('latIn').value = draft.loc.lat.toFixed(2); $('lonIn').value = draft.loc.lon.toFixed(2);
    $('darkRadios').innerHTML = Planner.DARK_SITES.map(d => `<label><input type="radio" name="dark" value="${d.b}" ${d.b === st.bortle ? 'checked' : ''}><span>${d.label} <small>${d.hint}</small></span></label>`).join('');
    $('gearRadios').innerHTML = GEAR.map((g, i) => `<label><input type="radio" name="gear" value="${i}" ${i === st.gear ? 'checked' : ''}><span>${g}</span></label>`).join('');
    showPicked(); $('setup').showModal();
  }
  function showPicked() { const l = draft.loc; $('picked').innerHTML = `Chosen: <b>${esc(l.name)}</b>${l.country ? ', ' + esc(l.country) : ''} (${Math.abs(l.lat).toFixed(2)}° ${l.lat < 0 ? 'S' : 'N'}, ${Math.abs(l.lon).toFixed(2)}° ${l.lon < 0 ? 'W' : 'E'})`; }
  function choose(l) {
    draft.loc = l; showPicked(); $('results').innerHTML = '';
    if (l.dark) { const x = document.querySelector('[name=dark][value="1"]'); if (x) x.checked = true; }
  }
  const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let found = [];
  function showResults(list, note) {
    found = list;
    $('results').innerHTML = list.map((p, i) => `<button type="button" data-res="${i}">${esc(p.name)} <small>${esc(p.country || '')}${p.dark ? ', dark-sky site' : ''}</small></button>`).join('') + (note ? `<p>${note}</p>` : '');
  }
  function search() {
    const q = plain($('q').value.trim()), run = ++searchRun;
    clearTimeout(searchTimer);
    if (!q) return showResults([]);
    const local = PLACES.filter(p => plain(p.name + ' ' + p.country).includes(q)).slice(0, 5);
    if (q.length < 3) return showResults(local);
    showResults(local, 'Searching.');
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent($('q').value.trim())}&count=7&language=en`);
        const j = await res.json();
        if (run !== searchRun) return;
        const web = (j.results || []).filter(p => p.timezone && Zone.valid(p.timezone) && !local.some(l => Math.abs(l.lat - p.latitude) < .2 && Math.abs(l.lon - p.longitude) < .2))
          .map(p => ({ name: p.name, country: [p.admin1, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude, tz: p.timezone }));
        showResults([...local, ...web], local.length + web.length ? '' : 'No match. Check the spelling, or enter coordinates below.');
      } catch { if (run === searchRun) showResults(local, local.length ? '' : 'Search needs an internet connection. You can enter coordinates below.'); }
    }, 350);
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.tab) setTab(d.tab);
    else if (d.themeSet) { st.theme = d.themeSet; persist(); render(); }
    else if (d.pick) { st.touched = true; pick(d.pick); if (matchMedia('(max-width: 980px)').matches) $('verdict').scrollIntoView(); }
    else if (d.goto) { st.touched = true; st.tab = 'tonight'; setDate(d.goto); window.scrollTo(0, 0); }
    else if (d.mode) { st.mode = d.mode; renderList(); }
    else if (d.kind) { st.kind = d.kind; renderList(); }
    else if (d.res) choose(found[+d.res]);
    else if (d.planics) ics(store.get('plans')[+d.planics]);
    else if (d.plandel) { const p = store.get('plans') || []; p.splice(+d.plandel, 1); store.set('plans', p); renderPlans(); }
    else if (d.act === 'camera') setTab('camera');
    else if (d.act === 'season') { setTab('ahead'); $('seasonHead').scrollIntoView(); }
    else if (d.act === 'ics') ics(planOf());
    else if (d.act === 'save') { const p = store.get('plans') || [], x = planOf(); if (!p.some(y => y.title === x.title && y.start === x.start)) p.push(x); p.sort((a, c) => a.start - c.start); store.set('plans', p); toast('Saved. Find it under Plan ahead.'); }
  });
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!k) return;
    const ids = ['tonight', 'ahead', 'camera'], n = ids[(ids.indexOf(st.tab) + k + 3) % 3];
    setTab(n); $('tab-' + n).focus();
  });
  $('placeBtn').onclick = () => openSetup(false);
  $('prevNight').onclick = () => { st.touched = true; setDate(Zone.addDays(st.date, -1)); };
  $('nextNight').onclick = () => { st.touched = true; setDate(Zone.addDays(st.date, 1)); };
  $('dateIn').onchange = e => { st.touched = true; setDate(e.target.value); };
  $('timeIn').onchange = e => {
    if (!e.target.value) return;
    const [h, m] = e.target.value.split(':').map(Number);
    st.touched = true; st.t = Zone.toUtc(h < 12 ? Zone.addDays(st.date, 1) : st.date, h, m, tz()); face(); renderTime();
  };
  $('goNow').onclick = () => {
    st.touched = true; st.t = Date.now();
    const d = Zone.date(st.t, tz()); st.date = Zone.hour(st.t, tz()) < 12 ? Zone.addDays(d, -1) : d;
    face(); st.mode = 'time'; render();
  };
  $('goBest').onclick = () => { jumpBest(); renderTime(); };

  // Ribbon: drag, hover, keys
  const rb = $('ribbon'), tip = $('tip');
  let dragging = false;
  const px = e => e.clientX - rb.getBoundingClientRect().left;
  function setTime(t) { st.touched = true; st.t = Math.round(t / 300000) * 300000; face(); renderTime(); }
  function hover(e) {
    const t = axis.toTime(px(e)), s = Planner.scoreAt(byId(st.target), t, ctx());
    tip.hidden = false;
    tip.innerHTML = `<b>${hm(t)}: score ${Math.round(s.score)}</b>${s.alt > 0 ? `${Math.round(s.alt)}° up, ${dir(s.az)}` : 'Target below horizon'}<br>${s.moonAlt > 0 ? `Moon ${Math.round(s.moonAlt)}° up` : 'Moon down'}${s.cloud == null ? '' : `<br>${Math.round(s.cloud)}% cloud`}`;
    const x = axis.x(t), w = tip.offsetWidth;
    tip.style.left = (x + 14 + w > rb.clientWidth ? x - 14 - w : x + 14) + 'px';
    const l = rb.querySelector('.hoverline'); if (l) { l.setAttribute('x1', x); l.setAttribute('x2', x); }
  }
  rb.addEventListener('pointerdown', e => { dragging = true; rb.setPointerCapture(e.pointerId); setTime(axis.toTime(px(e))); });
  rb.addEventListener('pointermove', e => { if (dragging) setTime(axis.toTime(px(e))); hover(e); });
  rb.addEventListener('pointerup', () => { dragging = false; });
  rb.addEventListener('pointercancel', () => { dragging = false; tip.hidden = true; });
  rb.addEventListener('pointerleave', () => { tip.hidden = true; const l = rb.querySelector('.hoverline'); if (l) { l.setAttribute('x1', -9); l.setAttribute('x2', -9); } });
  rb.addEventListener('keydown', e => {
    const n = Planner.night(st.date, st.loc), k = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 60, PageDown: -60 }[e.key];
    if (k) { e.preventDefault(); setTime(clamp(st.t + k * 60000, n.t0, n.t1)); }
    else if (e.key === 'Home') { e.preventDefault(); setTime(n.t0); } else if (e.key === 'End') { e.preventDefault(); setTime(n.t1); }
  });

  // Sky: drag to look around, tap a marker to choose it
  const sk = $('sky');
  let look = null;
  sk.addEventListener('pointerdown', e => { look = { x: e.clientX, y: e.clientY, az: st.az, alt: st.alt, moved: false }; sk.setPointerCapture(e.pointerId); });
  sk.addEventListener('pointermove', e => {
    if (!look) return;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    if (Math.hypot(dx, dy) > 5) look.moved = true;
    if (!look.moved) return;
    const k = (sk.clientWidth > 700 ? 124 : 92) / sk.clientWidth;
    st.az = Astro.norm(look.az - dx * k); if (e.pointerType === 'mouse') st.alt = clamp(look.alt + dy * k, 18, 80);
    drawSky();
  });
  sk.addEventListener('pointerup', e => {
    if (look && !look.moved) {
      const r = sk.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = hits.map(q => ({ ...q, d: Math.hypot(q.x - x, q.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (h && h.d < 22 && h.id !== st.target) { st.touched = true; st.target = h.id; face(); render(); }
    }
    look = null;
  });
  sk.addEventListener('pointercancel', () => { look = null; });
  sk.addEventListener('keydown', e => {
    const k = { ArrowLeft: -10, ArrowRight: 10 }[e.key], v = { ArrowUp: 5, ArrowDown: -5 }[e.key];
    if (!k && !v) return;
    e.preventDefault(); if (k) st.az = Astro.norm(st.az + k); if (v) st.alt = clamp(st.alt + v, 18, 80); drawSky();
  });

  // Forms
  const opts = TARGETS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  $('aheadTarget').innerHTML = $('camTarget').innerHTML = opts;
  $('camGear').innerHTML = GEAR.map((g, i) => `<option value="${i}">${g}</option>`).join('');
  $('camSensor').innerHTML = Object.entries(SENSORS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
  $('aheadTarget').onchange = $('camTarget').onchange = e => { st.touched = true; pick(e.target.value); };
  $('camGear').onchange = e => { st.gear = +e.target.value; st.touched = true; persist(); render(); };
  $('camSensor').onchange = e => { st.cam.sensor = e.target.value; persist(); render(); };
  const num = (id, key) => { $(id).oninput = e => { const v = parseFloat(e.target.value); if (v >= +e.target.min && v <= +e.target.max) { st.cam[key] = v; persist(); renderCamera(); } }; $(id).onblur = () => { $(id).value = st.cam[key]; }; };
  num('camF', 'f'); num('camN', 'n');

  $('q').oninput = search;
  $('q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (found[0]) choose(found[0]); } };
  $('geo').onclick = () => {
    if (!navigator.geolocation) return showResults([], 'This browser cannot share a location. Search for a place instead.');
    showResults([], 'Asking your browser for your location.');
    navigator.geolocation.getCurrentPosition(
      p => choose({ name: 'My location', country: '', lat: p.coords.latitude, lon: p.coords.longitude, tz: deviceZone, guessTz: true }),
      () => showResults([], 'Location was not shared. Search for a place instead.'), { timeout: 10000 });
  };
  $('useCoords').onclick = () => {
    const lat = parseFloat($('latIn').value), lon = parseFloat($('lonIn').value);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return showResults([], 'Latitude runs from −90 to 90 and longitude from −180 to 180.');
    choose({ name: `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`, country: '', lat: clamp(lat, -89.9, 89.9), lon, tz: Zone.fromLongitude(lon), guessTz: true });
  };
  $('setupForm').onsubmit = () => {
    const v = n => +document.querySelector(`[name=${n}]:checked`)?.value;
    const moved = draft.loc.lat !== st.loc.lat || draft.loc.lon !== st.loc.lon;
    st.loc = draft.loc; st.bortle = v('dark') || st.bortle; st.gear = v('gear') >= 0 ? v('gear') : st.gear;
    persist(); st.touched = false; cache.clear(); resetNight(); st.mode = 'night'; render();
    if (moved || st.wx === 'failed') loadWeather();
  };

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.tab === 'tonight') { drawSky(); drawRibbon(); } }, 80); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (st.tab === 'tonight') drawSky(); });
  setInterval(() => { renderHeader(); if (st.tab === 'tonight') renderNow(); }, 30000);
  setInterval(() => { if (!document.hidden) loadWeather(); }, 3600000);

  resetNight(); render(); loadWeather();
  if (!store.get('settings')) openSetup(true);
})();

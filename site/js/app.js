// Undercut: page logic. Loads data.json, renders every section, and boots the 3D scenes.
// The 3D modules are imported lazily, so the page still works if WebGL or the CDN fails.
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = window.gsap && !RM ? window.gsap : null;
if (window.gsap) gsap.ticker.lagSmoothing(0); // keep animations on real time
if (G && window.ScrollTrigger) G.registerPlugin(ScrollTrigger);

const TEAMS = {
  mercedes: ['Mercedes', '#19C3AC'], ferrari: ['Ferrari', '#E8002D'], mclaren: ['McLaren', '#FF8000'],
  red_bull: ['Red Bull Racing', '#3B5BDB'], rb: ['Racing Bulls', '#6692FF'], alpine: ['Alpine', '#F282B4'],
  williams: ['Williams', '#64C4FF'], aston_martin: ['Aston Martin', '#229971'], haas: ['Haas', '#AEB3B7'],
  audi: ['Audi', '#C8102E'], sauber: ['Sauber', '#52E252'], cadillac: ['Cadillac', '#8A8D93'],
};
const team = id => TEAMS[id] || [String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), '#8C8C8C'];
const pct = (x, d = 0) => x == null ? '–' : (x * 100).toFixed(d) + '%';
const short = n => n.replace(' Grand Prix', ' GP');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let DATA, current, timer, raceViewer, garageViewer, selectedTeam = 'red_bull';
const introTweens = [];

// ---------- tooltip + glass light ----------
const tip = $('#tip');
document.addEventListener('pointermove', e => {
  const t = e.target.closest('[data-tip]');
  if (t) {
    tip.innerHTML = t.dataset.tip;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
    tip.classList.add('show');
  } else tip.classList.remove('show');
  const w = e.target.closest('.window');
  if (w) {
    const r = w.getBoundingClientRect();
    w.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    w.style.setProperty('--my', (e.clientY - r.top) + 'px');
    if (w.classList.contains('tilt') && !RM && matchMedia('(pointer: fine)').matches) {
      w.style.setProperty('--ry', (((e.clientX - r.left) / r.width) - 0.5) * 7 + 'deg');
      w.style.setProperty('--rx', (0.5 - ((e.clientY - r.top) / r.height)) * 7 + 'deg');
    }
  }
}, { passive: true });
document.addEventListener('pointerout', e => {
  const w = e.target.closest?.('.tilt');
  if (w && !w.contains(e.relatedTarget)) { w.style.setProperty('--rx', '0deg'); w.style.setProperty('--ry', '0deg'); }
});

// ---------- intro ----------
function typeTitle() {
  const h = $('#intro-title'), text = h.textContent;
  if (!G) return;
  h.innerHTML = `<span class="typed"></span><span class="caret"></span><span class="ghost">${esc(text)}</span>`;
  const typed = h.querySelector('.typed'), ghost = h.querySelector('.ghost');
  const o = { n: 0 };
  introTweens.push(G.to(o, {
    n: text.length, duration: 1.6, ease: 'none', delay: 0.5,
    onUpdate: () => { const k = Math.round(o.n); typed.textContent = text.slice(0, k); ghost.textContent = text.slice(k); },
  }));
}

function renderCatalog() {
  const nx = DATA.races.find(r => r.status === 'upcoming');
  const leader = DATA.standings.drivers[0];
  const lead = DATA.standings.constructors[0];
  const t = DATA.season_track, mw = t.filter(x => x.model_winner).length;
  const races = Object.values(DATA.backtest.seasons).reduce((a, s) => a + s.races, 0);
  const ico = {
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5" />',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />',
    car: '<path d="M3 14h18M6 14l1.5-4h9L18 14M7 17.5a1.5 1.5 0 1 0 0 .01M17 17.5a1.5 1.5 0 1 0 0 .01" />',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" />',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />',
    gauge: '<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />',
  };
  const card = (href, icon, title, body, live) => `
    <a class="feat window tilt" href="${href}">
      <span class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico[icon]}</svg></span>
      <svg class="arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <h3>${title}</h3><p>${body}</p><span class="live">${live}</span>
    </a>`;
  $('#catalog').innerHTML = [
    nx && card('#race', 'flag', 'Next race prediction', `Who wins ${esc(short(nx.name))}, with the full predicted podium in 3D.`,
      `<span class="team-dot" style="--tc:${team(nx.rows[0].team)[1]}"></span>${esc(nx.rows[0].code)} tipped · ${pct(nx.rows[0].win)} to win`),
    card('#order', 'list', 'Full finishing order', 'All 22 drivers ranked, with win and podium chances and grid moves.', `${nx ? nx.rows.length : 22} drivers ranked`),
    card('#teams', 'car', '3D garage', "Inspect the cars in 3D. Red Bull's 2026 livery is painted in full.", 'Drag to orbit any car'),
    card('#teams', 'trophy', 'Standings & team stats', 'Driver and constructor tables, every finish, wins, poles and retirements.',
      `<span class="team-dot" style="--tc:${team(leader.team)[1]}"></span>${esc(leader.code)} leads · ${leader.points} pts · ${esc(team(lead.team)[0])} top team`),
    card('#season', 'grid', 'Season scorecard', 'How every 2026 prediction played out, round by round.', `${mw} of ${t.length} winners called`),
    card('#accuracy', 'gauge', 'Accuracy lab', 'Back-tests against a grid-order baseline, plus a check that the odds are honest.', `${races} races back-tested`),
  ].filter(Boolean).join('');
  if (nx) $('#cta-next').textContent = `See the ${short(nx.name)} prediction`;
}

// ---------- race ----------
const raceDate = r => new Date(r.date + 'T' + (r.time || '12:00:00Z'));

function selectRace(round, opts = {}) {
  const r = DATA.races.find(x => x.round === round);
  if (!r) return;
  current = r;
  $('#race-select').value = String(round);
  const idx = DATA.races.indexOf(r);
  $('#prev').disabled = idx === 0;
  $('#next').disabled = idx === DATA.races.length - 1;
  renderRace(r, opts.first);
  renderTower(r, opts.first);
  document.querySelectorAll('.rtile').forEach(t => t.classList.toggle('sel', +t.dataset.round === round));
  const w = r.rows[0];
  raceViewer?.setCar(w.team, { number: driverNumber(w.driver), teamName: team(w.team)[0] });
  raceViewer?.setPodium(r.rows.slice(0, 3).map(x => ({ color: team(x.team)[1] })));
}

function driverNumber(id) {
  const d = DATA.standings.drivers.find(x => x.driver === id);
  return d?.number || '';
}

function renderRace(r, first) {
  const up = r.status === 'upcoming';
  const pill = $('#status-pill');
  pill.className = 'chip ' + (up ? 'chip-live' : '');
  pill.textContent = up ? 'Next race' : 'Finished';
  $('#race-round').textContent = `Round ${r.round} · ${DATA.season}`;
  $('#race-name').textContent = r.name;
  $('#race-circuit').textContent = `${r.circuit} · ${r.locality}, ${r.country}`;
  const d = raceDate(r);
  $('#race-when').textContent = 'Lights out ' + d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  clearInterval(timer);
  const cd = $('#countdown');
  cd.hidden = !up || d < new Date();
  if (!cd.hidden) {
    const tick = () => {
      const s = Math.max(0, Math.floor((d - new Date()) / 1000));
      [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60]
        .forEach((v, i) => $('#cd-' + 'dhms'[i]).textContent = String(v).padStart(2, '0'));
    };
    tick(); timer = setInterval(tick, 1000);
  }

  const w = r.rows[0];
  const fav = r.rows.reduce((a, b) => (b.win > a.win ? b : a));
  $('#w-code').innerHTML = `<span class="team-dot" style="--tc:${team(w.team)[1]}"></span>${esc(w.code)}`;
  $('#w-name').textContent = `${w.name} · ${team(w.team)[0]}`;
  $('#w-note').textContent = fav.driver !== w.driver
    ? `Highest single win chance: ${fav.code} at ${pct(fav.win)}. The order also weighs consistency.`
    : `Starts P${w.grid}${up && r.grid_source.startsWith('Estimated') ? ' (estimated)' : ''}. Podium chance ${pct(w.podium)}.`;
  if (up) $('#w-verdict').innerHTML = '';
  else {
    const win = r.rows.find(x => x.actual === 1);
    $('#w-verdict').innerHTML = w.actual === 1
      ? `<span class="chip v-good">✓ Called it · ${esc(win.code)} won</span>`
      : `<span class="chip v-bad">✗ Missed · ${esc(win ? win.code : '?')} won, ${esc(w.code)} finished P${w.actual ?? '–'}</span>`;
  }
  $('#src-note').textContent = `Grid: ${r.grid_source}. ${up ? `Predicted with every race up to round ${r.round - 1}.` : 'Predicted before the race, using only earlier results.'}`;

  const C = 263.9, target = w.win || 0, ring = $('#ring-val'), num = $('#ring-num');
  num.textContent = Math.round(target * 100) + '%';
  if (G) {
    const o = { v: 0 };
    introTweens.push(
      G.fromTo(ring, { attr: { 'stroke-dashoffset': C } }, { attr: { 'stroke-dashoffset': C * (1 - target) }, duration: 1.1, ease: 'power3.out' }),
      G.to(o, { v: target * 100, duration: 1.1, ease: 'power3.out', onUpdate: () => (num.textContent = Math.round(o.v) + '%') }));
  } else ring.setAttribute('stroke-dashoffset', C * (1 - target));

  $('#podium-labels').innerHTML = [1, 0, 2].map(i => {
    const x = r.rows[i];
    return `<div class="pl"><span class="p">P${i + 1}</span><span class="team-dot" style="--tc:${team(x.team)[1]}"></span><div><div class="c">${esc(x.code)}</div><div class="w">${pct(x.podium)} podium</div></div></div>`;
  }).join('');
  if (G && !first) G.fromTo('.pl', { y: 24 }, { y: 0, duration: 0.6, stagger: 0.08, ease: 'back.out(2)' });
}

function renderTower(r, first) {
  const up = r.status === 'upcoming', est = r.grid_source.startsWith('Estimated');
  $('#order-sub').textContent = up
    ? `${short(r.name)}: every driver ranked by the model, with their chance of winning and of finishing on the podium.`
    : `${short(r.name)}: what the model predicted before the race, next to the actual result.`;
  $('#tower').innerHTML = r.rows.map(x => {
    const [tn, tc] = team(x.team);
    const mv = x.grid - x.pred;
    const mvTxt = mv > 0 ? `▲ ${plural(mv, 'place')}` : mv < 0 ? `▼ ${plural(-mv, 'place')}` : '● holds';
    let act = `<span class="act muted" style="font-family:var(--f-body);font-size:.8rem">${up ? 'Not raced' : '–'}</span>`;
    if (x.actual != null) {
      const d = Math.abs(x.actual - x.pred);
      const cls = d <= 1 ? 'v-good' : d <= 3 ? 'v-warn' : 'v-bad';
      const sym = d === 0 ? '✓' : d <= 1 ? '≈' : d <= 3 ? '~' : '✗';
      act = `<span class="act chip ${cls}" data-tip="Finished P${x.actual}, predicted P${x.pred}">${sym} P${x.actual}</span>`;
    }
    return `<li class="trow${x.pred <= 3 ? ' top3' : ''}">
      <span class="pos">P${x.pred}</span>
      <span class="who"><span class="team-dot" style="--tc:${tc}"></span><span class="who-txt"><b>${esc(x.code)}</b><span class="nm">${esc(x.name)}</span><span class="tm">${esc(tn)}</span></span></span>
      <span class="gridcell num">${est ? 'Est. ' : ''}P${x.grid}<span class="mv ${mv > 0 ? 'up' : mv < 0 ? 'down' : 'same'}">${mvTxt}</span></span>
      <span class="barcell bc-w"><small><span class="mlabel">Win</span>${pct(x.win, 1)}</small><span class="bar" data-tip="${esc(x.code)} wins: ${pct(x.win, 1)}"><i style="--w:${(x.win * 100).toFixed(2)}%"></i></span></span>
      <span class="barcell bc-p"><small><span class="mlabel">Podium</span>${pct(x.podium, 1)}</small><span class="bar pod" data-tip="${esc(x.code)} on the podium: ${pct(x.podium, 1)}"><i style="--w:${(x.podium * 100).toFixed(2)}%"></i></span></span>
      ${act}
    </li>`;
  }).join('');
  if (G && !first) {
    G.fromTo('#tower .trow', { x: -30, opacity: 0.2 }, { x: 0, opacity: 1, duration: 0.5, stagger: 0.02, ease: 'power3.out' });
    G.fromTo('#tower .bar i', { scaleX: 0.1 }, { scaleX: 1, duration: 0.8, stagger: 0.01, ease: 'power3.out', delay: 0.1 });
  }
}

// ---------- standings & garage ----------
function finChip(f, roundName) {
  if (!f) return `<span class="fin none" data-tip="${esc(roundName)}: did not start">·</span>`;
  const cls = f.dnf ? 'dnf' : f.pos === 1 ? 'p1' : f.pos === 2 ? 'p2' : f.pos === 3 ? 'p3' : f.pos <= 10 ? 'pts' : '';
  const label = f.dnf ? 'R' : f.pos;
  const tipText = `${esc(roundName)}: ${f.dnf ? `retired (${esc(f.status)})` : 'P' + f.pos} · started P${f.grid || 'pit'}${f.points ? ` · ${f.points} pts` : ''}`;
  return `<span class="fin ${cls}" data-tip="${tipText}">${label}</span>`;
}

function strip(d) {
  const by = new Map(d.finishes.map(f => [f.round, f]));
  return `<span class="strip">${DATA.standings.rounds.map(r => finChip(by.get(r.round), `R${r.round} ${short(r.name)}`)).join('')}</span>`;
}

function renderStandings() {
  const S = DATA.standings;
  $('#stand-drivers').innerHTML = `<table class="stand">
    <thead><tr><th>Pos</th><th>Driver</th><th class="r">Pts</th><th class="r">Wins</th><th class="r">Podiums</th><th class="r">Poles</th><th>Grand Prix finishes, R1 → R${S.rounds.length}</th></tr></thead>
    <tbody>${S.drivers.map(d => `<tr>
      <td class="num">${d.pos ?? '–'}</td>
      <td><span class="nm"><span class="team-dot" style="--tc:${team(d.team)[1]}"></span><b>${esc(d.code)}</b><span>${esc(d.name)}</span></span></td>
      <td class="r pts">${d.points}</td><td class="r num">${d.wins}</td><td class="r num">${d.podiums}</td><td class="r num">${d.poles}</td>
      <td>${strip(d)}</td></tr>`).join('')}</tbody></table>`;

  $('#stand-teams').innerHTML = `<div class="teams">${S.constructors.map(c => `
    <button class="team-card" style="--tc:${team(c.team)[1]}" aria-pressed="${c.team === selectedTeam}" data-team="${c.team}">
      <span class="tc-top"><span class="tc-pos">P${c.pos ?? '–'}</span><span class="team-dot"></span></span>
      <span class="tc-name">${esc(team(c.team)[0])}</span>
      <span class="tc-pts">${c.points}<small> pts</small></span>
      <span class="muted" style="font-size:.82rem">${plural(c.wins, 'win')} · ${plural(c.podiums, 'podium')}</span>
    </button>`).join('')}</div>`;
  $('#stand-note').textContent = `Points include sprint races. Finish chips show Grand Prix results only. After round ${S.rounds.length}. Pick a team to open it in the garage.`;

  const tabs = [['#tab-drivers', '#stand-drivers'], ['#tab-teams', '#stand-teams']];
  tabs.forEach(([b, p]) => $(b).addEventListener('click', () => {
    tabs.forEach(([b2, p2]) => { $(b2).setAttribute('aria-pressed', b2 === b); $(p2).hidden = p2 !== p; });
  }));
  $('#stand-teams').addEventListener('click', e => {
    const b = e.target.closest('.team-card'); if (!b) return;
    selectTeam(b.dataset.team);
  });
}

function selectTeam(id) {
  selectedTeam = id;
  document.querySelectorAll('.team-card').forEach(b => b.setAttribute('aria-pressed', b.dataset.team === id));
  const S = DATA.standings;
  const c = S.constructors.find(x => x.team === id);
  if (!c) return;
  const [name, color] = team(id);
  const drivers = c.drivers.map(did => S.drivers.find(d => d.driver === did)).filter(Boolean);
  const nx = DATA.races.find(r => r.status === 'upcoming');
  const nextOdds = d => { const row = nx?.rows.find(x => x.driver === d.driver); return row ? `${pct(row.win)} to win ${short(nx.name)}` : ''; };
  $('#garage-info').innerHTML = `
    <div class="garage-title"><span class="team-dot" style="--tc:${color};width:16px;height:16px"></span><h3>${esc(name)}</h3><span class="chip">P${c.pos ?? '–'} · ${c.points} pts</span></div>
    <div class="tiles">
      <div class="tile"><b>${c.wins}</b><span>Wins</span></div>
      <div class="tile"><b>${c.podiums}</b><span>Podiums</span></div>
      <div class="tile"><b>${c.poles}</b><span>Poles</span></div>
      <div class="tile"><b>${c.dnfs}</b><span>Retirements</span></div>
      <div class="tile"><b>${c.avg_finish != null ? c.avg_finish.toFixed(1) : '–'}</b><span>Avg finish</span></div>
      <div class="tile"><b>${c.best != null ? 'P' + c.best : '–'}</b><span>Best result</span></div>
    </div>
    ${drivers.map(d => `<div class="drv">
      <div class="drv-top"><span><b>${esc(d.code)}</b> <span class="muted">${esc(d.name)}${d.number ? ' · #' + esc(d.number) : ''}</span></span><span class="num">${d.points} pts · P${d.pos ?? '–'}</span></div>
      ${strip(d)}
      <span class="src-note">${plural(d.starts, 'start')} · ${plural(d.podiums, 'podium')} · ${plural(d.dnfs, 'retirement')}${nextOdds(d) ? ' · ' + nextOdds(d) : ''}</span>
    </div>`).join('')}
    <p class="livery-note">${id === 'red_bull' ? 'Full 2026 livery, painted from the team\'s launch photos.' : 'Shown in team colours. A full livery for this team is coming.'}</p>`;
  const lead = drivers[0];
  garageViewer?.setCar(id, { number: lead?.number || '', teamName: name });
  if (G) G.fromTo('#garage-info > *', { y: 14 }, { y: 0, duration: 0.5, stagger: 0.04, ease: 'power3.out' });
}

// ---------- season ----------
function renderSeason() {
  const t = DATA.season_track, n = t.length;
  $('#season-year').textContent = DATA.season;
  const mw = t.filter(x => x.model_winner).length, gw = t.filter(x => x.grid_winner).length;
  const mp = t.reduce((a, x) => a + x.model_podium, 0), gp = t.reduce((a, x) => a + x.grid_podium, 0);
  const done = DATA.races.filter(r => r.status === 'completed');
  const exact = done.reduce((a, r) => a + r.rows.filter(x => x.actual === x.pred).length, 0);
  const total = done.reduce((a, r) => a + r.rows.length, 0);
  $('#stats').innerHTML = `
    <div class="stat window tilt"><span class="eyebrow">Winners called</span><span class="big">${mw}<small> / ${n}</small></span><span class="vs">Grid order: ${gw} / ${n}</span></div>
    <div class="stat window tilt"><span class="eyebrow">Podium drivers named</span><span class="big">${mp}<small> / ${n * 3}</small></span><span class="vs">Grid order: ${gp} / ${n * 3}</span></div>
    <div class="stat window tilt"><span class="eyebrow">Exact positions</span><span class="big">${exact}<small> / ${total}</small></span><span class="vs">Drivers placed in exactly the predicted spot</span></div>`;
  const tiles = t.map(x => `
    <button class="rtile" data-round="${x.round}" aria-label="Round ${x.round} ${esc(x.name)}">
      <span class="rt-top"><span class="rn">R${x.round}</span><span class="chip ${x.model_winner ? 'v-good' : 'v-bad'}" style="padding:.15rem .5rem;font-size:.7rem">${x.model_winner ? '✓ Winner' : '✗ Winner'}</span></span>
      <span class="rname">${esc(short(x.name))}</span>
      <span class="rwin"><span class="team-dot" style="--tc:${team(x.winner_team)[1]}"></span>${esc(x.winner)} won</span>
      <span class="dots" data-tip="${x.model_podium} of 3 podium drivers named">${[0, 1, 2].map(i => `<i class="${i < x.model_podium ? 'on' : ''}"></i>`).join('')}<span>${x.model_podium}/3 podium</span></span>
    </button>`);
  const nx = DATA.races.find(r => r.status === 'upcoming');
  if (nx) tiles.push(`
    <button class="rtile next" data-round="${nx.round}">
      <span class="rt-top"><span class="rn">R${nx.round}</span><span class="chip chip-live" style="padding:.15rem .5rem;font-size:.7rem">Next</span></span>
      <span class="rname">${esc(short(nx.name))}</span>
      <span class="rwin"><span class="team-dot" style="--tc:${team(nx.rows[0].team)[1]}"></span>${esc(nx.rows[0].code)} tipped</span>
      <span class="dots">${pct(nx.rows[0].win)} win chance</span>
    </button>`);
  DATA.calendar.forEach(c => tiles.push(`
    <div class="rtile future" aria-label="Round ${c.round} ${esc(c.name)}, not predicted yet">
      <span class="rt-top"><span class="rn">R${c.round}</span><span class="rn">${new Date(c.date + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></span>
      <span class="rname">${esc(short(c.name))}</span>
      <span class="dots">Predicted after the race before</span>
    </div>`));
  $('#rounds').innerHTML = tiles.join('');
  $('#rounds').addEventListener('click', e => {
    const b = e.target.closest('button.rtile'); if (!b) return;
    selectRace(+b.dataset.round);
    document.getElementById('race').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
  });
}

// ---------- accuracy ----------
const METRICS = [
  { key: 'winner_correct', label: 'Winner correct', fmt: v => pct(v), max: 1, cap: 'Share of races where the top pick won. Higher is better.' },
  { key: 'podium_overlap', label: 'Podium drivers', fmt: v => pct(v), max: 1, cap: 'Share of the three podium finishers the prediction named. Higher is better.' },
  { key: 'mae_pos', label: 'Position error', fmt: v => v.toFixed(2), max: 4, cap: 'Average places between predicted and actual finish. Lower is better.' },
];
let metric = METRICS[0];

function renderSeasonChart(animate) {
  const S = DATA.backtest.seasons, years = Object.keys(S);
  const W = 560, H = 290, m = { l: 44, r: 10, t: 26, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const y = v => m.t + ih - (v / metric.max) * ih;
  const gw = iw / years.length, bw = Math.min(54, gw * 0.3);
  const ticks = metric.max === 1 ? [0, 0.25, 0.5, 0.75, 1] : [0, 1, 2, 3, 4];
  const bar = (x, v, color, who, yr) => {
    const top = y(v), r = Math.min(6, m.t + ih - top);
    const d = `M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z`;
    return `<path class="sbar" d="${d}" fill="${color}" data-tip="${yr} · ${who}: ${metric.fmt(v)}"/><text class="val-label" x="${x + bw / 2}" y="${top - 7}" text-anchor="middle">${metric.fmt(v)}</text>`;
  };
  let g = ticks.map(t => `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${metric.max === 1 ? Math.round(t * 100) + '%' : t}</text>`).join('');
  years.forEach((yr, i) => {
    const cx = m.l + gw * i + gw / 2;
    g += bar(cx - bw - 1, S[yr].model[metric.key], 'var(--series-a)', 'Model', yr);
    g += bar(cx + 1, S[yr].grid[metric.key], 'var(--series-b)', 'Grid order', yr);
    g += `<text x="${cx}" y="${H - 10}" text-anchor="middle" style="fill:var(--ink-2)">${yr}${+yr === DATA.season ? ' (so far)' : ''}</text>`;
  });
  g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  $('#season-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric.label} by season, model versus grid order">${g}</svg>`;
  $('#metric-cap').textContent = metric.cap;
  $('#season-tbl').innerHTML = `<table><thead><tr><th>Season</th><th>Races</th>${METRICS.map(mm => `<th>${mm.label}<br>model / grid</th>`).join('')}</tr></thead><tbody>${years.map(yr => `<tr><td>${yr}</td><td>${S[yr].races}</td>${METRICS.map(mm => `<td>${mm.fmt(S[yr].model[mm.key])} / ${mm.fmt(S[yr].grid[mm.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (G && animate) G.fromTo('#season-chart .sbar', { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.8, stagger: 0.06, ease: 'back.out(1.4)' });
}

function renderMetricTabs() {
  $('#metric-tabs').innerHTML = METRICS.map((mm, i) => `<button aria-pressed="${i === 0}" data-i="${i}">${mm.label}</button>`).join('');
  $('#metric-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    metric = METRICS[+b.dataset.i];
    $('#metric-tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    renderSeasonChart(true);
  });
  $('#tbl-btn').addEventListener('click', e => {
    const t = $('#season-tbl'); t.hidden = !t.hidden;
    e.currentTarget.setAttribute('aria-expanded', !t.hidden);
    e.currentTarget.textContent = t.hidden ? 'Show as table' : 'Hide table';
  });
}

function renderCalibration() {
  const C = DATA.backtest.calibration;
  const W = 360, H = 270, m = { l: 44, r: 14, t: 14, b: 40 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = v => m.l + v * iw, y = v => m.t + ih - v * ih;
  let g = [0, 0.25, 0.5, 0.75, 1].map(t => `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text><text x="${x(t)}" y="${m.t + ih + 18}" text-anchor="middle">${t * 100}%</text>`).join('');
  g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--ink-3)" stroke-width="1.2" stroke-dasharray="5 5"/>`;
  g += `<text x="${x(0.66)}" y="${y(0.6) + 16}" transform="rotate(-37 ${x(0.66)} ${y(0.6) + 16})" style="font-size:11px">Perfectly honest odds</text>`;
  g += C.map(c => `<g class="cdot" data-tip="Predicted ${c.bin}: average ${pct(c.predicted)} → actually won ${pct(c.actual)} (${c.n} drivers)">
      <circle cx="${x(c.predicted)}" cy="${y(c.actual)}" r="14" fill="transparent"/>
      <circle cx="${x(c.predicted)}" cy="${y(c.actual)}" r="${c.n < 5 ? 5 : 7}" fill="var(--series-a)" stroke="var(--env)" stroke-width="2" ${c.n < 5 ? 'fill-opacity=".45"' : ''}/></g>`).join('');
  g += `<text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">Predicted win chance</text><text transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">Actually won</text>`;
  $('#calib').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration of win probabilities">${g}</svg><p class="cap" style="font-size:.8rem;margin-top:6px">Faded dot: under 5 drivers in that group, too few to judge.</p>`;
}

function renderImportance() {
  const I = DATA.backtest.importance, max = I[0].value;
  $('#imp').innerHTML = I.map(f => `<div class="imp-row"><span>${esc(f.label)}</span><span class="bar" data-tip="${esc(f.label)}: ${pct(f.value, 1)}"><i style="--w:${(f.value / max * 100).toFixed(1)}%"></i></span><span class="v">${pct(f.value, 1)}</span></div>`).join('');
}

// ---------- motion ----------
function motion() {
  if (!G) return;
  const tl = G.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('.nav', { y: -60, duration: 0.7 })
    .from('.intro-copy > *', { y: 26, duration: 0.7, stagger: 0.08 }, '-=.4')
    .from('.feat', { y: 50, rotateX: 12, duration: 0.9, stagger: 0.06, ease: 'back.out(1.4)' }, '-=.5')
    .from('.car-tag', { x: 40, duration: 0.7 }, '<');
  introTweens.push(tl);
  setTimeout(() => introTweens.forEach(t => t.progress(1)), 3200);

  if (!window.ScrollTrigger) return;
  // Reveals move and grow content; nothing starts hidden.
  G.utils.toArray('.sec-head, .race-card, #race-stage, .tower-win, .standings-win, .garage > *, .stat, .rtile, .panel, .step, .fine').forEach(el => {
    G.from(el, { y: 60, scale: 0.96, rotateX: 6, transformPerspective: 1200, duration: 0.9, ease: 'power3.out', immediateRender: false,
      scrollTrigger: { trigger: el, start: 'top bottom', once: true } });
  });
  ScrollTrigger.create({ trigger: '#season-chart', start: 'top bottom', once: true, onEnter: () => renderSeasonChart(true) });
  G.from('#imp .bar i', { scaleX: 0, duration: 1, stagger: 0.06, immediateRender: false, scrollTrigger: { trigger: '#imp', start: 'top bottom', once: true } });

  // active nav link
  document.querySelectorAll('main section').forEach(s => ScrollTrigger.create({
    trigger: s, start: 'top 40%', end: 'bottom 40%',
    onToggle: ({ isActive }) => isActive && document.querySelectorAll('.nav a.link').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + s.id)),
  }));
}

// ---------- 3D ----------
async function boot3D() {
  const fail = (sel, msg) => { const st = $(sel); st.querySelector('canvas')?.remove(); st.insertAdjacentHTML('afterbegin', `<div class="stage-fallback">${msg}</div>`); };
  try {
    const [{ createHero }, { createViewer }] = await Promise.all([import('./hero.js'), import('./viewer.js')]);
    const hero = await createHero($('#hero-canvas'), { reducedMotion: RM, gsap: G });
    if (G && window.ScrollTrigger) {
      ScrollTrigger.create({ trigger: '.intro', start: 'top top', end: 'bottom top', scrub: true, onUpdate: s => hero.setProgress(s.progress) });
    }
    raceViewer = await createViewer($('#race-canvas'), { podium: true, reducedMotion: RM, gsap: G });
    garageViewer = await createViewer($('#garage-canvas'), { podium: false, reducedMotion: RM, gsap: G });
    if (current) {
      const w = current.rows[0];
      raceViewer.setCar(w.team, { number: driverNumber(w.driver), teamName: team(w.team)[0] });
      raceViewer.setPodium(current.rows.slice(0, 3).map(x => ({ color: team(x.team)[1] })));
    }
    const c = DATA.standings.drivers.find(d => d.team === selectedTeam);
    garageViewer.setCar(selectedTeam, { number: c?.number || '', teamName: team(selectedTeam)[0] });
  } catch (e) {
    console.warn('3D unavailable', e);
    $('#hero-canvas')?.remove();
    fail('#race-stage', '3D view needs WebGL, which this browser has turned off.');
    fail('#garage-stage', '3D view needs WebGL, which this browser has turned off.');
  }
}

// ---------- boot ----------
typeTitle();
fetch('data.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
  DATA = d;
  $('#intro-season').textContent = d.season;
  renderCatalog();
  const sel = $('#race-select');
  sel.innerHTML = d.races.map(r => `<option value="${r.round}">R${r.round} · ${esc(short(r.name))}${r.status === 'upcoming' ? '  (next)' : ''}</option>`).join('');
  sel.addEventListener('change', () => selectRace(+sel.value));
  $('#prev').addEventListener('click', () => { const i = d.races.indexOf(current); if (i > 0) selectRace(d.races[i - 1].round); });
  $('#next').addEventListener('click', () => { const i = d.races.indexOf(current); if (i < d.races.length - 1) selectRace(d.races[i + 1].round); });
  renderStandings(); renderSeason(); renderMetricTabs(); renderSeasonChart(false); renderCalibration(); renderImportance();
  const fromHash = /^#r(\d+)$/.exec(location.hash);
  const start = (fromHash && d.races.find(r => r.round === +fromHash[1])) || d.races.find(r => r.status === 'upcoming') || d.races.at(-1);
  selectRace(start.round, { first: true });
  selectTeam(selectedTeam);
  $('#updated').textContent = 'Model updated ' + new Date(d.generated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  motion();
  boot3D();
}).catch(err => {
  console.error(err);
  $('#tower').innerHTML = `<li class="loading">Couldn't load predictions (${esc(err.message)}). Reload the page to try again.</li>`;
  $('#race-name').textContent = 'Predictions unavailable';
});

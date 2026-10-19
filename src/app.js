/* =========================================================================
   Relevé — workout tracker for dancers
   Data is saved to localStorage first, then synced to Cloudflare KV when a
   sync code is set up (see sync.js / functions/api/data.js).
   ========================================================================= */
import './styles.css';
import * as sync from './sync.js';

const KEY = 'releve.v1';
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = x => { const n = parseFloat(String(x ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const letter = i => String.fromCharCode(65 + i);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------- exercise library (name | flags | default target) ----------
   flags: u = unilateral, t = timed, w = weighted                          */
const LIB = `Bulgarian split squat|uw|6-8
Barbell reverse lunge|uw|8
Reverse lunge|uw|8-10
Walking lunge|uw|10
Single-leg RDL|uw|8-10
Single-leg calf raise|uw|12-15
Single-leg glute bridge|u|12
Single-leg hip thrust|uw|10
Step-up|uw|8
Lateral step-down|u|8-10
Pistol squat|u|5
Skater squat|u|6-8
Cossack squat|uw|6
Single-leg pogo hops|ut|15
Double-leg pogo hops|t|20
Single-leg hop & stick|u|5
Lateral bound & stick|u|5
Broad jump||5
Tuck jumps||6
Depth jump||5
Split squat jumps|u|6
Skips for height|u|8
Single-leg relevé hold|ut|30
Single-leg balance (eyes closed)|ut|30
Copenhagen plank|ut|20-30
Side plank|ut|30
Hip airplane|u|6
Tibialis raise||15
Nordic curl||4-6
Back squat|w|8-10
Front squat|w|6-8
Trap bar deadlift|w|5
Romanian deadlift|w|8
Hip thrust|w|8-10
Leg extension|w|10-12
Leg curl|w|10-12
Push-up||10
Bench press|w|8
Overhead press|w|8
Pull-up||6
Row|w|10
Pallof press|uw|10
Dead bug|u|8
Hanging knee raise||10
Abs||`.split('\n').map(l => {
  const [n, f = '', t = ''] = l.split('|');
  return { n, u: f.includes('u'), mode: f.includes('t') ? 'time' : 'reps', w: f.includes('w'), t };
});

/* ---------- data model ---------- */
function ex(name, sets, target, opts = {}) {
  return { id: uid(), name, sets, target, mode: opts.mode || 'reps', unilateral: !!opts.u, weighted: opts.w ?? true, notes: opts.notes || '' };
}
function blk(rest, ...items) { return { id: uid(), rest, items }; }

// Fixed ids on first run so two fresh devices don't end up with duplicate starters after syncing.
function starterTemplates(fresh = false) {
  const id = name => fresh ? uid() : `starter-${name}`;
  return [
    { id: id('full-body'), name: 'Session 1 – Full body', notes: '', blocks: [
      blk(120, ex('Squat', 3, '8-10')),
      blk(90, ex('Push', 3, '8-10'), ex('Pull', 3, '8-10')),
      blk(60, ex('Leg extension', 2, '10-12'), ex('Leg curl', 2, '10-12')),
      blk(60, ex('Abs', 2, '', { w: false })),
    ] },
    { id: id('unilateral'), name: 'Dancer – Unilateral strength', notes: 'Start every set on your weaker side.', blocks: [
      blk(120, ex('Bulgarian split squat', 3, '6-8', { u: true, notes: 'Slow 3s lower, knee tracks over 2nd toe' })),
      blk(90, ex('Barbell reverse lunge', 3, '8', { u: true }), ex('Single-leg calf raise', 3, '12-15', { u: true, notes: 'Full relevé at the top, 1s pause' })),
      blk(60, ex('Single-leg RDL', 3, '8-10', { u: true }), ex('Copenhagen plank', 3, '20-30', { u: true, mode: 'time', w: false })),
      blk(90, ex('Nordic curl', 3, '4-6', { w: false })),
    ] },
    { id: id('plyo'), name: 'Dancer – Plyo & elasticity', notes: 'Quality over quantity — stop a set when contacts get loud or slow.', blocks: [
      blk(45, ex('Double-leg pogo hops', 2, '20', { mode: 'time', w: false, notes: 'Stiff ankles, quick contacts' })),
      blk(60, ex('Single-leg pogo hops', 3, '15', { u: true, mode: 'time', w: false })),
      blk(90, ex('Lateral bound & stick', 3, '5', { u: true, w: false, notes: 'Hold each landing 2s' })),
      blk(90, ex('Single-leg hop & stick', 3, '5', { u: true, w: false }), ex('Tuck jumps', 3, '6', { w: false })),
      blk(45, ex('Single-leg relevé hold', 2, '30-45', { u: true, mode: 'time', w: false })),
    ] },
  ];
}

function defaults() {
  return {
    v: 1, settings: { unit: 'kg', sound: true, leadIn: 3, updatedAt: 0 }, templates: starterTemplates(), sessions: [],
    deleted: { templates: {}, sessions: {} }, orderUpdatedAt: 0, active: null, ui: {},
  };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.templates)) {
      d.settings = { ...defaults().settings, ...(d.settings || {}) };
      d.sessions ||= []; d.ui ||= {}; d.orderUpdatedAt ||= 0;
      d.deleted = { templates: {}, sessions: {}, ...(d.deleted || {}) };
      return d;
    }
  } catch (e) { /* fall through */ }
  return defaults();
}
let S = load();
function save({ local = false } = {}) {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save — storage may be full. Export a backup.'); }
  if (!local) sync.schedule();
}
const now = () => Date.now();

/* The part of the state that syncs between devices (the in-progress workout and UI picks stay local). */
function syncedData() {
  const { templates, sessions, settings, deleted, orderUpdatedAt } = S;
  return clone({ templates, sessions, settings, deleted, orderUpdatedAt });
}
function applySynced(m) {
  if (JSON.stringify(m) === JSON.stringify(syncedData())) return;
  Object.assign(S, clone(m));
  save({ local: true });
  refreshLib();
  // Don't yank the screen out from under someone typing in the editor or mid-workout
  if (!['edit', 'workout'].includes(route().name) && !dlg.open) renderKeep();
}
navigator.storage?.persist?.();

/* ---------- formatting ---------- */
const unit = () => S.settings.unit;
function fmtDur(ms) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const fmtClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const fmtRest = sec => !sec ? 'no rest' : sec < 60 ? `${sec}s` : sec % 60 ? fmtClock(sec) : `${sec / 60} min`;
const fmtDate = (t, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(t).toLocaleDateString(undefined, o);
const fmtShort = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const modeUnit = it => it.mode === 'time' ? 's' : 'reps';
function fmtSide(it, sd) {
  const v = sd.v === '' ? '—' : sd.v;
  const w = it.weighted && sd.w !== '' && num(sd.w) ? `${sd.w}${unit()} × ` : '';
  return `${w}${v}${it.mode === 'time' ? 's' : ''}`;
}
function fmtSet(it, st) {
  if (st.B) return esc(fmtSide(it, st.B));
  return `<span class="L">L</span> ${esc(fmtSide(it, st.L))} · <span class="R">R</span> ${esc(fmtSide(it, st.R))}`;
}
// Group identical consecutive sets: "3 × L 20kg × 8 · R 20kg × 8"
function compactSets(it, sets) {
  const out = [];
  for (const st of sets) {
    const t = fmtSet(it, st), last = out[out.length - 1];
    if (last && last.t === t) last.n++; else out.push({ t, n: 1 });
  }
  return out.map(g => `<b>${g.n > 1 ? g.n + ' × ' : ''}${g.t}</b>`).join(', ');
}
const targetLow = t => (String(t || '').match(/\d+(?:[.,]\d+)?/) || [''])[0];
const targetHigh = t => { const m = String(t || '').match(/\d+(?:[.,]\d+)?/g); return m ? num(m[m.length - 1]) : 0; };
const sidesOf = it => it.unilateral ? ['L', 'R'] : ['B'];
const mkSet = u => u ? { done: false, L: { w: '', v: '' }, R: { w: '', v: '' } } : { done: false, B: { w: '', v: '' } };

/* ---------- history lookups ---------- */
function lastPerf(name) {
  const k = norm(name);
  for (let i = S.sessions.length - 1; i >= 0; i--) {
    const s = S.sessions[i];
    const sets = [];
    for (const b of s.blocks) for (const it of b.items) if (norm(it.name) === k) sets.push(...it.sets.filter(x => x.done));
    if (sets.length) return { date: s.start, sets: clone(sets) };
  }
  return null;
}
function lastDone(tplId) {
  for (let i = S.sessions.length - 1; i >= 0; i--) if (S.sessions[i].templateId === tplId) return S.sessions[i].start;
  return 0;
}
function sessionStats(s) {
  let done = 0, total = 0, vol = 0;
  for (const b of s.blocks) for (const it of b.items) for (const st of it.sets) {
    total++;
    if (!st.done) continue;
    done++;
    if (it.mode === 'reps') for (const sd of ['L', 'R', 'B']) if (st[sd]) vol += num(st[sd].w) * num(st[sd].v);
  }
  return { done, total, vol };
}
function allNames() {
  const set = new Map(LIB.map(l => [norm(l.n), l.n]));
  for (const t of S.templates) for (const b of t.blocks) for (const it of b.items) if (it.name) set.set(norm(it.name), it.name);
  for (const s of S.sessions) for (const b of s.blocks) for (const it of b.items) if (it.name) set.set(norm(it.name), it.name);
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}
function refreshLib() { $('#lib').innerHTML = allNames().map(n => `<option value="${esc(n)}">`).join(''); }

/* What to suggest (placeholder) for a set: earlier set this session → same set last time → target */
function suggest(it, si, sd) {
  const out = { w: '', v: targetLow(it.target) };
  const fromSet = st => st && (st[sd] || st.B || st.L);
  const p = it.prev && fromSet(it.prev.sets[si] || it.prev.sets[it.prev.sets.length - 1]);
  if (p) { if (p.w !== '') out.w = p.w; if (p.v !== '') out.v = p.v; }
  for (let j = si - 1; j >= 0; j--) {
    const c = it.sets[j][sd];
    if (c && (c.w !== '' || c.v !== '')) { if (c.w !== '') out.w = c.w; if (c.v !== '') out.v = c.v; break; }
  }
  return out;
}

/* =========================================================================
   Router + render
   ========================================================================= */
let draft = null; // template being edited
const views = { home: vHome, workout: vWorkout, edit: vEdit, history: vHistory, session: vSession, progress: vProgress, settings: vSettings };

function route() { const [name, id] = location.hash.replace(/^#\/?/, '').split('/'); return { name: views[name] ? name : 'home', id }; }
function go(path) { if (location.hash === '#/' + path) render(); else location.hash = '#/' + path; }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function render() {
  const r = route();
  const html = views[r.name](r);
  if (html == null) return;
  $('#app').innerHTML = html;
  const tab = { workout: 'home', edit: 'home', session: 'history' }[r.name] || r.name;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const train = $('#tabs a[data-tab="home"]');
  train.href = S.active ? '#/workout' : '#/home';
  $('#trainLbl').textContent = S.active ? 'Workout' : 'Train';
  tick();
}
function renderKeep() { const y = window.scrollY; render(); window.scrollTo(0, y); }

/* ---------- Home: templates ---------- */
function vHome() {
  const weekStart = startOfWeek(Date.now());
  const thisWeek = S.sessions.filter(s => s.start >= weekStart).length;
  let h = `<header class="hero"><h1>Relevé<span>.</span></h1>
    <p class="muted">${thisWeek ? `${thisWeek} session${thisWeek > 1 ? 's' : ''} this week — keep it up.` : 'No sessions yet this week.'}</p></header>`;

  if (S.active) {
    const st = sessionStats(S.active);
    h += `<button class="card resume" data-act="resume"><span class="dot"></span>
      <span style="flex:1"><b>Workout in progress</b><br><span class="muted small">${esc(S.active.name)} · ${st.done}/${st.total} sets</span></span>
      <span class="ghost">Resume →</span></button>`;
  }

  h += `<div class="sectionhead"><h2>Templates</h2>
    <button class="ghost sm" data-act="importText">Paste text</button>
    <button class="primary sm" data-act="newTpl">+ New</button></div>`;

  if (!S.templates.length) h += `<div class="card empty"><h3>No templates</h3><p>Create one, or paste a plan as text.</p></div>`;
  for (const t of S.templates) {
    const last = lastDone(t.id);
    h += `<div class="card tpl"><div class="row"><h3 style="flex:1">${esc(t.name)}</h3>
      <span class="muted small">${last ? 'Last ' + fmtShort(last) : 'Not done yet'}</span></div>
      ${t.notes ? `<p class="muted small mt-s">${esc(t.notes)}</p>` : ''}
      <ul class="tplsum">${t.blocks.map((b, bi) => `<li><b>${letter(bi)}</b><span style="flex:1">${b.items.map(it =>
        `${esc(it.name || 'Untitled')} <span class="muted">${it.target ? `${it.sets}×${esc(it.target)}${it.mode === 'time' ? 's' : ''}` : `${it.sets} sets`}</span>${it.unilateral ? '<span class="badge">L/R</span>' : ''}`).join(' <span class="muted">+</span> ')}</span>
        <span class="rest">${fmtRest(+b.rest)}</span></li>`).join('')}</ul>
      <div class="row"><button class="primary" data-act="start" data-id="${t.id}">Start</button>
        <button class="secondary" data-act="editTpl" data-id="${t.id}">Edit</button>
        <button class="secondary" data-act="tplMenu" data-id="${t.id}" aria-label="More">•••</button></div></div>`;
  }
  return h;
}

/* ---------- Workout ---------- */
let rest = null; // { end, total, fired, label }
let sw = null;   // stopwatch { key, b, i, s, side, start, target }

function vWorkout() {
  const w = S.active;
  if (!w) { go('home'); return null; }
  keepAwake();
  const st = sessionStats(w);
  let h = `<div class="topbar"><div style="flex:1;min-width:0"><div class="eyebrow">In progress</div><h1>${esc(w.name)}</h1></div>
    <div class="elapsed" id="elapsed">${fmtDur(Date.now() - w.start)}</div></div>
    <div class="progressbar"><div style="width:${st.total ? st.done / st.total * 100 : 0}%"></div></div>`;

  w.blocks.forEach((b, bi) => {
    const sup = b.items.length > 1;
    h += `<section class="card"><div class="blockhead"><span>${sup ? (b.items.length === 2 ? 'Superset' : 'Circuit') : 'Block'} ${letter(bi)}</span>
      <span class="spacer"></span><span>Rest ${fmtRest(+b.rest)}</span></div>`;
    b.items.forEach((it, ii) => { h += exHTML(it, bi, ii, sup); });
    h += `</section>`;
  });

  h += `<button class="secondary full" data-act="adhoc">+ Add exercise</button>
    <label class="field mt"><span>Session notes</span><textarea data-bind="wnotes" rows="3" placeholder="How did it feel? Pain, energy, cues…">${esc(w.notes)}</textarea></label>
    <div class="row mt"><button class="danger" data-act="discard">Discard</button><span class="spacer"></span>
      <button class="primary" data-act="finish">Finish workout</button></div>`;
  return h;
}

function exHTML(it, bi, ii, sup) {
  const tag = letter(bi) + (sup ? ii + 1 : '');
  const sides = sidesOf(it);
  const d = `data-b="${bi}" data-i="${ii}"`;
  let h = `<div class="ex"><div class="exhead"><span class="tag">${tag}</span><div class="exname">${esc(it.name)}
    <div class="sub">${it.sets.length} × ${esc(it.target || '—')} ${it.mode === 'time' ? 'sec' : 'reps'}${it.unilateral ? ' · each side' : ''}${it.weighted ? '' : ' · bodyweight'}</div></div></div>`;
  if (it.notes) h += `<div class="note">${esc(it.notes)}</div>`;
  if (it.prev) h += `<div class="prev">Last · ${fmtShort(it.prev.date)}: ${compactSets(it, it.prev.sets)}</div>`;

  it.sets.forEach((st, si) => {
    h += `<div class="setrow ${st.done ? 'done' : ''}"><div class="setno">${si + 1}</div><div class="sides">`;
    for (const sd of sides) {
      const p = suggest(it, si, sd), cell = st[sd];
      const a = `${d} data-s="${si}" data-side="${sd}"`;
      h += `<div class="side">${it.unilateral ? `<span class="sidelbl ${sd}">${sd}</span>` : ''}`;
      if (it.weighted) h += `<label class="fld"><input data-bind="set" ${a} data-f="w" inputmode="decimal" enterkeyhint="next" value="${esc(cell.w)}" placeholder="${esc(p.w)}"><span>${unit()}</span></label>`;
      h += `<label class="fld"><input data-bind="set" ${a} data-f="v" inputmode="${it.mode === 'time' ? 'numeric' : 'numeric'}" enterkeyhint="next" value="${esc(cell.v)}" placeholder="${esc(p.v)}"><span>${modeUnit(it)}</span></label>`;
      if (it.mode === 'time') {
        const key = `${bi}-${ii}-${si}-${sd}`;
        h += `<button class="iconbtn sw ${sw && sw.key === key ? 'running' : ''}" id="sw-${key}" data-act="sw" ${a} aria-label="Timer">⏱</button>`;
      }
      h += `</div>`;
    }
    h += `</div><button class="check ${st.done ? 'on' : ''}" data-act="done" ${d} data-s="${si}" aria-label="Mark set done">✓</button></div>`;
  });
  h += `<div class="setctl"><button data-act="rmset" ${d}>− set</button><button data-act="addset" ${d}>+ set</button></div></div>`;
  return h;
}

function startWorkout(t) {
  S.active = {
    id: uid(), templateId: t.id, name: t.name, start: Date.now(), notes: '',
    blocks: t.blocks.filter(b => b.items.length).map(b => ({ rest: +b.rest || 0, items: b.items.map(mkItem) })),
  };
  save();
  go('workout');
}
function mkItem(it) {
  return {
    name: it.name || 'Exercise', mode: it.mode, target: it.target, unilateral: !!it.unilateral, weighted: !!it.weighted, notes: it.notes || '',
    prev: lastPerf(it.name), sets: Array.from({ length: Math.max(1, +it.sets || 1) }, () => mkSet(it.unilateral)),
  };
}
const itemAt = d => S.active.blocks[+d.b].items[+d.i];

/* ---------- Template editor ---------- */
function vEdit() {
  if (!draft) { go('home'); return null; }
  const isNew = !S.templates.some(t => t.id === draft.id);
  let h = `<div class="topbar"><button class="ghost" style="padding-left:0" data-act="cancelEdit">Cancel</button>
    <h1 class="center">${isNew ? 'New' : 'Edit'} template</h1><button class="primary sm" data-act="saveTpl">Save</button></div>
    <label class="field"><span>Name</span><input data-bind="draft" data-path="name" value="${esc(draft.name)}" placeholder="e.g. Session 1"></label>
    <label class="field"><span>Notes</span><input data-bind="draft" data-path="notes" value="${esc(draft.notes)}" placeholder="Optional"></label>
    <p class="muted small" style="margin-bottom:12px">Each block is a letter (A, B, C…). Put 2+ exercises in a block for a superset — rest happens after the last one.</p>`;

  draft.blocks.forEach((b, bi) => {
    const p = `blocks.${bi}`;
    h += `<section class="card"><div class="blockhead editing"><span class="tag big">${letter(bi)}</span>
      <label>Rest <input class="num" data-bind="draft" data-path="${p}.rest" data-type="num" inputmode="numeric" value="${esc(b.rest)}"> s</label>
      <span class="spacer"></span>
      <button class="iconbtn" data-act="moveBlock" data-b="${bi}" data-dir="-1" aria-label="Move block up">↑</button>
      <button class="iconbtn" data-act="moveBlock" data-b="${bi}" data-dir="1" aria-label="Move block down">↓</button>
      <button class="iconbtn danger" data-act="delBlock" data-b="${bi}" aria-label="Delete block">✕</button></div>`;
    b.items.forEach((it, ii) => {
      const q = `${p}.items.${ii}`, a = `data-b="${bi}" data-i="${ii}"`;
      h += `<div class="ex edit">
        <div class="row"><span class="tag">${letter(bi)}${b.items.length > 1 ? ii + 1 : ''}</span>
          <input class="grow" list="lib" placeholder="Exercise name" data-bind="draft" data-path="${q}.name" value="${esc(it.name)}" autocomplete="off"></div>
        <div class="row wrap">
          <label class="mini">Sets <input class="num" data-bind="draft" data-path="${q}.sets" data-type="num" inputmode="numeric" value="${esc(it.sets)}"></label>
          <label class="mini">Target <input class="num w" data-bind="draft" data-path="${q}.target" value="${esc(it.target)}" placeholder="${it.mode === 'time' ? '30' : '8-10'}"></label>
          <div class="seg"><button class="${it.mode === 'reps' ? 'on' : ''}" data-act="setMode" ${a} data-mode="reps">Reps</button><button class="${it.mode === 'time' ? 'on' : ''}" data-act="setMode" ${a} data-mode="time">Time</button></div>
        </div>
        <div class="row wrap">
          <label class="chk"><input type="checkbox" data-bind="draft" data-type="bool" data-path="${q}.unilateral" ${it.unilateral ? 'checked' : ''}> Unilateral (L / R)</label>
          <label class="chk"><input type="checkbox" data-bind="draft" data-type="bool" data-path="${q}.weighted" ${it.weighted ? 'checked' : ''}> Track weight</label>
        </div>
        <input class="notes" data-bind="draft" data-path="${q}.notes" value="${esc(it.notes)}" placeholder="Cue / notes (optional)">
        <div class="row end">
          <button class="iconbtn" data-act="moveItem" ${a} data-dir="-1" aria-label="Move up">↑</button>
          <button class="iconbtn" data-act="moveItem" ${a} data-dir="1" aria-label="Move down">↓</button>
          <button class="danger sm" data-act="delItem" ${a}>Remove</button></div></div>`;
    });
    h += `<button class="ghost full sm mt-s" data-act="addItem" data-b="${bi}">+ Add exercise${b.items.length ? ' to superset' : ''}</button></section>`;
  });
  h += `<button class="secondary full" data-act="addBlock">+ Add block ${letter(draft.blocks.length)}</button>`;
  return h;
}

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}

/* Parse plans written like "B1) Push 8-10rep x3 Rest90s" */
function parseTemplateText(txt) {
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const re = /^([A-Za-z])(\d*)\s*[).:\-]\s*(.+)$/;
  let name = '';
  const blocks = new Map();
  let loose = 0;
  for (const line of lines) {
    const m = line.match(re);
    // First line without a block letter and no numbers (besides "Session 1") is the title
    if (!m && !name && !/\d/.test(line.replace(/session\s*\d+/i, ''))) { name = line; continue; }
    const key = m ? m[1].toUpperCase() : `_${loose++}`;
    let s = m ? m[3] : line;

    let restSec = null;
    s = s.replace(/\brest\s*:?\s*(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b/i, (_, n, u) => { restSec = +n * (/^m/i.test(u || '') ? 60 : 1); return ' '; });

    let sets = 3, target = '', mode = 'reps';
    const sxr = s.match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)\s*(reps?|s|sec|secs|seconds)?\b/i);
    if (sxr) {
      sets = +sxr[1]; target = sxr[2].replace(/\s|–/g, m => m === '–' ? '-' : '');
      if (sxr[3] && /^s/i.test(sxr[3])) mode = 'time';
      s = s.replace(sxr[0], ' ');
    } else {
      s = s.replace(/(?:^|\s)[x×]\s*(\d+)\b|\b(\d+)\s*sets?\b/i, (_, a, b) => { sets = +(a || b); return ' '; });
      s = s.replace(/(\d+(?:\s*[-–]\s*\d+)?)\s*(reps?|s|sec|secs|seconds)\b/i, (_, t, u) => {
        target = t.replace(/\s/g, '').replace('–', '-'); if (/^s/i.test(u)) mode = 'time'; return ' ';
      });
    }
    const uniRe = /\b(each side|per side|each leg|per leg|e\/s|\/side|\/leg)\b|\(each\)/i;
    let unilateral = uniRe.test(s) || /\b(SL|single[- ]leg|one[- ]leg|unilateral|split squat|lunges?|step[- ]?ups?|pistol|skater|copenhagen|bound)\b/i.test(s);
    s = s.replace(uniRe, ' ');
    const exName = s.replace(/\s+/g, ' ').replace(/^[\s,\-–|:]+|[\s,\-–|:]+$/g, '').trim() || 'Exercise';
    const lib = LIB.find(l => norm(l.n) === norm(exName));
    if (lib) { unilateral = unilateral || lib.u; if (!target) { target = lib.t; mode = lib.mode; } }
    const weighted = lib ? lib.w : (mode === 'reps' && !/(pogo|jump|hop|bound|plank|abs|hold|skip|push-?up|pull-?up|balance|nordic|crunch|sit-?up)/i.test(exName));

    if (!blocks.has(key)) blocks.set(key, { id: uid(), rest: 60, items: [] });
    const b = blocks.get(key);
    if (restSec != null) b.rest = restSec;
    b.items.push({ id: uid(), name: exName, sets, target, mode, unilateral, weighted, notes: '' });
  }
  return { id: uid(), name: name || 'Imported workout', notes: '', blocks: [...blocks.values()] };
}

/* ---------- History ---------- */
function vHistory() {
  const ss = [...S.sessions].sort((a, b) => b.start - a.start);
  let h = `<div class="topbar"><h1>History</h1></div>`;
  if (!ss.length) return h + `<div class="card empty"><h3>No workouts yet</h3><p>Finished sessions show up here.</p></div>`;
  let month = '';
  for (const s of ss) {
    const m = fmtDate(s.start, { month: 'long', year: 'numeric' });
    if (m !== month) { month = m; h += `<div class="eyebrow month">${m}</div>`; }
    const st = sessionStats(s), d = new Date(s.start);
    h += `<button class="card sess" data-act="openSess" data-id="${s.id}">
      <div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined, { weekday: 'short' })}</span></div>
      <div class="info"><h3>${esc(s.name)}</h3><div class="muted small">${fmtDur((s.end || s.start) - s.start)} · ${st.done} sets${st.vol ? ` · ${Math.round(st.vol).toLocaleString()} ${unit()} vol` : ''}</div></div>
      <span class="chev">›</span></button>`;
  }
  return h;
}

function vSession({ id }) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) { go('history'); return null; }
  const st = sessionStats(s);
  let h = `<div class="topbar"><button class="ghost" style="padding-left:0" data-act="back">‹ Back</button></div>
    <div class="eyebrow">${fmtDate(s.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <h1 style="margin:4px 0 14px">${esc(s.name)}</h1>
    <div class="stats"><div class="stat"><b>${fmtDur((s.end || s.start) - s.start)}</b><span>Duration</span></div>
      <div class="stat"><b>${st.done}</b><span>Sets done</span></div>
      <div class="stat"><b>${st.vol ? Math.round(st.vol).toLocaleString() : '—'}</b><span>Volume (${unit()})</span></div></div>`;
  if (s.notes) h += `<div class="card"><div class="eyebrow">Notes</div><p class="mt-s">${esc(s.notes)}</p></div>`;
  h += `<div class="card">`;
  s.blocks.forEach((b, bi) => b.items.forEach((it, ii) => {
    h += `<div class="detail-ex"><div class="row"><span class="tag">${letter(bi)}${b.items.length > 1 ? ii + 1 : ''}</span><b style="flex:1">${esc(it.name)}</b>
      <span class="muted small">${esc(it.target || '')}${it.target ? ' ' + (it.mode === 'time' ? 'sec' : 'reps') : ''}</span></div>
      <ol>${it.sets.map(x => `<li class="${x.done ? '' : 'skipped'}">${fmtSet(it, x)}</li>`).join('')}</ol></div>`;
  }));
  h += `</div><div class="row mt"><button class="danger" data-act="delSess" data-id="${s.id}">Delete session</button><span class="spacer"></span>
    ${S.templates.some(t => t.id === s.templateId) ? `<button class="secondary" data-act="start" data-id="${s.templateId}">Do again</button>` : ''}</div>`;
  return h;
}

/* ---------- Progress ---------- */
function startOfWeek(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }

function collect() {
  const map = new Map();
  for (const s of [...S.sessions].sort((a, b) => a.start - b.start)) {
    const per = new Map();
    for (const b of s.blocks) for (const it of b.items) {
      const k = norm(it.name); if (!k) continue;
      let e = map.get(k);
      if (!e) { e = { key: k, name: it.name, mode: it.mode, weighted: false, unilateral: false, entries: [], last: 0 }; map.set(k, e); }
      e.name = it.name; e.mode = it.mode; e.last = s.start; e.unilateral ||= it.unilateral;
      let en = per.get(k);
      if (!en) { en = { date: s.start, sides: {} }; per.set(k, en); }
      for (const st of it.sets) {
        if (!st.done) continue;
        for (const sd of ['L', 'R', 'B']) {
          if (!st[sd]) continue;
          const w = num(st[sd].w), v = num(st[sd].v);
          if (w > 0) e.weighted = true;
          const m = en.sides[sd] ||= { top: 0, best: 0, tot: 0, vol: 0, e1rm: 0 };
          m.top = Math.max(m.top, w); m.best = Math.max(m.best, v); m.tot += v; m.vol += w * v;
          if (w > 0 && v > 0 && it.mode === 'reps') m.e1rm = Math.max(m.e1rm, w * (1 + v / 30));
        }
      }
    }
    for (const [k, en] of per) if (Object.keys(en.sides).length) map.get(k).entries.push(en);
  }
  return [...map.values()].filter(e => e.entries.length).sort((a, b) => b.last - a.last);
}

function metricsFor(e) {
  const t = e.mode === 'time';
  const u = unit();
  if (e.weighted && !t) return [
    { k: 'e1rm', label: 'Est. 1RM', fmt: v => `${round(v)} ${u}` },
    { k: 'top', label: 'Top weight', fmt: v => `${round(v)} ${u}` },
    { k: 'vol', label: 'Volume', fmt: v => `${Math.round(v).toLocaleString()} ${u}` },
    { k: 'best', label: 'Best reps', fmt: v => `${round(v)}` },
  ];
  if (e.weighted && t) return [
    { k: 'top', label: 'Top weight', fmt: v => `${round(v)} ${u}` },
    { k: 'best', label: 'Longest', fmt: v => `${round(v)}s` },
    { k: 'tot', label: 'Total time', fmt: v => `${round(v)}s` },
  ];
  if (t) return [{ k: 'best', label: 'Longest', fmt: v => `${round(v)}s` }, { k: 'tot', label: 'Total time', fmt: v => `${round(v)}s` }];
  return [{ k: 'best', label: 'Best reps', fmt: v => `${round(v)}` }, { k: 'tot', label: 'Total reps', fmt: v => `${round(v)}` }];
}

const SIDE = { L: { label: 'Left', color: 'var(--accent)' }, R: { label: 'Right', color: 'var(--accent2)' }, B: { label: 'Both', color: 'var(--ok)' } };

function lineChart(series, fmt) {
  const W = 340, H = 190, pl = 44, pr = 12, pt = 14, pb = 26;
  const pts = series.flatMap(s => s.pts);
  if (!pts.length) return `<p class="muted small">No data for this metric yet.</p>`;
  let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  if (y0 === y1) { y0 = Math.max(0, y0 - 1); y1 += 1; }
  const pad = (y1 - y0) * 0.12; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = x => pl + (x - x0) / (x1 - x0) * (W - pl - pr);
  const Y = y => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = y0 + (y1 - y0) * i / 3, y = Y(v);
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 3}" text-anchor="end">${esc(fmt(v).replace(/ .*/, ''))}</text>`;
  }
  g += `<text x="${pl}" y="${H - 6}">${fmtShort(x0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${fmtShort(x1)}</text>`;
  for (const s of series) {
    if (!s.pts.length) continue;
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += s.pts.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5" fill="${s.color}"/>`).join('');
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

function weeklyBars() {
  const weeks = 12, now = startOfWeek(Date.now()), wk = 7 * 864e5;
  const counts = Array(weeks).fill(0);
  for (const s of S.sessions) { const i = weeks - 1 - Math.round((now - startOfWeek(s.start)) / wk); if (i >= 0 && i < weeks) counts[i]++; }
  const max = Math.max(3, ...counts), W = 340, H = 90, bw = W / weeks;
  let g = '';
  counts.forEach((c, i) => {
    const h = c / max * (H - 22);
    g += `<rect x="${i * bw + 4}" y="${H - 16 - h}" width="${bw - 8}" height="${Math.max(h, 2)}" rx="4" fill="${c ? 'var(--accent)' : 'var(--line)'}"/>`;
    if (c) g += `<text x="${i * bw + bw / 2}" y="${H - 20 - h}" text-anchor="middle">${c}</text>`;
  });
  g += `<text x="2" y="${H - 2}">${fmtShort(now - (weeks - 1) * wk)}</text><text x="${W - 2}" y="${H - 2}" text-anchor="end">This week</text>`;
  return { svg: `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`, counts };
}

function vProgress() {
  let h = `<div class="topbar"><h1>Progress</h1></div>`;
  const wb = weeklyBars();
  let streak = 0; for (let i = wb.counts.length - 1; i >= 0; i--) { if (wb.counts[i]) streak++; else if (i !== wb.counts.length - 1) break; }
  h += `<div class="stats"><div class="stat"><b>${S.sessions.length}</b><span>Sessions</span></div>
    <div class="stat"><b>${wb.counts[wb.counts.length - 1]}</b><span>This week</span></div>
    <div class="stat"><b>${streak}</b><span>Week streak</span></div></div>
    <div class="card"><div class="eyebrow" style="margin-bottom:8px">Sessions per week</div>${wb.svg}</div>`;

  const exs = collect();
  if (!exs.length) return h + `<div class="card empty"><h3>Nothing to chart yet</h3><p>Finish a workout and your exercises will appear here.</p></div>`;

  const e = exs.find(x => x.key === S.ui.ex) || exs[0];
  const ms = metricsFor(e);
  const m = ms.find(x => x.k === S.ui.metric) || ms[0];
  const sides = ['L', 'R', 'B'].filter(sd => e.entries.some(en => en.sides[sd]));
  const series = sides.map(sd => ({ ...SIDE[sd], sd, pts: e.entries.filter(en => en.sides[sd] && en.sides[sd][m.k] > 0).map(en => ({ x: en.date, y: en.sides[sd][m.k] })) }));

  h += `<div class="sectionhead"><h2>Exercise</h2></div>
    <select data-change="pickEx">${exs.map(x => `<option value="${esc(x.key)}" ${x === e ? 'selected' : ''}>${esc(x.name)}${x.unilateral ? ' (L/R)' : ''}</option>`).join('')}</select>
    <div class="chips">${ms.map(x => `<button class="${x === m ? 'on' : ''}" data-act="pickMetric" data-k="${x.k}">${x.label}</button>`).join('')}</div>
    <div class="card">${lineChart(series, m.fmt)}
      <div class="legend">${series.filter(s => s.pts.length).map(s => {
        const best = Math.max(...s.pts.map(p => p.y));
        return `<span><i style="background:${s.color}"></i>${s.label} · best ${m.fmt(best)}</span>`;
      }).join('')}</div></div>`;

  // left/right balance
  if (sides.includes('L') && sides.includes('R')) {
    const both = e.entries.filter(en => en.sides.L?.[m.k] > 0 && en.sides.R?.[m.k] > 0);
    if (both.length) {
      const last = both[both.length - 1], l = last.sides.L[m.k], r = last.sides.R[m.k];
      const diff = Math.abs(l - r) / Math.max(l, r) * 100;
      const cls = diff < 10 ? 'good' : diff < 15 ? 'warn' : 'bad';
      const recent = both.slice(-5).map(en => Math.abs(en.sides.L[m.k] - en.sides.R[m.k]) / Math.max(en.sides.L[m.k], en.sides.R[m.k]) * 100);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      h += `<div class="card"><div class="eyebrow">Left / right balance · ${m.label}</div>
        <div class="balance mt-s"><span class="pct ${cls}">${round(diff)}%</span>
          <span class="small">${diff < 1 ? 'Even on both sides.' : `${l < r ? '<span class="L">Left</span>' : '<span class="R">Right</span>'} is ${round(diff)}% behind on ${fmtShort(last.date)}.`}<br>
          <span class="muted">Avg of last ${recent.length}: ${round(avg)}% · under 10% is a common target.</span></span></div>
        <div class="balbar"><div class="l" style="width:${l / (l + r) * 100}%"></div><div class="r" style="flex:1"></div></div>
        <div class="row small mt-s"><span class="L">L ${m.fmt(l)}</span><span class="spacer"></span><span class="R">R ${m.fmt(r)}</span></div></div>`;
    }
  }

  const rows = e.entries.slice(-12).reverse();
  h += `<div class="card"><div class="eyebrow" style="margin-bottom:6px">Recent · ${m.label}</div><table><tr><th>Date</th>${sides.map(sd => `<th>${SIDE[sd].label}</th>`).join('')}</tr>
    ${rows.map(en => `<tr><td>${fmtDate(en.date)}</td>${sides.map(sd => `<td>${en.sides[sd] && en.sides[sd][m.k] ? m.fmt(en.sides[sd][m.k]) : '—'}</td>`).join('')}</tr>`).join('')}</table></div>`;
  return h;
}

/* ---------- Settings ---------- */
function vSettings() {
  const st = S.settings;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="topbar"><h1>Settings</h1></div>
    <div class="card">
      <div class="setting"><div class="lbl">Weight unit</div><select data-change="unit"><option ${st.unit === 'kg' ? 'selected' : ''}>kg</option><option ${st.unit === 'lb' ? 'selected' : ''}>lb</option></select></div>
      <div class="setting"><div class="lbl">Sounds<small>Beeps for rest and timers (iPhone silent switch mutes them)</small></div><button class="switch ${st.sound ? 'on' : ''}" data-act="toggleSound" aria-label="Sounds"></button></div>
      <div class="setting"><div class="lbl">Timer lead-in<small>Countdown before a timed set starts</small></div>
        <select data-change="leadIn">${[0, 3, 5, 10].map(n => `<option value="${n}" ${+st.leadIn === n ? 'selected' : ''}>${n ? n + 's' : 'Off'}</option>`).join('')}</select></div>
    </div>
    <div class="sectionhead"><h2>Cloud sync</h2></div>
    <div class="card">${syncCard()}</div>
    <div class="sectionhead"><h2>Your data</h2></div>
    <div class="card">
      <p class="muted small">${sync.syncCode() ? 'Saved on this device and synced to the cloud.' : 'Stored on this device only — turn on sync above, or export a backup now and then.'}</p>
      <div class="row wrap mt"><button class="secondary" data-act="export">Export backup</button>
        <label class="secondary" style="display:inline-block">Import backup<input type="file" accept="application/json,.json" data-change="import" hidden></label></div>
      <div class="row wrap mt"><button class="ghost" style="padding-left:0" data-act="addStarters">Add starter templates</button><span class="spacer"></span><button class="danger" data-act="wipe">Erase everything</button></div>
    </div>
    ${standalone ? '' : `<div class="sectionhead"><h2>Install</h2></div><div class="card hint small">
      <p><b>iPhone:</b> open in Safari → Share <code>⬆︎</code> → <b>Add to Home Screen</b>.</p>
      <p class="mt-s"><b>Android:</b> Chrome menu <code>⋮</code> → <b>Add to Home screen</b> / <b>Install app</b>.</p></div>`}
    <p class="muted small center mt">${S.sessions.length} sessions · ${S.templates.length} templates</p>`;
}

function syncStatusText() {
  const last = sync.lastSync();
  return {
    off: 'Off', idle: 'Waiting…', syncing: 'Syncing…', offline: 'Offline — will sync when back online',
    ok: `Up to date${last ? ' · ' + new Date(last).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}`,
    error: `Sync failed: ${sync.lastError}`,
  }[sync.status] || sync.status;
}
function syncCard() {
  const code = sync.syncCode();
  if (!code) return `<p class="small">Keep templates and history in the cloud and share them between your phone, tablet and laptop.
      No account needed — you get a private sync code to enter on your other devices.</p>
    <div class="row wrap mt"><button class="primary" data-act="syncOn">Turn on sync</button><button class="secondary" data-act="syncJoin">I have a code</button></div>`;
  const shown = S.ui.showCode ? esc(code) : '•'.repeat(12) + esc(code.slice(-4));
  const cls = { ok: 'good', error: 'bad', offline: 'warn' }[sync.status] || 'muted';
  return `<div class="setting"><div class="lbl">Status<small id="syncStatus" class="${cls}">${esc(syncStatusText())}</small></div>
      <button class="secondary sm" data-act="syncNow">Sync now</button></div>
    <div class="setting"><div class="lbl">Sync code<small style="font-family:ui-monospace,Menlo,monospace;word-break:break-all">${shown}</small></div>
      <button class="ghost sm" data-act="syncReveal">${S.ui.showCode ? 'Hide' : 'Show'}</button><button class="secondary sm" data-act="syncCopy">Copy</button></div>
    <p class="muted small mt-s">Enter this code on another device to sync it. Anyone with the code can see and change your data — keep it private.</p>
    <div class="row mt"><span class="spacer"></span><button class="danger sm" data-act="syncOff">Stop syncing this device</button></div>`;
}
function syncResult(okMsg) {
  if (sync.status === 'ok') toast(okMsg);
  else if (sync.status === 'error') toast(`Sync failed: ${sync.lastError}`);
  else if (sync.status === 'offline') toast('Offline — will sync later');
  renderKeep();
}

/* =========================================================================
   Dialogs & toast
   ========================================================================= */
const dlg = $('#dlg');
function openDlg(html) { dlg.innerHTML = html; dlg.showModal(); }
function closeDlg() { dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

/* =========================================================================
   Actions
   ========================================================================= */
const A = {
  resume: () => go('workout'),
  back: () => history.length > 1 ? history.back() : go('history'),

  start: d => {
    const t = S.templates.find(x => x.id === d.id);
    if (!t) return;
    if (S.active && !confirm('A workout is already in progress. Discard it and start this one?')) return;
    startWorkout(t);
  },
  newTpl: () => { draft = { id: uid(), name: '', notes: '', blocks: [blk(90, ex('', 3, '8-10'))] }; go('edit'); },
  editTpl: d => { const t = S.templates.find(x => x.id === d.id); if (t) { draft = clone(t); go('edit'); } },
  tplMenu: d => {
    const t = S.templates.find(x => x.id === d.id);
    openDlg(`<h2>${esc(t.name)}</h2><div class="stack mt">
      <button class="secondary full" data-act="dupTpl" data-id="${t.id}">Duplicate</button>
      <button class="secondary full" data-act="moveTpl" data-id="${t.id}" data-dir="-1">Move up</button>
      <button class="secondary full" data-act="moveTpl" data-id="${t.id}" data-dir="1">Move down</button>
      <button class="danger full" data-act="delTpl" data-id="${t.id}">Delete template</button>
      <button class="ghost full" data-act="closeDlg">Cancel</button></div>`);
  },
  dupTpl: d => {
    const i = S.templates.findIndex(x => x.id === d.id);
    const c = clone(S.templates[i]); c.id = uid(); c.name += ' (copy)'; c.updatedAt = S.orderUpdatedAt = now();
    c.blocks.forEach(b => { b.id = uid(); b.items.forEach(it => it.id = uid()); });
    S.templates.splice(i + 1, 0, c); save(); closeDlg(); render();
  },
  moveTpl: d => {
    const i = S.templates.findIndex(x => x.id === d.id), j = i + +d.dir;
    if (j < 0 || j >= S.templates.length) return closeDlg();
    [S.templates[i], S.templates[j]] = [S.templates[j], S.templates[i]]; S.orderUpdatedAt = now(); save(); closeDlg(); render();
  },
  delTpl: d => {
    if (!confirm('Delete this template? Your workout history is kept.')) return;
    S.templates = S.templates.filter(x => x.id !== d.id); S.deleted.templates[d.id] = now(); save(); closeDlg(); render();
  },
  closeDlg,

  importText: () => openDlg(`<h2>Paste a workout</h2>
    <p class="muted small">One exercise per line. Letters group blocks, numbers make supersets. Use <code>30s</code> for timed sets and <code>each side</code> or <code>SL</code> for unilateral.</p>
    <textarea id="importTxt" rows="10" placeholder="Session 1

A) SL pogo hops 15s x3 Rest60s
B1) Bulgarian split squat 6-8rep x3
B2) Copenhagen plank 20-30s x3 Rest90s
C) Abs x2 Rest60s"></textarea>
    <div class="row"><span class="spacer"></span><button class="ghost" data-act="closeDlg">Cancel</button><button class="primary" data-act="doImportText">Create</button></div>`),
  doImportText: () => {
    const txt = $('#importTxt').value;
    if (!txt.trim()) return;
    draft = parseTemplateText(txt);
    if (!draft.blocks.length) return toast('No exercises found in that text.');
    closeDlg(); go('edit'); toast('Check the details, then Save.');
  },

  // editor
  cancelEdit: () => { draft = null; go('home'); },
  saveTpl: () => {
    draft.name = draft.name.trim() || 'Untitled workout';
    draft.blocks.forEach(b => {
      b.rest = Math.max(0, +b.rest || 0);
      b.items = b.items.filter(it => it.name.trim());
      b.items.forEach(it => { it.name = it.name.trim(); it.sets = Math.min(20, Math.max(1, +it.sets || 1)); it.target = String(it.target || '').trim(); });
    });
    draft.blocks = draft.blocks.filter(b => b.items.length);
    if (!draft.blocks.length) return toast('Add at least one exercise with a name.');
    draft.updatedAt = now();
    const i = S.templates.findIndex(t => t.id === draft.id);
    if (i >= 0) S.templates[i] = draft; else { S.templates.push(draft); S.orderUpdatedAt = now(); }
    draft = null; save(); refreshLib(); go('home'); toast('Template saved');
  },
  addBlock: () => { draft.blocks.push(blk(90, ex('', 3, '8-10'))); renderKeep(); focusLast(); },
  delBlock: d => {
    const b = draft.blocks[+d.b];
    if (b.items.some(it => it.name) && !confirm(`Delete block ${letter(+d.b)}?`)) return;
    draft.blocks.splice(+d.b, 1); renderKeep();
  },
  moveBlock: d => {
    const i = +d.b, j = i + +d.dir;
    if (j < 0 || j >= draft.blocks.length) return;
    [draft.blocks[i], draft.blocks[j]] = [draft.blocks[j], draft.blocks[i]]; renderKeep();
  },
  addItem: d => {
    const b = draft.blocks[+d.b], prev = b.items[b.items.length - 1];
    b.items.push(ex('', prev ? prev.sets : 3, '8-10')); renderKeep(); focusLast(+d.b);
  },
  delItem: d => {
    const b = draft.blocks[+d.b];
    b.items.splice(+d.i, 1);
    if (!b.items.length) draft.blocks.splice(+d.b, 1);
    renderKeep();
  },
  // Moving past the top/bottom of a block moves the exercise into the neighbouring block.
  moveItem: d => {
    const bi = +d.b, ii = +d.i, dir = +d.dir, b = draft.blocks[bi];
    const j = ii + dir;
    if (j >= 0 && j < b.items.length) { [b.items[ii], b.items[j]] = [b.items[j], b.items[ii]]; }
    else {
      const [it] = b.items.splice(ii, 1);
      const nb = bi + dir;
      if (nb < 0) draft.blocks.unshift(blk(b.rest, it));
      else if (nb >= draft.blocks.length) draft.blocks.push(blk(b.rest, it));
      else if (dir < 0) draft.blocks[nb].items.push(it);
      else draft.blocks[nb].items.unshift(it);
      draft.blocks = draft.blocks.filter(x => x.items.length);
    }
    renderKeep();
  },
  setMode: d => {
    const it = draft.blocks[+d.b].items[+d.i];
    if (it.mode !== d.mode) { it.mode = d.mode; if (d.mode === 'time' && /^\d+(-\d+)?$/.test(it.target) && targetHigh(it.target) < 20) it.target = '30'; }
    renderKeep();
  },

  // workout
  done: d => {
    const it = itemAt(d), si = +d.s, st = it.sets[si];
    st.done = !st.done;
    if (st.done) {
      for (const sd of sidesOf(it)) {
        const p = suggest(it, si, sd);
        if (st[sd].v === '') st[sd].v = p.v;
        if (it.weighted && st[sd].w === '') st[sd].w = p.w;
      }
      const b = S.active.blocks[+d.b];
      if (+d.i === b.items.length - 1 && +b.rest > 0) {
        const lastSet = b.items.every(x => x.sets.every(y => y.done));
        startRest(+b.rest, lastSet ? `Rest · then block ${letter(+d.b + 1)}` : 'Rest');
      }
    }
    save(); renderKeep();
  },
  addset: d => { const it = itemAt(d); it.sets.push(mkSet(it.unilateral)); save(); renderKeep(); },
  rmset: d => {
    const it = itemAt(d);
    if (it.sets.length <= 1) return;
    const last = it.sets[it.sets.length - 1];
    if (last.done && !confirm('Remove the last set? It is marked done.')) return;
    it.sets.pop(); save(); renderKeep();
  },
  sw: d => {
    const key = `${d.b}-${d.i}-${d.s}-${d.side}`;
    if (sw && sw.key === key) { stopStopwatch(true); return; }
    if (sw) stopStopwatch(true);
    const it = itemAt(d);
    sw = { key, b: +d.b, i: +d.i, s: +d.s, side: d.side, start: Date.now() + (+S.settings.leadIn || 0) * 1000, target: targetHigh(it.target) };
    rest = null;
    renderKeep();
  },
  adhoc: () => openDlg(`<h2>Add exercise</h2>
    <label class="field"><span>Name</span><input id="ahName" list="lib" autocomplete="off" placeholder="e.g. Single-leg RDL"></label>
    <div class="row wrap"><label class="mini">Sets <input id="ahSets" class="num" inputmode="numeric" value="3"></label>
      <label class="mini">Target <input id="ahTarget" class="num w" value="8-10"></label>
      <label class="mini">Rest <input id="ahRest" class="num" inputmode="numeric" value="90"> s</label></div>
    <div class="row wrap"><select id="ahMode" style="width:auto"><option value="reps">Reps</option><option value="time">Time (sec)</option></select>
      <label class="chk"><input id="ahUni" type="checkbox"> Unilateral</label><label class="chk"><input id="ahW" type="checkbox" checked> Weight</label></div>
    <div class="row"><span class="spacer"></span><button class="ghost" data-act="closeDlg">Cancel</button><button class="primary" data-act="adhocAdd">Add</button></div>`),
  adhocAdd: () => {
    const name = $('#ahName').value.trim();
    if (!name) return toast('Give it a name');
    const it = { name, sets: +$('#ahSets').value || 3, target: $('#ahTarget').value.trim(), mode: $('#ahMode').value, unilateral: $('#ahUni').checked, weighted: $('#ahW').checked };
    S.active.blocks.push({ rest: +$('#ahRest').value || 0, items: [mkItem(it)] });
    save(); closeDlg(); render(); window.scrollTo(0, document.body.scrollHeight);
  },
  finish: () => {
    const w = S.active, st = sessionStats(w);
    if (!st.done) { if (confirm('No sets are marked done. Discard this workout instead?')) A.discard(true); return; }
    if (st.done < st.total && !confirm(`${st.total - st.done} sets aren't marked done. Finish anyway?`)) return;
    w.end = w.updatedAt = Date.now();
    w.blocks.forEach(b => b.items.forEach(it => delete it.prev));
    S.sessions.push(w); S.active = null; rest = null; sw = null;
    save(); releaseWake(); refreshLib();
    go('session/' + w.id); toast('Workout saved 💪');
  },
  discard: skipConfirm => {
    if (skipConfirm !== true && !confirm('Discard this workout? Nothing will be saved.')) return;
    S.active = null; rest = null; sw = null; save(); releaseWake(); go('home');
  },

  restAdj: d => { if (rest) { rest.end = Math.max(Date.now(), rest.end) + +d.d * 1000; rest.total = Math.max(rest.total + +d.d, 1); rest.fired = false; $('#restbar').classList.remove('over'); tick(); } },
  restSkip: () => { rest = null; tick(); },

  // history
  openSess: d => go('session/' + d.id),
  delSess: d => { if (!confirm('Delete this session permanently?')) return; S.sessions = S.sessions.filter(s => s.id !== d.id); S.deleted.sessions[d.id] = now(); save(); go('history'); },

  // progress
  pickMetric: d => { S.ui.metric = d.k; save(); renderKeep(); },

  // settings
  toggleSound: () => { S.settings.sound = !S.settings.sound; S.settings.updatedAt = now(); save(); renderKeep(); if (S.settings.sound) beep(880, 0.12); },
  addStarters: () => {
    const t = now();
    S.templates.push(...starterTemplates(true).map(x => ({ ...x, updatedAt: t }))); S.orderUpdatedAt = t; save(); toast('Starter templates added'); go('home'); },
  wipe: () => {
    const synced = !!sync.syncCode();
    if (!confirm(`Erase ALL templates and workout history${synced ? ' — on every synced device' : ' from this device'}?`)) return;
    if (!confirm('Really? This cannot be undone.')) return;
    const t = now(), deleted = clone(S.deleted);
    S.templates.forEach(x => deleted.templates[x.id] = t);
    S.sessions.forEach(x => deleted.sessions[x.id] = t);
    S = { ...defaults(), templates: [], deleted, orderUpdatedAt: t };
    save(); go('home');
  },

  // cloud sync
  syncOn: async () => { await sync.connect(sync.newCode()); syncResult('Sync is on'); },
  syncJoin: () => openDlg(`<h2>Use an existing sync code</h2>
    <p class="muted small">Copy the code from Settings on your other device. Data from both devices will be combined.</p>
    <input id="syncCodeIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste sync code">
    <div class="row"><span class="spacer"></span><button class="ghost" data-act="closeDlg">Cancel</button><button class="primary" data-act="syncJoinGo">Connect</button></div>`),
  syncJoinGo: async () => {
    const code = $('#syncCodeIn').value.trim();
    if (!sync.validCode(code)) return toast('That doesn’t look like a sync code.');
    closeDlg(); await sync.connect(code); syncResult('Connected');
  },
  syncNow: async () => { await sync.syncNow(); syncResult('Synced'); },
  syncCopy: async () => {
    try { await navigator.clipboard.writeText(sync.syncCode()); toast('Sync code copied'); }
    catch { openDlg(`<h2>Your sync code</h2><p class="muted small">Select and copy it:</p><input readonly value="${esc(sync.syncCode())}" onfocus="this.select()"><div class="row"><span class="spacer"></span><button class="primary" data-act="closeDlg">Done</button></div>`); }
  },
  syncReveal: () => { S.ui.showCode = !S.ui.showCode; save({ local: true }); renderKeep(); },
  syncOff: () => {
    if (!confirm('Stop syncing this device? Data stays on this device and in the cloud.')) return;
    sync.disconnect(); renderKeep();
  },
  export: async () => {
    const name = `releve-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Relevé backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};

function focusLast(bi) {
  const sel = bi == null ? 'section.card:last-of-type .grow' : `section.card:nth-of-type(${bi + 1}) .ex:last-of-type .grow`;
  const el = document.querySelectorAll(sel);
  el[el.length - 1]?.focus();
}

/* change handlers (selects / file inputs) */
const C = {
  pickEx: el => { S.ui.ex = el.value; S.ui.metric = null; save(); renderKeep(); },
  unit: el => { S.settings.unit = el.value; S.settings.updatedAt = now(); save(); },
  leadIn: el => { S.settings.leadIn = +el.value; S.settings.updatedAt = now(); save(); },
  import: async el => {
    const f = el.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.templates) || !Array.isArray(d.sessions)) throw new Error('bad');
      if (!confirm(`Replace ${sync.syncCode() ? 'your synced data' : 'data on this device'} with the backup (${d.sessions.length} sessions, ${d.templates.length} templates)?`)) return;
      S = { ...defaults(), ...d, settings: { ...defaults().settings, ...(d.settings || {}) }, ui: d.ui || {}, active: S.active };
      S.deleted = { templates: {}, sessions: {}, ...(d.deleted || {}) };
      save({ local: true }); refreshLib(); render();
      await sync.overwriteRemote();
      toast(sync.syncCode() ? 'Backup restored and uploaded' : 'Backup restored');
    } catch (e) { toast('That file is not a Relevé backup.'); }
    el.value = '';
  },
};

/* ---------- event delegation ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  unlockAudio();
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
function onBind(e) {
  const el = e.target, kind = el.dataset.bind;
  if (!kind) return;
  if (kind === 'set') {
    const d = el.dataset, it = itemAt(d);
    it.sets[+d.s][d.side][d.f] = el.value.replace(',', '.').trim();
    save();
  } else if (kind === 'wnotes') {
    S.active.notes = el.value; save();
  } else if (kind === 'draft' && draft) {
    const v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'num' ? (el.value === '' ? '' : +el.value || 0) : el.value;
    setPath(draft, el.dataset.path, v);
    // Picking a known exercise fills in sensible defaults
    if (e.type === 'change' && el.dataset.path.endsWith('.name')) {
      const lib = LIB.find(l => norm(l.n) === norm(el.value));
      if (lib) {
        const [, bi, , ii] = el.dataset.path.split('.');
        const it = draft.blocks[+bi].items[+ii];
        Object.assign(it, { unilateral: lib.u, mode: lib.mode, weighted: lib.w });
        if (lib.t) it.target = lib.t;
        renderKeep();
      }
    }
  }
}
document.addEventListener('input', onBind);
document.addEventListener('change', e => {
  onBind(e);
  const fn = C[e.target.dataset.change];
  if (fn) fn(e.target);
});
// "next" on the keyboard jumps to the next field in the workout
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.dataset.bind !== 'set') return;
  e.preventDefault();
  const all = [...document.querySelectorAll('input[data-bind="set"]')];
  const n = all[all.indexOf(e.target) + 1];
  n ? n.focus() : e.target.blur();
});

/* =========================================================================
   Timers, sound, wake lock
   ========================================================================= */
function startRest(sec, label) {
  rest = { end: Date.now() + sec * 1000, total: sec, fired: false, label };
  $('#restbar').classList.remove('over');
  tick();
}
function stopStopwatch(write) {
  if (!sw) return;
  const el = Date.now() - sw.start;
  if (write && el > 0 && S.active) {
    const it = S.active.blocks[sw.b]?.items[sw.i];
    if (it) it.sets[sw.s][sw.side].v = String(Math.round(el / 1000));
    save();
  }
  sw = null;
  renderKeep();
}

function tick() {
  const now = Date.now();
  const el = document.getElementById('elapsed');
  if (el && S.active) el.textContent = fmtDur(now - S.active.start);

  const bar = $('#restbar');
  if (rest) {
    const left = Math.ceil((rest.end - now) / 1000);
    if (left <= 0) {
      if (!rest.fired) { rest.fired = true; alarm(); bar.classList.add('over'); }
      if (now - rest.end > 5000) { rest = null; bar.hidden = true; return tickSw(now); }
      $('#restTime').textContent = 'Go!';
      $('#restLabel').textContent = 'Rest done';
      $('#restFill').style.width = '100%';
    } else {
      if (left <= 3 && rest.lastBeep !== left) { rest.lastBeep = left; beep(660, 0.08); }
      $('#restTime').textContent = fmtClock(left);
      $('#restLabel').textContent = rest.label || 'Rest';
      $('#restFill').style.width = `${(1 - (rest.end - now) / (rest.total * 1000)) * 100}%`;
    }
    bar.hidden = false;
  } else bar.hidden = true;
  tickSw(now);
}
function tickSw(now) {
  if (!sw) return;
  const b = document.getElementById('sw-' + sw.key);
  if (now < sw.start) {
    const c = Math.ceil((sw.start - now) / 1000);
    if (sw.lastC !== c) { sw.lastC = c; beep(520, 0.07); }
    if (b) b.textContent = `${c}…`;
  } else {
    if (!sw.started) { sw.started = true; beep(990, 0.18); }
    const e = Math.floor((now - sw.start) / 1000);
    if (b) b.textContent = `${e}s`;
    if (sw.target && e >= sw.target && !sw.beeped) { sw.beeped = true; alarm(); }
  }
}
setInterval(tick, 250);

let actx;
function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* no audio */ }
}
function beep(freq = 880, dur = 0.15, when = 0) {
  if (!S.settings.sound || !actx) return;
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + when;
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
function alarm() { beep(880, 0.16); beep(880, 0.16, 0.22); beep(1320, 0.3, 0.44); navigator.vibrate?.([180, 90, 180]); }

let wake = null;
async function keepAwake() {
  try {
    if (S.active && !wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { wake = null; }
}
function releaseWake() { wake?.release?.(); wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); tick(); } });

/* ---------- boot ---------- */
refreshLib();
if (!location.hash && S.active) location.hash = '#/workout';
render();
sync.initSync({
  getData: syncedData,
  applyData: applySynced,
  onStatus: () => {
    const el = $('#syncStatus');
    if (el) { el.textContent = syncStatusText(); el.className = { ok: 'good', error: 'bad', offline: 'warn' }[sync.status] || 'muted'; }
  },
});
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

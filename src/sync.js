// Cloud sync with the Pages Function at /api/data (backed by Cloudflare KV).
// The app stays local-first: localStorage is always written first, and sync
// runs in the background whenever the device is online.

import { mergeData, sameData } from './merge.js';

const KEY = 'releve.sync';
const API = '/api/data';

let cfg = loadCfg();          // { code, version, lastSync }
let hooks = null;             // { getData, applyData, onStatus }
let timer = null;
let running = null;
let again = false;
export let status = cfg.code ? 'idle' : 'off'; // off | idle | syncing | ok | offline | error
export let lastError = '';

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } }
function setStatus(s, err = '') { status = s; lastError = err; hooks?.onStatus?.(s); }

export const syncCode = () => cfg.code || '';
export const lastSync = () => cfg.lastSync || 0;

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const validCode = c => /^[A-Za-z0-9_-]{20,128}$/.test(c);

export function initSync(h) {
  hooks = h;
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  if (cfg.code) schedule(0);
}

/* Connect this device. `code` is either new (first device) or copied from another device. */
export async function connect(code) {
  cfg = { code, version: 0, lastSync: 0 };
  saveCfg();
  return syncNow();
}
export function disconnect() {
  cfg = {}; saveCfg(); clearTimeout(timer); setStatus('off');
}
/* Replace whatever is in the cloud with this device's data (used after importing a backup). */
export async function overwriteRemote() {
  if (!cfg.code) return;
  const res = await call('PUT', { force: true, data: hooks.getData() });
  if (res.ok) { cfg.version = (await res.json()).version; cfg.lastSync = Date.now(); saveCfg(); setStatus('ok'); }
}

export function schedule(delay = 1500) {
  if (!cfg.code) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  if (!cfg.code) return Promise.resolve();
  if (running) { again = true; return running; }
  running = run().finally(() => {
    running = null;
    if (again) { again = false; schedule(0); }
  });
  return running;
}

function call(method, body) {
  return fetch(API, {
    method,
    headers: { authorization: `Bearer ${cfg.code}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

async function run() {
  if (!navigator.onLine) return setStatus('offline');
  setStatus('syncing');
  try {
    // Pull, merge, then push only if the merged result differs from the cloud copy.
    let res = await call('GET');
    if (!res.ok) throw new Error(await errText(res));
    let remote = await res.json();

    for (let attempt = 0; attempt < 4; attempt++) {
      const merged = mergeData(hooks.getData(), remote.data);
      hooks.applyData(merged);
      if (remote.data && sameData(merged, remote.data)) { cfg.version = remote.version; break; }

      res = await call('PUT', { baseVersion: remote.version || 0, data: merged });
      if (res.ok) { cfg.version = (await res.json()).version; break; }
      if (res.status !== 409) throw new Error(await errText(res));
      remote = await res.json(); // someone else wrote first — merge with theirs and retry
    }
    cfg.lastSync = Date.now();
    saveCfg();
    setStatus('ok');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  }
}

async function errText(res) {
  try { return (await res.json()).error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}

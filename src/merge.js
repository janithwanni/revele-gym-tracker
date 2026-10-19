// Merges two copies of the synced data (e.g. this phone vs. the cloud).
// - templates / sessions: union by id, newer `updatedAt` wins
// - deletions are kept as tombstones ({ id: deletedAt }) so they propagate
// - settings: the copy with the newer `updatedAt` wins
// - template order follows whichever copy changed it most recently

const ts = x => x?.updatedAt || 0;

function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) out[id] = Math.max(out[id] || 0, t);
  return out;
}

function mergeById(a = [], b = [], deleted) {
  const map = new Map();
  for (const x of [...a, ...b]) {
    const cur = map.get(x.id);
    if (!cur || ts(x) > ts(cur)) map.set(x.id, x);
  }
  for (const [id, x] of map) if (id in deleted && deleted[id] >= ts(x)) map.delete(id);
  return map;
}

export function mergeData(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = {
    templates: mergeTombstones(local.deleted?.templates, remote.deleted?.templates),
    sessions: mergeTombstones(local.deleted?.sessions, remote.deleted?.sessions),
  };

  const tpl = mergeById(local.templates, remote.templates, deleted.templates);
  const [first, second] = (remote.orderUpdatedAt || 0) > (local.orderUpdatedAt || 0) ? [remote, local] : [local, remote];
  const order = [...new Set([...(first.templates || []), ...(second.templates || [])].map(t => t.id))];
  const templates = order.filter(id => tpl.has(id)).map(id => tpl.get(id));

  const sessions = [...mergeById(local.sessions, remote.sessions, deleted.sessions).values()].sort((x, y) => x.start - y.start);
  const settings = ts(remote.settings) > ts(local.settings) ? remote.settings : local.settings;

  return {
    templates, sessions, settings, deleted,
    orderUpdatedAt: Math.max(local.orderUpdatedAt || 0, remote.orderUpdatedAt || 0),
  };
}

// Stable comparison so we only upload when something actually changed.
export const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

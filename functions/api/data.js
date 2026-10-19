// Cloudflare Pages Function: /api/data
// Stores one JSON document per sync code in KV. The client sends its secret sync
// code as a bearer token; only its SHA-256 hash is used as the KV key.
//
//   GET  /api/data  → { version, updatedAt, data }   (version 0 / data null when empty)
//   PUT  /api/data  { baseVersion, data, force? }    → { version, updatedAt }
//                   409 + current document when baseVersion is stale (client merges and retries)

const MAX_BYTES = 5 * 1024 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function storageKey(request) {
  const code = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(code)) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return 'user:' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  if (!env.RELEVE_KV) return json({ error: 'KV binding RELEVE_KV is not configured' }, 500);
  const key = await storageKey(request);
  if (!key) return json({ error: 'Missing or invalid sync code' }, 401);

  if (request.method === 'GET') {
    const doc = await env.RELEVE_KV.get(key, { type: 'json' });
    return json(doc || { version: 0, updatedAt: 0, data: null });
  }

  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'Payload too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body.data !== 'object' || body.data === null) return json({ error: 'Missing data' }, 400);

    const current = await env.RELEVE_KV.get(key, { type: 'json' });
    const currentVersion = current?.version || 0;
    if (!body.force && body.baseVersion !== currentVersion) return json(current, 409);

    const doc = { version: currentVersion + 1, updatedAt: Date.now(), data: body.data };
    await env.RELEVE_KV.put(key, JSON.stringify(doc));
    return json({ version: doc.version, updatedAt: doc.updatedAt });
  }

  if (request.method === 'DELETE') {
    await env.RELEVE_KV.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

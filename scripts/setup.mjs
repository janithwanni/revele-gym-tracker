#!/usr/bin/env node
// One-time Cloudflare setup:
//   1. log in to Cloudflare (opens a browser if needed)
//   2. create the KV namespace and write its id into wrangler.toml
//   3. create the Pages project
// Safe to re-run: steps that are already done are skipped.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TOML = new URL('../wrangler.toml', import.meta.url);
const PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';
const isWin = process.platform === 'win32';

function wrangler(args, { capture = false } = {}) {
  const r = spawnSync(isWin ? 'npx.cmd' : 'npx', ['--no-install', 'wrangler', ...args], {
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const step = msg => console.log(`\n\x1b[35m▸ ${msg}\x1b[0m`);
const fail = msg => { console.error(`\n\x1b[31m✖ ${msg}\x1b[0m`); process.exit(1); };

let toml = readFileSync(TOML, 'utf8');
const project = (toml.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || 'releve';

step('Checking Cloudflare login');
const who = wrangler(['whoami'], { capture: true });
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) {
  if (!wrangler(['login']).ok) fail('Login failed. Run `npx wrangler login` and try again.');
} else {
  console.log('  Already logged in.');
}

step('KV namespace (binding RELEVE_KV)');
if (toml.includes(PLACEHOLDER)) {
  const r = wrangler(['kv', 'namespace', 'create', 'RELEVE_KV'], { capture: true });
  process.stdout.write(r.out.replace(/^/gm, '  '));
  const id = (r.out.match(/"?id"?\s*[=:]\s*"([0-9a-f]{32})"/) || [])[1];
  if (!id) fail('Could not read the namespace id from the output above. Paste it into wrangler.toml manually.');
  toml = toml.replace(PLACEHOLDER, id);
  writeFileSync(TOML, toml);
  console.log(`  Saved id ${id} to wrangler.toml`);
} else {
  console.log('  Already configured in wrangler.toml.');
}

step(`Pages project "${project}"`);
const p = wrangler(['pages', 'project', 'create', project, '--production-branch', 'main'], { capture: true });
if (p.ok) console.log('  Created.');
else if (/already exists|8000002/i.test(p.out)) console.log('  Already exists.');
else { process.stdout.write(p.out); fail('Could not create the Pages project.'); }

console.log(`\n\x1b[32m✔ Setup complete.\x1b[0m Deploy with:  npm run deploy\n`);

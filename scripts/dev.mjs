#!/usr/bin/env node
// Local development: Vite (with hot reload) on :5173, plus the Pages Functions
// running in wrangler on :8788 with a local, simulated KV store. Vite proxies /api to it.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('../dist', import.meta.url), { recursive: true }); // wrangler expects the output dir to exist
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const procs = [
  spawn(npx, ['--no-install', 'wrangler', 'pages', 'dev', '--port', '8788', '--show-interactive-dev-session=false'], { stdio: 'inherit' }),
  spawn(npx, ['--no-install', 'vite', '--host'], { stdio: 'inherit' }),
];
const stop = code => { procs.forEach(p => p.kill()); process.exit(code ?? 0); };
procs.forEach(p => p.on('exit', code => stop(code)));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

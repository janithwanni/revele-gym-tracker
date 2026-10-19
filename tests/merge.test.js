import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData } from '../src/merge.js';

const base = (o = {}) => ({ templates: [], sessions: [], settings: { unit: 'kg', updatedAt: 0 }, deleted: { templates: {}, sessions: {} }, orderUpdatedAt: 0, ...o });
const tpl = (id, updatedAt, name = id) => ({ id, name, updatedAt, blocks: [] });
const sess = (id, start, updatedAt = start) => ({ id, start, updatedAt, blocks: [] });

test('sessions from both devices are combined and sorted', () => {
  const m = mergeData(base({ sessions: [sess('a', 3), sess('b', 1)] }), base({ sessions: [sess('c', 2), sess('a', 3)] }));
  assert.deepEqual(m.sessions.map(s => s.id), ['b', 'c', 'a']);
});

test('newer template edit wins', () => {
  const m = mergeData(base({ templates: [tpl('t', 5, 'local')] }), base({ templates: [tpl('t', 9, 'remote')] }));
  assert.equal(m.templates[0].name, 'remote');
});

test('deletion propagates but a later edit survives it', () => {
  const local = base({ sessions: [sess('s', 1)], templates: [tpl('t', 20)] });
  const remote = base({ deleted: { sessions: { s: 10 }, templates: { t: 10 } } });
  const m = mergeData(local, remote);
  assert.equal(m.sessions.length, 0);
  assert.equal(m.templates.length, 1); // edited at 20, after the delete at 10
  assert.equal(m.deleted.sessions.s, 10);
});

test('template order follows the most recent reorder; new ones are appended', () => {
  const local = base({ templates: [tpl('a', 1), tpl('b', 1)], orderUpdatedAt: 5 });
  const remote = base({ templates: [tpl('b', 1), tpl('a', 1), tpl('c', 1)], orderUpdatedAt: 9 });
  assert.deepEqual(mergeData(local, remote).templates.map(t => t.id), ['b', 'a', 'c']);
  assert.deepEqual(mergeData(remote, local).templates.map(t => t.id), ['b', 'a', 'c']);
});

test('newer settings win; empty remote keeps local', () => {
  const local = base({ settings: { unit: 'lb', updatedAt: 3 } });
  assert.equal(mergeData(local, base({ settings: { unit: 'kg', updatedAt: 1 } })).settings.unit, 'lb');
  assert.equal(mergeData(local, null), local);
});

test('fresh devices with the same starter ids do not duplicate', () => {
  const a = base({ templates: [tpl('starter-plyo', 0)] }), b = base({ templates: [tpl('starter-plyo', 0)] });
  assert.equal(mergeData(a, b).templates.length, 1);
});

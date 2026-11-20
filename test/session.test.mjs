import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { createSession, sessionOf, MEMO_MAX } from '../src/logic/session.mjs';
import { withDocs } from '../app/src/lib/view/derive.mjs';

const ships = new Map([1, 2, 3].map((id) => [id, { id, name: `S${id}`, msrp: id * 5000, concept: false }]));
const offers = [{ from: 1, to: 2, kind: 'standard', cash: 5000 }, { from: 2, to: 3, kind: 'standard', cash: 5000 }];
const app = () => {
  const plans = newState();
  addChain(plans, { base: 1, target: 3 });
  return { data: { ships, offers, owned: [] }, graph: buildGraph({ offers }), plans, overrides: { ships: {} }, expected: offers, saleEvents: { rev: 0, events: [] } };
};

test('shared, proposal and route are computed once and agree', () => {
  const s = createSession(app());
  assert.equal(s.shared, s.shared);
  assert.equal(s.proposal('c1', 1), s.proposal('c1', 1));
  assert.notEqual(s.proposal('c1', 1), s.proposal('c1', 3));
  assert.equal(s.route('c1'), s.proposal('c1', 1).routes[0]);
  assert.equal(s.route('c1').cash, 10000);
  assert.equal(s.fleet(), s.fleet());
  assert.equal(s.wanted('c1'), s.wanted('c1'));
  assert.notEqual(s.wanted('c1', 2000), s.wanted('c1'));
  assert.equal(s.avail('2026-11-18'), s.avail('2026-11-18'));
  assert.equal(s.avail('2026-11-18').today, '2026-11-18');
});

test('memo caches per namespace and key, keeps MEMO_MAX entries and evicts the least recently used', () => {
  const s = createSession(app());
  let n = 0;
  const get = (k, ns = 'x') => s.memo(ns, k, () => ({ k, n: ++n }));
  const first = get(0);
  for (let k = 1; k < MEMO_MAX; k++) get(k);
  assert.equal(get(0), first, 'MEMO_MAX entries fit, and a hit refreshes recency');
  get(MEMO_MAX); // evicts key 1, the least recently used
  const count = n;
  assert.equal(get(0), first);
  assert.equal(n, count);
  get(1);
  assert.equal(n, count + 1, 'key 1 was evicted');
  assert.notEqual(get(0, 'y'), first, 'another namespace is separate');
  assert.equal(s.scratch('a', () => ({})), s.scratch('a', () => ({})));
  assert.notEqual(s.scratch('a', () => ({}), true), s.scratch('b', () => ({})));
});

test('sessionOf reuses the session while the documents and revisions are the same and replaces it otherwise', () => {
  const a = app();
  const s = sessionOf(a);
  assert.equal(a.session, s);
  assert.equal(sessionOf(a), s);
  assert.equal(sessionOf({ ...a }), s, 'a copy of the app shares the documents, so the session');
  for (const change of [
    (x) => { x.plans.rev = 1; },
    (x) => { x.overrides = { ...x.overrides }; },
    (x) => { x.overrides.rev = 4; },
    (x) => { x.saleEvents = { ...x.saleEvents }; },
    (x) => { x.saleEvents.rev = 2; },
    (x) => { x.graph = { ...x.graph }; },
    (x) => { x.data = { ...x.data }; },
    (x) => { x.expected = [...x.expected]; },
  ]) {
    const x = app();
    const before = sessionOf(x);
    change(x);
    assert.notEqual(sessionOf(x), before);
  }
});

test('withDocs attaches a session and builds a new one for new documents', () => {
  const base = app();
  const x = withDocs(base, base.plans, base.overrides, base.saleEvents);
  assert.ok(x.session);
  assert.equal(sessionOf(x), x.session, 'the attached session is valid for its own app');
  const y = withDocs(x, { ...x.plans, rev: 5 }, x.overrides, x.saleEvents);
  assert.notEqual(y.session, x.session);
  assert.equal(y.session.plans, y.plans);
});

test('memo room grows with the number of goals, so many goals do not thrash', () => {
  const a = app();
  for (let i = 0; i < 24; i++) addChain(a.plans, { base: 1, target: 3 });
  const s = createSession(a);
  const first = s.memo('x', 0, () => ({}));
  for (let k = 1; k < 3 * 25; k++) s.memo('x', k, () => ({}));
  assert.equal(s.memo('x', 0, () => ({})), first, 'three entries per goal fit');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createController } from '../../app/src/lib/view/controller.mjs';

const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/raw-small.json', import.meta.url), 'utf8'));
const aliases = { items: {} };

function fakeBackend(overrides = {}) {
  const calls = { save: [], load: 0 };
  return {
    calls,
    async load() { calls.load++; return structuredClone({ ...raw, plans: null, overrides: null }); },
    async save(name, doc, baseRev) { calls.save.push([name, structuredClone(doc), baseRev]); return baseRev + 1; },
    ...overrides,
  };
}

test('dispatch saves the changed doc and the next dispatch uses the bumped rev', async () => {
  const backend = fakeBackend();
  const c = createController(backend, aliases);
  await c.load();
  assert.ok(c.state);
  await c.dispatch({ type: 'setCredit', cents: 500 });
  assert.equal(backend.calls.save.length, 1);
  const [name, doc, rev] = backend.calls.save[0];
  assert.equal(name, 'plans');
  assert.equal(rev, 0);
  assert.equal(doc.profile.credit, 500);
  assert.equal(c.state.plans.profile.credit, 500);
  assert.equal(c.state.plans.rev, 1);
  await c.dispatch({ type: 'setCredit', cents: 700 });
  assert.equal(backend.calls.save.length, 2);
  assert.equal(backend.calls.save[1][2], 1);
});

test('an overrides action saves the overrides doc', async () => {
  const backend = fakeBackend();
  const c = createController(backend, aliases);
  await c.load();
  await c.dispatch({ type: 'setPrice', shipId: 1, cents: 6000 });
  assert.equal(backend.calls.save[0][0], 'overrides');
  assert.equal(c.state.overrides.rev, 1);
  assert.equal(c.state.overrides.ships[1].msrp, 6000);
});

test('a conflict reloads and sets the notice', async () => {
  const backend = fakeBackend({ async save() { throw { conflict: true }; } });
  const c = createController(backend, aliases);
  await c.load();
  assert.equal(backend.calls.load, 1);
  await c.dispatch({ type: 'setCredit', cents: 500 });
  assert.equal(backend.calls.load, 2);
  assert.equal(c.notice, 'Changed outside the app; reloaded. Do it again.');
});

test('other errors set the notice to their message and keep the state', async () => {
  const backend = fakeBackend();
  const c = createController(backend, aliases);
  await c.load();
  await c.dispatch({ type: 'remove', chainId: 'nope' });
  assert.match(c.notice, /unknown chain/);
  assert.equal(backend.calls.save.length, 0);
});

test('onChange fires after load and dispatch', async () => {
  let n = 0;
  const c = createController(fakeBackend(), aliases, { onChange: () => n++ });
  await c.load();
  const afterLoad = n;
  await c.dispatch({ type: 'setCredit', cents: 1 });
  assert.ok(afterLoad >= 1 && n > afterLoad);
});

test('a non-conflict failure leaves the state untouched', async () => {
  const backend = fakeBackend({ async save() { throw new Error('disk full'); } });
  const c = createController(backend, aliases);
  await c.load();
  const before = c.state;
  const snapshot = structuredClone({ plans: before.plans, overrides: before.overrides });
  await c.dispatch({ type: 'setCredit', cents: 500 });
  assert.equal(c.notice, 'disk full');
  assert.equal(c.state, before);
  assert.deepEqual({ plans: c.state.plans, overrides: c.state.overrides }, snapshot);
});

test('a reload that fails after a conflict sets a notice and does not reject', async () => {
  let loads = 0;
  const backend = fakeBackend({
    async load() { if (loads++ > 0) throw new Error('corrupt catalog'); return structuredClone({ ...raw, plans: null, overrides: null }); },
    async save() { throw { conflict: true }; },
  });
  const c = createController(backend, aliases);
  await c.load();
  await assert.doesNotReject(c.dispatch({ type: 'setCredit', cents: 500 }));
  assert.match(c.notice, /corrupt catalog/);
});

test('two dispatches fired together save with revs 0 then 1 and no conflict', async () => {
  let disk = 0;
  const bases = [];
  const backend = fakeBackend({
    async save(name, doc, baseRev) {
      await new Promise((r) => setTimeout(r, 5));
      bases.push(baseRev);
      if (baseRev !== disk) throw { conflict: true };
      return ++disk;
    },
  });
  const c = createController(backend, aliases);
  await c.load();
  await Promise.all([c.dispatch({ type: 'setCredit', cents: 100 }), c.dispatch({ type: 'setCredit', cents: 200 })]);
  assert.deepEqual(bases, [0, 1]);
  assert.equal(c.notice, null);
  assert.equal(c.state.plans.rev, 2);
  assert.equal(c.state.plans.profile.credit, 200);
});

test('a sale-event action saves the sale-events doc and keeps the other docs', async () => {
  const backend = fakeBackend();
  const c = createController(backend, aliases);
  await c.load();
  await c.dispatch({ type: 'setSaleEvent', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' });
  assert.deepEqual([backend.calls.save[0][0], backend.calls.save[0][2]], ['sale-events', 0]);
  assert.equal(c.state.saleEvents.rev, 1);
  assert.equal(c.state.saleEvents.events[0].name, 'IAE 2956');
  await c.dispatch({ type: 'setCredit', cents: 100 });
  assert.equal(c.state.saleEvents.events.length, 1, 'a plans save keeps the events');
  await c.dispatch({ type: 'setAvailability', shipId: 1, value: 'regular' });
  assert.equal(backend.calls.save.at(-1)[0], 'overrides');
  assert.equal(c.state.overrides.ships[1].availability, 'regular');
  assert.equal(c.state.saleEvents.events.length, 1);
  await c.dispatch({ type: 'removeSaleEvent', id: 'e1' });
  assert.equal(backend.calls.save.at(-1)[2], 1, 'second save of the doc starts from rev 1');
  assert.deepEqual(c.state.saleEvents.events, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createController } from '../../app/src/lib/view/controller.mjs';
import { deriveAppState, withDocs } from '../../app/src/lib/view/derive.mjs';
import { createJobHost, workerApp } from '../../app/src/lib/view/jobs.mjs';
import { catalogAge } from '../../app/src/lib/view/storeBrowser.mjs';
import { ongoingEvent } from '../../src/logic/availability.mjs';
import { eventSource } from '../../src/logic/feed.mjs';

const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/raw-small.json', import.meta.url), 'utf8'));
const aliases = { items: {} };
const FEED = { events: [{ id: 'iae-2956', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27', note: '' }], at: '2026-11-20T10:00:00.000Z' };

function backend() {
  const saves = [];
  return { saves, async load() { return structuredClone({ ...raw, plans: null, overrides: null, saleEvents: null }); }, async save(name, doc, rev) { saves.push([name, structuredClone(doc)]); return rev + 1; } };
}

test('the app state carries yours plus the feed sale events; the planner sees the feed event as ongoing', async () => {
  let feed = FEED;
  const c = createController(backend(), aliases, { feed: () => feed });
  await c.load();
  assert.deepEqual(c.state.saleEvents.events.map((e) => [e.id, eventSource(e)]), [['feed:iae-2956', 'feed']]);
  assert.equal(ongoingEvent(c.state.saleEvents, '2026-11-18').name, 'IAE 2956');
  feed = { events: [], at: null };
  await c.refeed();
  assert.deepEqual(c.state.saleEvents.events, []);
});

test('saving a sale event writes only yours (rev, no feed events, no stamp); the feed one stays in the state', async () => {
  const b = backend();
  const c = createController(b, aliases, { feed: () => FEED });
  await c.load();
  await c.dispatch({ type: 'setSaleEvent', name: 'My sale', from: '2026-12-01', to: '2026-12-02' });
  const [name, doc] = b.saves[0];
  assert.equal(name, 'sale-events');
  assert.deepEqual(doc.events.map((e) => e.name), ['My sale']);
  assert.equal(doc.feedAt, undefined);
  assert.deepEqual(c.state.saleEvents.events.map((e) => e.name), ['My sale', 'IAE 2956']);
  assert.equal(c.state.saleEvents.rev, 1);
  // Other saves keep the feed's part and never write it.
  await c.dispatch({ type: 'setCredit', cents: 100 });
  assert.equal(c.state.saleEvents.events.length, 2);
  assert.equal(b.saves.length, 2);
  // Removing yours leaves the feed's; the feed's id is not removable (it was never saved).
  await c.dispatch({ type: 'removeSaleEvent', id: 'e1' });
  assert.deepEqual(c.state.saleEvents.events.map((e) => e.id), ['feed:iae-2956']);
  assert.equal(b.saves.length, 3);
  const before = b.saves.length;
  await c.dispatch({ type: 'removeSaleEvent', id: 'feed:iae-2956' });
  assert.equal(b.saves.length, before, 'nothing saved');
  assert.match(c.notice, /unknown sale event/);
});

test('your own event with the feed event\'s name wins in the state', async () => {
  const c = createController(backend(), aliases, { feed: () => FEED });
  await c.load();
  await c.dispatch({ type: 'setSaleEvent', name: 'IAE 2956', from: '2026-11-15', to: '2026-11-20' });
  assert.deepEqual(c.state.saleEvents.events.map((e) => [e.id, e.to, eventSource(e)]), [['e1', '2026-11-20', 'you']]);
});

test('a controller without feed() has none, and deriveAppState takes an explicit feed', () => {
  assert.deepEqual(deriveAppState(structuredClone(raw), aliases).saleEvents.events, []);
  assert.equal(deriveAppState(structuredClone(raw), aliases, { feed: FEED }).saleEvents.events.length, 1);
});

test('a merged document sent to the job worker keeps the feed part, and a new feed stamp is a new revision there', () => {
  const app = deriveAppState(structuredClone(raw), aliases, { feed: FEED });
  const inWorker = workerApp(app.data, { plans: app.plans, overrides: app.overrides, saleEvents: app.saleEvents });
  assert.deepEqual(inWorker.saleEvents.events.map((e) => e.id), ['feed:iae-2956']);
  assert.equal(inWorker.saleEvents.feedAt, FEED.at);
  const posts = [];
  const built = [];
  const host = createJobHost({ post: (m) => posts.push(m), makeApp: (d, docs) => { built.push(docs.saleEvents.feedAt); return { docs }; }, run: () => 'ok' });
  host.handle({ type: 'data', dataId: 1, data: {} });
  host.handle({ type: 'run', id: 1, dataId: 1, docs: { plans: app.plans, overrides: app.overrides, saleEvents: app.saleEvents }, op: 'x', args: {} });
  host.handle({ type: 'run', id: 2, dataId: 1, docs: { plans: app.plans, overrides: app.overrides, saleEvents: { ...app.saleEvents, feedAt: 'newer' } }, op: 'x', args: {} });
  assert.deepEqual(built, [FEED.at, 'newer']);
});

test('the Browse store header says where the catalog is from', () => {
  const now = new Date('2026-11-20T15:00:00');
  assert.match(catalogAge('2026-11-20T14:05:00', false, now, 'feed'), /^Catalog from the CCU Planner feed, today, \d\d:\d\d$/);
  assert.match(catalogAge('2026-11-20T14:05:00', false, now), /^Public store catalog from today/);
  assert.match(catalogAge('2026-11-20T14:05:00', true, now, 'own'), /signed in$/);
  assert.equal(catalogAge(null, false, now, 'feed'), 'No store catalog yet');
});

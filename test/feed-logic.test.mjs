import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEvents, mergeSaleEvents, userSaleEvents, feedEventsOf, eventSource, runningFeedEvent, feedCatalog, chooseCatalog } from '../src/logic/feed.mjs';
import { availability, ongoingEvent } from '../src/logic/availability.mjs';
import { applyAction } from '../src/logic/state.mjs';

const IAE = { id: 'iae-2956', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27', note: 'banner date' };

test('readEvents: valid entries only (skipped on a client, an error when strict), ids made when missing, ids unique', () => {
  const doc = { events: [{ name: 'A  sale', from: '2026-01-01', to: '2026-01-02' }, { name: '', from: '2026-01-01', to: '2026-01-02' }, { name: 'B', from: '2026-02-30', to: '2026-03-01' }, { name: 'C', from: '2026-03-02', to: '2026-03-01' }, { id: 'dup', name: 'D', from: '2026-04-01', to: '2026-04-02' }, { id: 'dup', name: 'E', from: '2026-05-01', to: '2026-05-02' }] };
  const got = readEvents(doc);
  assert.deepEqual(got.map((e) => [e.id, e.name]), [['2026-01-01-a-sale', 'A sale'], ['dup', 'D']]);
  assert.throws(() => readEvents(doc, { strict: true }), /event 2 needs a name/);
  assert.deepEqual(readEvents(null), []);
  assert.deepEqual(readEvents({ events: 'x' }), []);
});

test('merge: the feed adds its events, tagged and with a feed: id; yours stay as they are and win on the same name or the same dates', () => {
  const mine = { rev: 3, events: [{ id: 'e1', name: 'iae 2956 ', from: '2026-11-15', to: '2026-11-26' }, { id: 'e2', name: 'Other', from: '2026-12-01', to: '2026-12-03' }] };
  const feed = [IAE, { id: 'x', name: 'Black Friday', from: '2026-11-27', to: '2026-11-30' }, { id: 'y', name: 'Same dates', from: '2026-12-01', to: '2026-12-03' }];
  const doc = mergeSaleEvents(mine, feed, '2026-11-20T10:00:00.000Z');
  assert.equal(doc.rev, 3);
  assert.deepEqual(doc.events.map((e) => e.id), ['e1', 'e2', 'feed:x'], 'the feed IAE (same name) and "Same dates" (same dates) are dropped');
  assert.equal(doc.events[2].source, 'feed');
  assert.deepEqual(doc.events.map(eventSource), ['you', 'you', 'feed']);
  assert.equal(doc.feedAt, '2026-11-20T10:00:00.000Z');
  assert.equal(mine.events.length, 2, 'the input is not changed');
  // With none of yours the feed's event is what the planner sees.
  const only = mergeSaleEvents({ rev: 0, events: [] }, [IAE], 'at');
  assert.equal(ongoingEvent(only, '2026-11-18').name, 'IAE 2956');
  assert.equal(runningFeedEvent(only, '2026-11-18').id, 'feed:iae-2956');
  assert.equal(runningFeedEvent(only, '2026-11-28'), null);
  assert.equal(runningFeedEvent(doc, '2026-11-20'), null, 'a feed event you overrode is not "the feed one running"');
});

test('what is saved never has the feed in it: userSaleEvents strips the tagged events and the stamp, and is idempotent', () => {
  const merged = mergeSaleEvents({ rev: 2, events: [{ id: 'e1', name: 'Mine', from: '2026-01-01', to: '2026-01-02' }] }, [IAE], 'at');
  const user = userSaleEvents(merged);
  assert.deepEqual(user, { rev: 2, events: [{ id: 'e1', name: 'Mine', from: '2026-01-01', to: '2026-01-02' }] });
  assert.deepEqual(userSaleEvents(user), user);
  assert.deepEqual(userSaleEvents(null), { rev: 0, events: [] });
  assert.deepEqual(feedEventsOf(merged).map((e) => e.id), ['iae-2956']);
  // An action on the merged document would save the feed's event; on userSaleEvents(merged) it does not.
  const out = applyAction({ plans: { rev: 0, chains: {}, profile: {} }, overrides: { rev: 0, ships: {} }, saleEvents: userSaleEvents(merged) }, { type: 'setSaleEvent', name: 'New', from: '2026-02-01', to: '2026-02-02' }, {});
  assert.deepEqual(out.saleEvents.events.map((e) => e.id), ['e1', 'e2']);
  assert.ok(out.saleEvents.events.every((e) => !e.source) && out.saleEvents.feedAt === undefined);
});

test('the planner treats a feed event like one you entered: sale days inside it do not count as regular availability', () => {
  const doc = mergeSaleEvents({ rev: 0, events: [] }, [IAE], 'at');
  const saleHistory = { ships: { 7: { onSaleDays: ['2026-11-15', '2026-11-25'] } } };
  const r = availability(7, { saleHistory, saleEvents: doc, today: '2026-12-10', standardNow: true });
  assert.equal(r.daysOutside, 0);
  assert.equal(r.status, 'event-only');
  assert.equal(availability(7, { saleHistory, saleEvents: { rev: 0, events: [] }, today: '2026-12-10', standardNow: true }).daysOutside, 2, 'without it both days count as outside');
});

test('feedCatalog is public only and keeps a picture only where the feed picture is saved (as feed/catalog/<id>.webp)', () => {
  const raw = { fetchedAt: '2026-11-20T10:00:00.000Z', signedIn: true, items: [1, 2, 3].map((id) => ({ id, title: `T${id}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/ships/a/${id}`, priceCents: 5, thumb: id === 3 ? null : `catalog/${id}.webp` })) };
  const c = feedCatalog(raw, (n) => n === 'catalog/1.webp');
  assert.equal(c.signedIn, false);
  assert.deepEqual(c.items.map((i) => i.thumb), ['feed/catalog/1.webp', null, null]);
  assert.equal(feedCatalog(null), null);
  assert.equal(feedCatalog({ items: 'x' }), null);
});

test('chooseCatalog: nothing; only one; a signed-in own catalog always wins; a public own one loses only to a newer feed', () => {
  const doc = (fetchedAt, signedIn = false, n = 2) => ({ fetchedAt, signedIn, items: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) });
  assert.equal(chooseCatalog(null, null), null);
  assert.equal(chooseCatalog(null, doc('2026-11-20T10:00:00Z')).source, 'feed');
  assert.equal(chooseCatalog(doc('2026-11-01T10:00:00Z'), null).source, 'own');
  assert.equal(chooseCatalog(doc('2026-11-01T10:00:00Z', true), doc('2026-11-20T10:00:00Z')).source, 'own', 'signed in: Subscriber and Concierge items only exist there');
  assert.equal(chooseCatalog(doc('2026-11-01T10:00:00Z'), doc('2026-11-20T10:00:00Z')).source, 'feed');
  assert.equal(chooseCatalog(doc('2026-11-20T10:00:00Z'), doc('2026-11-20T10:00:00Z')).source, 'own', 'equal: yours');
  assert.equal(chooseCatalog(doc('2026-11-21T10:00:00Z'), doc('2026-11-20T10:00:00Z')).source, 'own');
  assert.equal(chooseCatalog(doc(null), doc('2026-11-20T10:00:00Z')).source, 'feed', 'an own catalog of unknown age is older than a dated feed');
  assert.equal(chooseCatalog(doc('2026-11-01T10:00:00Z'), doc(null)).source, 'own', 'a feed of unknown age is never preferred');
  assert.equal(chooseCatalog(doc('2026-11-01T10:00:00Z'), doc('2026-11-20T10:00:00Z', false, 0)).source, 'own', 'an empty feed catalog is no catalog');
});

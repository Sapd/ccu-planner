import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, acceptRoute, splitRoute, lockReason, expectedChanges } from '../src/logic/chains.mjs';
import { classifyCopies, meltPlan, KEEP } from '../src/logic/melt.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { eventAlertText, meltEventHint, meltHeadline, noEventsNotice, NO_EVENTS_NOTICE } from '../src/logic/describe.mjs';
import {
  availability, availCtx, appendSaleHistory, onSaleShipIds, addSaleEvent, removeSaleEvent, emptySaleEvents, localToday, hasStandardSku, shortDay, MAX_HISTORY_DAYS,
} from '../src/logic/availability.mjs';
import { expectedOffers } from '../src/logic/prices.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { deriveAppState } from '../app/src/lib/view/derive.mjs';
import { routeAdvice } from '../src/logic/advice.mjs';
import { meltView, availabilityRows } from '../app/src/lib/view/hangar.mjs';

const IAE = { rev: 1, events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }] };
const hist = (...days) => ({ ships: { 2: { onSaleDays: days } } });
const at = (today, days, extra = {}) => availability(2, { saleHistory: hist(...days), saleEvents: IAE, today, ...extra });

test('availability: seen only during the ongoing event is unknown and names the event', () => {
  const a = at('2026-11-18', ['2026-11-18']);
  assert.equal(a.status, 'unknown');
  assert.equal(a.event.name, 'IAE 2956');
  assert.deepEqual([a.daysOutside, a.firstSeen, a.lastSeen], [0, '2026-11-18', '2026-11-18']);
});

test('availability: two days outside events, a week apart, is regular', () => {
  const a = at('2026-11-18', ['2026-10-01', '2026-10-20']);
  assert.equal(a.status, 'regular');
  assert.equal(a.daysOutside, 2);
  assert.equal(a.event.id, 'e1', 'the ongoing event is reported either way');
});

test('availability: outside days under 7 days apart, or one day, stay unknown; exactly 7 is regular', () => {
  assert.equal(at('2026-11-18', ['2026-10-01', '2026-10-03']).status, 'unknown');
  assert.equal(at('2026-11-18', ['2026-10-01']).status, 'unknown');
  assert.equal(at('2026-11-18', ['2026-10-01', '2026-10-08']).status, 'regular');
  assert.equal(at('2026-11-18', ['2026-10-01', '2026-10-01', '2026-10-02']).status, 'unknown', 'distinct days only');
});

test('availability: event dates are inclusive and do not count as outside', () => {
  assert.equal(at('2026-11-18', ['2026-11-14', '2026-11-27']).daysOutside, 0);
  assert.equal(at('2026-12-05', ['2026-11-13', '2026-11-28']).status, 'regular');
});

test('availability: seen only on event days after the event ended is event-only', () => {
  assert.equal(at('2026-12-05', ['2026-11-15', '2026-11-20', '2026-11-27']).status, 'event-only');
  const ongoing = at('2026-11-27', ['2026-11-15', '2026-11-20']);
  assert.equal(ongoing.status, 'unknown', 'the event has not ended yet');
  assert.equal(at('2026-12-05', []).status, 'unknown', 'no history');
});

test('availability: no Standard SKU today is off-sale whatever the history says; overrides win', () => {
  const days = ['2026-10-01', '2026-10-20'];
  assert.equal(at('2026-11-18', days, { standardNow: false }).status, 'off-sale');
  const ov = (v) => ({ ships: { 2: { availability: v } } });
  assert.equal(at('2026-11-18', ['2026-11-18'], { overrides: ov('regular') }).status, 'regular');
  assert.equal(at('2026-11-18', days, { overrides: ov('event-only') }).status, 'event-only');
  assert.equal(at('2026-11-18', days, { overrides: ov('event-only') }).override, true);
  assert.equal(at('2026-11-18', ['2026-11-18'], { overrides: { ships: { 2: { msrp: 100 } } } }).status, 'unknown', 'a price override alone is no availability mark');
});

test('availability: missing documents are no history', () => {
  assert.equal(availability(2, { today: '2026-11-18' }).status, 'unknown');
  assert.equal(availability(2, { saleHistory: { ships: {} }, saleEvents: { events: [] }, today: '2026-11-18' }).event, null);
});

test('localToday formats the local calendar day; shortDay and hasStandardSku', () => {
  assert.equal(localToday(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
  assert.equal(shortDay('2026-11-27'), 'Nov 27');
  assert.equal(hasStandardSku({ skus: [{ title: 'Warbond Edition' }] }), false);
  assert.equal(hasStandardSku({ skus: [{ title: 'Warbond Edition' }, { title: 'Standard Edition' }] }), true);
  assert.equal(hasStandardSku({ skus: [] }), false);
  assert.equal(hasStandardSku({}), false);
});

test('appendSaleHistory adds today once per ship, keeps 365 newest days and never mutates', () => {
  const before = { ships: { 1: { onSaleDays: ['2026-11-01'] } } };
  const snapshot = structuredClone(before);
  const a = appendSaleHistory(before, [1, 2], '2026-11-18');
  assert.deepEqual(a.ships[1].onSaleDays, ['2026-11-01', '2026-11-18']);
  assert.deepEqual(a.ships[2].onSaleDays, ['2026-11-18']);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(appendSaleHistory(a, [1], '2026-11-18').ships[1].onSaleDays, ['2026-11-01', '2026-11-18'], 'same day twice');
  const long = { ships: { 1: { onSaleDays: Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)) } } };
  const b = appendSaleHistory(long, [1], '2026-11-18').ships[1].onSaleDays;
  assert.equal(b.length, MAX_HISTORY_DAYS);
  assert.equal(b.at(-1), '2026-11-18');
  assert.equal(b[0], '2025-01-02', 'oldest day dropped');
  assert.deepEqual(appendSaleHistory(null, [3], '2026-11-18').ships[3].onSaleDays, ['2026-11-18']);
});

test('sale events: add validates, ids never repeat, remove unknown throws', () => {
  const { doc, event } = addSaleEvent(emptySaleEvents(), { name: ' IAE 2956 ', from: '2026-11-14', to: '2026-11-27' });
  assert.deepEqual(event, { id: 'e1', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' });
  const two = addSaleEvent(doc, { name: 'B', from: '2027-01-01', to: '2027-01-01' });
  assert.equal(two.event.id, 'e2');
  const removed = removeSaleEvent(two.doc, 'e1');
  assert.equal(addSaleEvent(removed, { name: 'C', from: '2027-02-01', to: '2027-02-02' }).event.id, 'e3');
  assert.throws(() => addSaleEvent(doc, { name: '', from: '2026-11-14', to: '2026-11-27' }), /name/);
  assert.throws(() => addSaleEvent(doc, { name: 'x', from: '2026-02-30', to: '2026-03-01' }), /YYYY-MM-DD/);
  assert.throws(() => addSaleEvent(doc, { name: 'x', from: '2026-11-27', to: '2026-11-14' }), /cannot end before/);
  assert.throws(() => removeSaleEvent(doc, 'e9'), /unknown sale event/);
});

// ----- state actions -----

const doc = () => ({ plans: newState(), overrides: { rev: 0, ships: {} }, saleEvents: emptySaleEvents() });

test('applyAction: sale events change the saleEvents document only, without mutating the input', () => {
  const d = doc();
  const snap = structuredClone(d);
  const r = applyAction(d, { type: 'setSaleEvent', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' });
  assert.equal(r.changed, 'saleEvents');
  assert.equal(r.saleEvents.events.length, 1);
  assert.equal(r.result.id, 'e1');
  assert.deepEqual(d, snap);
  assert.equal(r.saleEvents.rev, 0, 'the store bumps rev');
  const rm = applyAction({ ...d, saleEvents: r.saleEvents }, { type: 'removeSaleEvent', id: 'e1' });
  assert.equal(rm.changed, 'saleEvents');
  assert.deepEqual(rm.saleEvents.events, []);
  assert.throws(() => applyAction(d, { type: 'removeSaleEvent', id: 'zz' }), /unknown sale event/);
});

test('applyAction: availability marks live beside the expected price and clear independently', () => {
  let d = applyAction(doc(), { type: 'setPrice', shipId: 4, cents: 16000, note: 'n' });
  d = applyAction(d, { type: 'setAvailability', shipId: 4, value: 'regular', note: 'always there' });
  assert.equal(d.changed, 'overrides');
  assert.deepEqual([d.overrides.ships[4].msrp, d.overrides.ships[4].availability, d.overrides.ships[4].availabilityNote], [16000, 'regular', 'always there']);
  d = applyAction(d, { type: 'setPrice', shipId: 4, cents: 17000 });
  assert.equal(d.overrides.ships[4].availability, 'regular', 'a new price keeps the mark');
  d = applyAction(d, { type: 'clearPrice', shipId: 4 });
  assert.deepEqual(d.overrides.ships[4], { availability: 'regular', availabilityNote: 'always there' }, 'clearing the price keeps the mark');
  d = applyAction(d, { type: 'clearAvailability', shipId: 4 });
  assert.equal(Object.hasOwn(d.overrides.ships, 4), false, 'nothing left, entry removed');
  d = applyAction(d, { type: 'setAvailability', shipId: 5, value: 'event-only' });
  d = applyAction(d, { type: 'setPrice', shipId: 5, cents: 100 });
  d = applyAction(d, { type: 'clearAvailability', shipId: 5 });
  assert.equal(d.overrides.ships[5].msrp, 100, 'clearing the mark keeps the price');
  assert.throws(() => applyAction(doc(), { type: 'setAvailability', shipId: 4, value: 'maybe' }), /availability must be/);
  assert.throws(() => applyAction(doc(), { type: 'setAvailability', shipId: 99, value: 'regular' }, { ships: new Map() }), /unknown ship 99/);
});

test('an availability-only override is not an expected price', () => {
  const ships = new Map([[1, { id: 1, msrp: 5000 }], [2, { id: 2, msrp: 7500 }]]);
  const offers = [{ from: 1, to: 2, kind: 'standard', cash: 2000 }]; // a Standard price that is not the msrp difference
  const out = expectedOffers(offers, ships, { ships: { 2: { availability: 'regular' } } });
  assert.equal(out, offers, 'untouched');
});

// ----- melt -----

const ships = new Map([
  [1, { id: 1, name: 'A', msrp: 5000, concept: false, standard: true }],
  [2, { id: 2, name: 'B', msrp: 7500, concept: false, standard: true }],
  [3, { id: 3, name: 'C', msrp: 10000, concept: false, standard: true }],
]);
const offers = [{ from: 1, to: 2, kind: 'standard', cash: 2500 }, { from: 2, to: 3, kind: 'standard', cash: 2500 }, { from: 1, to: 3, kind: 'standard', cash: 5000 }];
const copy = (copyId, from, to, paid) => ({ copyId, from, to, paid: { cents: paid }, meltable: true, extras: [] });
const owned = [copy('m', 1, 2, 2500)]; // meets every old rule: saving 0, rebuyable
const ctx = (over = {}) => ({ data: { ships, saleHistory: hist('2026-11-18'), saleEvents: IAE }, overrides: { ships: {} }, ...over });

test('melt: a copy that met every old rule keeps with UNKNOWN_AVAIL while its target is only seen during the event', () => {
  const avail = availCtx({ data: { ships, saleHistory: { ships: { 2: { onSaleDays: ['2026-11-18'] } } }, saleEvents: IAE }, overrides: { ships: {} } }, '2026-11-18');
  const [r] = classifyCopies({ owned, offers, ships }, newState(), { avail });
  assert.equal(r.candidate, false);
  assert.equal(r.keep, 'not known to stay on sale after IAE 2956 (seen on sale only during it)');
  assert.equal(KEEP.UNKNOWN_AVAIL.includes('<event>'), true);
  assert.equal(r.availability, 'unknown');
});

test('melt: the same copy with the target overridden to regular is a candidate', () => {
  const avail = availCtx({ data: ctx().data, overrides: { ships: { 2: { availability: 'regular' } } } }, '2026-11-18');
  const [r] = classifyCopies({ owned, offers, ships }, newState(), { avail });
  assert.equal(r.candidate, true);
  assert.equal(r.availability, 'regular');
});

test('melt: regular by history is a candidate; event-only, no history and off-sale keep with their reasons', () => {
  const run = (saleHistory, shipMap = ships) => classifyCopies({ owned, offers, ships: shipMap }, newState(), { avail: availCtx({ data: { ships: shipMap, saleHistory, saleEvents: IAE }, overrides: { ships: {} } }, '2026-12-05') })[0];
  assert.equal(run(hist('2026-10-01', '2026-10-20')).candidate, true);
  assert.equal(run(hist('2026-11-15', '2026-11-20')).keep, KEEP.EVENT_ONLY);
  assert.equal(run(null).keep, KEEP.UNKNOWN_HISTORY);
  const off = new Map(ships).set(2, { ...ships.get(2), standard: false });
  assert.equal(run(hist('2026-10-01', '2026-10-20'), off).keep, KEEP.NOT_REBUYABLE);
});

test('melt: without an availability context nothing is a candidate', () => {
  assert.equal(classifyCopies({ owned, offers, ships }, newState())[0].candidate, false);
});

test('melt plan passes availability to its candidates', () => {
  const s = newState();
  const c = addChain(s, { base: 1, target: 3, mode: 'finish' });
  acceptRoute(s, c.id, { steps: [{ kind: 'standard', from: 1, to: 3, cash: 5000 }], cash: 5000, creditUsed: 0 });
  const none = meltPlan({ owned, offers, ships }, s, { avail: availCtx({ data: ctx().data, overrides: { ships: {} } }, '2026-11-18') });
  assert.equal(none.candidates.length, 0);
  assert.equal(none.melt.length, 0);
  const some = meltPlan({ owned, offers, ships }, s, { avail: availCtx({ data: ctx().data, overrides: { ships: { 2: { availability: 'regular' } } } }, '2026-11-18') });
  assert.equal(some.candidates.length, 1);
  assert.equal(some.melt.length, 1);
});

test('melt wording: the headline no longer says rebuyable today', () => {
  const h = meltHeadline({ candidates: [], candidateCredit: 0 }, false);
  assert.equal(h.includes('same Standard price today'), false);
  assert.ok(h.includes('rebuyable outside sale events (seen on sale on ≥2 days outside events, or marked regular by you)'));
  assert.equal(meltEventHint({ name: 'IAE 2956' }), 'Melt suggestions stay conservative until a sync has run after IAE 2956 ends.');
  assert.equal(meltEventHint(null), null);
});

// ----- buy later -----

// A watch chain 1 -> 2 -> 3 whose last (Standard) step is into 3, and 2 -> 3 Standard bridge.
function watchChain(target = 3) {
  const s = newState();
  const c = addChain(s, { base: 1, target });
  const route = proposeChain(s, c.id, buildGraph({ offers, owned: [] })).routes[0];
  return { s, c, route };
}
const eventAvail = (over = {}) => availCtx({ data: { ships, saleHistory: hist('2026-11-18'), saleEvents: IAE }, overrides: { ships: over } }, '2026-11-18');

test('buy later: during the event a Standard last step into an unknown target is locked now with reason event', () => {
  const { c, route } = watchChain();
  const avail = eventAvail();
  assert.equal(lockReason(c, ships, null, avail), 'event');
  const sp = splitRoute(route, { lock: !!lockReason(c, ships, null, avail) });
  assert.equal(sp.lockNow.length, 1);
  assert.equal(sp.lockNow[0].to, 3);
});

test('buy later: the same step outside any event with a regular target stays Later', () => {
  const { c, route } = watchChain();
  const regular = availCtx({ data: { ships, saleHistory: { ships: { 3: { onSaleDays: ['2026-10-01', '2026-10-20'] } } }, saleEvents: IAE }, overrides: { ships: {} } }, '2026-12-05');
  assert.equal(lockReason(c, ships, null, regular), null);
  assert.equal(splitRoute(route, { lock: !!lockReason(c, ships, null, regular) }).lockNow.length, 0);
  // Still inside the event but marked regular by you: no lock either.
  assert.equal(lockReason(c, ships, null, eventAvail({ 3: { availability: 'regular' } })), null);
  // No event ongoing, history short: unknown but nothing to lose right now.
  assert.equal(lockReason(c, ships, null, availCtx({ data: { ships, saleHistory: null, saleEvents: IAE }, overrides: { ships: {} } }, '2026-12-05')), null);
  // lock off wins, no ctx means no event.
  assert.equal(lockReason({ ...c, lock: 'off' }, ships, null, eventAvail()), null);
  assert.equal(lockReason(c, ships, null), null);
});

test('buy later: expectedChanges alerts event for later Standard steps into non-regular targets', () => {
  const { route } = watchChain();
  const alerts = expectedChanges(route, offers, ships, eventAvail()).alerts.filter((a) => a.reason === 'event');
  assert.ok(alerts.length >= 1);
  assert.equal(alerts[0].event.name, 'IAE 2956');
  assert.equal(eventAlertText(alerts[0]), 'only known on sale during IAE 2956 (ends Nov 27): buy before it ends or risk losing this upgrade path');
  assert.equal(expectedChanges(route, offers, ships, eventAvail({ 2: { availability: 'regular' }, 3: { availability: 'regular' } })).alerts.length, 0);
  assert.equal(expectedChanges(route, offers, ships).alerts.length, 0, 'without a context nothing changes');
  assert.equal(expectedChanges(route, offers, ships, eventAvail()).buyBefore.some((a) => a.reason === 'event'), true);
});

test('buy later: a price rise still wins over the event reason', () => {
  const route = { steps: [{ kind: 'standard', from: 1, to: 2, cash: 2500 }] };
  const higher = [{ from: 1, to: 2, kind: 'standard', cash: 3000 }];
  assert.equal(expectedChanges(route, higher, ships, eventAvail()).alerts[0].reason, 'pricier');
});

// ----- app state -----

const rawSmall = (extra = {}) => ({
  catalog: { fetchedAt: 'C', ships: [1, 2, 3].map((id) => ({ id, name: `S${id}`, msrp: 5000 + id * 2500, owned: false, skus: [{ id: id * 10, title: 'Standard Edition', available: true }] })) },
  details: null, upgrades: [], hangar: null, buyback: null, history: '', plans: null, overrides: null, ...extra,
});

test('buildPlannerData carries sale history and events and a Standard flag per ship', () => {
  const d = buildPlannerData(rawSmall({ saleHistory: hist('2026-11-18'), saleEvents: IAE }), { items: {} });
  assert.deepEqual(d.saleHistory, hist('2026-11-18'));
  assert.equal(d.saleEvents, IAE);
  assert.equal(d.ships.get(1).standard, true);
  const none = buildPlannerData(rawSmall(), { items: {} });
  assert.deepEqual([none.saleHistory, none.saleEvents], [null, null]);
});

function appFor(raw) {
  return deriveAppState({ ...raw, offers: undefined }, { items: {} });
}

test('routeAdvice moves the Standard last step into the lock group through the event reason', () => {
  const { c, route } = watchChain();
  const locked = routeAdvice(null, { ...c, mode: 'watch' }, route, { ships, avail: eventAvail() });
  assert.equal(locked.groups.lockNow.length, 1);
  assert.equal(locked.lockCode, 'event');
  assert.equal(routeAdvice(null, { ...c, mode: 'watch' }, route, { ships, avail: null }).groups.lockNow.length, 0);
});

test('meltView recomputes when the day or the sale events rev changes; availabilityRows lists Standard ships', () => {
  const app = appFor(rawSmall({ saleHistory: hist('2026-11-18'), saleEvents: IAE }));
  const calls = [];
  const compute = (a, today) => { calls.push(today); return { today }; };
  meltView(app, { compute, today: '2026-11-18' });
  meltView(app, { compute, today: '2026-11-18' });
  assert.deepEqual(calls, ['2026-11-18']);
  meltView(app, { compute, today: '2026-11-19' });
  meltView({ ...app, saleEvents: { ...app.saleEvents, rev: 5 } }, { compute, today: '2026-11-18' });
  assert.equal(calls.length, 3);
  const rows = availabilityRows(app, '2026-11-18');
  assert.deepEqual(rows.map((r) => r.name), ['S1', 'S2', 'S3']);
  assert.equal(rows.find((r) => r.shipId === 2).status, 'unknown');
  assert.equal(rows.find((r) => r.shipId === 2).mark, 'auto');
});

test('onSaleShipIds picks the ships with an available Standard SKU', () => {
  const list = [
    { id: 1, skus: [{ title: 'Standard Edition', available: true }] },
    { id: 2, skus: [{ title: 'Warbond Edition', available: true }] },
    { id: 3, skus: [{ title: 'Standard Edition', available: false }] },
    { id: 4, skus: [] },
    { id: 5, skus: [{ title: 'Warbond Edition' }, { title: 'Standard Edition' }] },
  ];
  assert.deepEqual(onSaleShipIds(list), [1, 5]);
  assert.deepEqual(onSaleShipIds(null), []);
  // Two syncs on different days make a ship regular once they are a week apart and outside events.
  let h = appendSaleHistory(null, onSaleShipIds(list), '2026-10-01');
  h = appendSaleHistory(h, onSaleShipIds(list), '2026-10-09');
  assert.equal(availability(1, { saleHistory: h, saleEvents: emptySaleEvents(), today: '2026-10-10' }).status, 'regular');
});

test('the no-sale-events notice shows with zero events and not with one', () => {
  assert.equal(noEventsNotice(emptySaleEvents()), NO_EVENTS_NOTICE);
  assert.equal(noEventsNotice(null), NO_EVENTS_NOTICE);
  assert.ok(NO_EVENTS_NOTICE.startsWith('No sale events entered — days during sales like IAE count as normal on-sale days.'));
  assert.equal(noEventsNotice(IAE), null);
});

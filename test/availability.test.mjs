import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, acceptRoute } from '../src/logic/chains.mjs';
import { classifyCopies, meltPlan, KEEP } from '../src/logic/melt.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { availabilityText, meltReasonPlain, meltHeadline, noEventsNotice, NO_EVENTS_NOTICE } from '../src/logic/describe.mjs';
import {
  availability, availCtx, appendSaleHistory, onSaleShipIds, addSaleEvent, removeSaleEvent, emptySaleEvents, localToday, hasStandardSku, shortDay, MAX_HISTORY_DAYS,
} from '../src/logic/availability.mjs';
import { withLocale } from '../src/logic/i18n.mjs';
import '../src/logic/i18n/de/index.mjs';
import { expectedOffers } from '../src/logic/prices.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { deriveAppState } from '../app/src/lib/view/derive.mjs';
import { routeAdvice } from '../src/logic/advice.mjs';
import { meltView, availabilityRows } from '../app/src/lib/view/hangar.mjs';

const IAE = { rev: 1, events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }] };
const hist = (...days) => ({ ships: { 2: { onSaleDays: days } } });
test('store facts use recorded sync days, including days that missed the ship', () => {
  let history = appendSaleHistory(null, [1, 2], '2026-11-18', '2026-11-18T11:00:00Z');
  history = appendSaleHistory(history, [], '2026-11-20', '2026-11-20T11:00:00Z');
  history = appendSaleHistory(history, [2], '2026-11-21', '2026-11-21T11:00:00Z');
  history = appendSaleHistory(history, [2], '2026-11-24', '2026-11-24T11:00:00Z');
  const facts = (id) => availability(id, { saleHistory: history, saleEvents: IAE });
  assert.deepEqual(facts(2), {
    inStore: true, lastSyncDay: '2026-11-24', lastSyncAt: '2026-11-24T11:00:00Z',
    since: '2026-11-21', previousMiss: '2026-11-20', lastSeen: '2026-11-24', seenDays: 3,
    seenOutsideEvents: false, seenIn: IAE.events[0], confirmedOutsideEvents: false, meltSafe: false,
  });
  assert.equal(facts(1).since, null);
  assert.equal(facts(1).lastSeen, '2026-11-18');

  history = appendSaleHistory(history, [], '2026-11-24', '2026-11-24T12:00:00Z');
  assert.equal(facts(2).inStore, false);
  assert.equal(facts(2).lastSeen, '2026-11-24');
  assert.equal(facts(2).lastSyncAt, '2026-11-24T12:00:00Z');
});

test('legacy history has day-level facts and event dates include both endpoints', () => {
  const get = (...days) => availability(2, { saleHistory: hist(...days), saleEvents: IAE });
  assert.equal(get('2026-11-14', '2026-11-27').seenOutsideEvents, false);
  assert.equal(get('2026-11-27', '2026-11-28').seenOutsideEvents, true);
  assert.equal(get('2026-11-13').seenOutsideEvents, true);
  assert.equal(get('2026-11-27').lastSyncAt, null);
  assert.equal(availability(2).inStore, null);
});

test('a legacy catalog supplies the latest store observation and timestamp', () => {
  const catalogAt = new Date(2026, 10, 22, 12).toISOString();
  const ctx = availCtx({
    data: { saleHistory: hist('2026-11-21'), meta: { catalogAt }, ships: new Map([
      [1, { id: 1, standard: true }], [2, { id: 2, standard: false }],
    ]) },
    saleEvents: IAE,
  }, '2026-11-28');
  assert.equal(availability(1, ctx).inStore, true);
  const gone = availability(2, ctx);
  assert.equal(gone.inStore, false);
  assert.equal(gone.lastSyncAt, catalogAt);
  assert.equal(gone.lastSeen, '2026-11-21');
});

test('availability and melt wording describes observations in English and German', () => {
  const saleHistory = { ships: { 1: { onSaleDays: ['2026-11-20'] }, 2: { onSaleDays: ['2026-11-21', '2026-11-22'] } } };
  const get = (id) => availability(id, { saleHistory, saleEvents: IAE });
  const texts = () => [availabilityText(get(2)), availabilityText(get(1)), meltReasonPlain(KEEP.NO_OUTSIDE_OBSERVATION)];
  assert.deepEqual(texts(), [
    "In the store since Nov 21; not there at the Nov 20 sync. Seen in the store on 2 sync days, all during IAE 2956 (RSI's banner: until Nov 27).",
    'Not in the store at the last sync (Nov 22). Last seen Nov 20.',
    'Kept: not yet seen in the store on two syncs clear of any sale.',
  ]);
  const german = withLocale('de', texts);
  assert.match(german[0], /Seit 21\. Nov.*2 Sync-Tagen.*während IAE 2956/);
  assert.match(german[1], /Beim letzten Sync.*nicht im Store/);
  assert.match(german[2], /noch nicht bei zwei Syncs außerhalb aller Sales/);
  for (const line of [...texts(), ...german]) {
    assert.doesNotMatch(line, /usually|next event|return|may leave|meist|nächste[ns]?\s+Event|zurück|verschwinden/i);
  }
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
  d = applyAction(d, { type: 'setAvailability', shipId: 5, value: 'regular' });
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

test('melt requires an exact Standard offer, the ship in the store, and two sync days clear of every event', () => {
  let saleHistory = hist('2026-11-18');
  const run = (currentOffers = offers, availability) => classifyCopies({ owned, offers: currentOffers, ships }, newState(), {
    avail: availCtx({ data: { ships, saleHistory, saleEvents: IAE }, overrides: { ships: { 2: { availability } } } }, '2026-11-28'),
  })[0];
  assert.equal(run().keep, KEEP.NO_OUTSIDE_OBSERVATION);
  assert.equal(run(offers, 'regular').candidate, true);
  saleHistory = appendSaleHistory(saleHistory, [1], '2026-11-28');
  assert.equal(run().keep, KEEP.NO_OUTSIDE_OBSERVATION, 'a post-event miss does not qualify');
  saleHistory = appendSaleHistory(saleHistory, [2], '2026-11-28');
  assert.equal(run().keep, KEEP.NO_OUTSIDE_OBSERVATION, 'the day after the banner date may still be the sale (no time zone)');
  saleHistory = appendSaleHistory(saleHistory, [2], '2026-11-30');
  assert.equal(run().keep, KEEP.NO_OUTSIDE_OBSERVATION, 'one clear day is not enough');
  saleHistory = appendSaleHistory(saleHistory, [1], '2026-12-02');
  assert.equal(run().keep, KEEP.NO_OUTSIDE_OBSERVATION, 'not in the store at the last sync');
  saleHistory = appendSaleHistory(saleHistory, [2], '2026-12-02');
  assert.equal(run().candidate, true);
  assert.equal(run(offers, 'event-only').candidate, true, 'legacy verdicts are ignored');
  const noEvents = classifyCopies({ owned, offers, ships }, newState(), { avail: availCtx({ data: { ships, saleHistory, saleEvents: { rev: 0, events: [] } } }, '2026-12-02') })[0];
  assert.equal(noEvents.keep, KEEP.NO_OUTSIDE_OBSERVATION, 'without any recorded sale event no day counts as clear');
  assert.equal(run(offers.slice(1)).keep, KEEP.NOT_REBUYABLE);
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

test('melt headline describes the current offer and the outside-sale observation', () => {
  assert.match(meltHeadline({ candidates: [], candidateCredit: 0 }, false),
    /Standard offer at the last sync, target seen in the store on two syncs clear of any sale, or confirmed/);
});

test('event-only history produces the same store facts before and after the banner date without another sync', () => {
  const saleHistory = { ships: { 1: { onSaleDays: ['2026-11-20'] }, 2: { onSaleDays: ['2026-11-21'] } } };
  const step = { from: 1, to: 2, kind: 'standard', cash: 500 };
  const fillerShips = new Map(ships).set(2, { ...ships.get(2), msrp: 5500 });
  const chain = { target: 2, mode: 'watch' };
  const observations = [];
  for (const today of ['2026-11-26', '2026-11-28']) {
    const avail = availCtx({ data: { saleHistory, saleEvents: IAE } }, today);
    observations.push([1, 2].map((id) => availability(id, avail)));
    const advice = routeAdvice(null, chain, { steps: [step] }, { avail, ships: fillerShips, expected: [step] });
    assert.equal(advice.lockCode, null);
    assert.deepEqual(advice.groups.later, [step]);
    assert.deepEqual(advice.buys, []);
    assert.deepEqual(advice.alerts, []);
  }
  assert.deepEqual(observations[0], observations[1]);
  assert.equal(observations[1][1].inStore, true);
  assert.equal(observations[1][1].seenOutsideEvents, false);
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
  assert.equal(rows.find((r) => r.shipId === 2).inStore, true);
  assert.equal(rows.find((r) => r.shipId === 2).seenOutsideEvents, false);
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
  // One observed day outside any event is enough.
  let h = appendSaleHistory(null, onSaleShipIds(list), '2026-10-01');
  h = appendSaleHistory(h, onSaleShipIds(list), '2026-10-09');
  assert.equal(availability(1, { saleHistory: h, saleEvents: emptySaleEvents(), today: '2026-10-10' }).seenOutsideEvents, true);
});

test('the no-sale-events notice shows with zero events and not with one', () => {
  assert.equal(noEventsNotice(emptySaleEvents()), NO_EVENTS_NOTICE);
  assert.equal(noEventsNotice(null), NO_EVENTS_NOTICE);
  assert.ok(NO_EVENTS_NOTICE.startsWith('No sale events recorded. All sync days count as outside sale events.'));
  assert.equal(noEventsNotice(IAE), null);
});

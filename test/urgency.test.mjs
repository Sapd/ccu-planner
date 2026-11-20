// Urgency of a purchase: "buy today", "on sale, no rush" or "optional" (urgency.mjs), the notes that
// override it, and the one routeAdvice.buys list every page reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPurchase, offerNote, daysBetween, dayOfIso, SOON_DAYS, limitedShares, isSaturated } from '../src/logic/urgency.mjs';
import { onSaleText } from '../src/logic/describe.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { newState } from '../src/logic/chains.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';
import { emptySaleEvents } from '../src/logic/availability.mjs';

const TODAY = '2026-11-19';
const iso = (y, m, d) => new Date(y, m - 1, d, 12).toISOString(); // local noon: the same local day in every time zone
const step = (extra = {}) => ({ from: 1, to: 2, kind: 'warbond', cash: 500, ...extra });
const ctx = (extra = {}) => ({ avail: { today: TODAY, saleEvents: null }, ...extra });
const event = (to) => ({ events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to }] });
const codes = (c) => c.reasons.map((r) => r.code);

test('days and ISO times are counted in local calendar days', () => {
  assert.equal(daysBetween('2026-11-19', '2026-11-21'), 2);
  assert.equal(daysBetween('2026-11-19', '2026-11-18'), -1);
  assert.equal(dayOfIso(iso(2026, 11, 18)), '2026-11-18');
  assert.equal(dayOfIso('junk'), null);
  assert.equal(dayOfIso(undefined), null);
  assert.equal(SOON_DAYS, 2);
});

test('(a) a limited-time offer is bought today', () => {
  const c = classifyPurchase(step({ limited: true }), ctx());
  assert.equal(c.bucket, 'today');
  assert.deepEqual(codes(c), ['limited']);
});

test('(b) an offer that first appeared today or yesterday during an active sale event is bought today', () => {
  const avail = { today: TODAY, saleEvents: event('2026-12-02') };
  assert.deepEqual(codes(classifyPurchase(step({ firstSeen: iso(2026, 11, 19) }), { avail })), ['new']);
  assert.deepEqual(codes(classifyPurchase(step({ firstSeen: iso(2026, 11, 18) }), { avail })), ['new']);
  const old = classifyPurchase(step({ firstSeen: iso(2026, 11, 17) }), { avail });
  assert.equal(old.bucket, 'norush', 'two days old is not new any more');
  // Without an active event a fresh offer is not urgent by itself.
  assert.equal(classifyPurchase(step({ firstSeen: iso(2026, 11, 19) }), ctx()).bucket, 'norush');
});

test('an old Warbond seen 5 days ago with no event end is on sale with no rush, and says since when', () => {
  const c = classifyPurchase(step({ firstSeen: iso(2026, 11, 14) }), ctx());
  assert.equal(c.bucket, 'norush');
  assert.equal(c.since, '2026-11-14');
  assert.equal(c.until, null);
});

test('(c) a sale event that ends within two days makes its offers urgent; three days is no rush', () => {
  const c = classifyPurchase(step(), { avail: { today: TODAY, saleEvents: event('2026-11-20') } });
  assert.equal(c.bucket, 'today');
  assert.deepEqual(c.reasons, [{ code: 'event-ends', event: { name: 'IAE 2956', to: '2026-11-20' } }]);
  assert.equal(classifyPurchase(step(), { avail: { today: TODAY, saleEvents: event('2026-11-21') } }).bucket, 'today');
  const far = classifyPurchase(step(), { avail: { today: TODAY, saleEvents: event('2026-11-22') } });
  assert.equal(far.bucket, 'norush');
  assert.equal(far.until, '2026-11-22', 'the event end is shown as "sale ends"');
  assert.equal(far.untilBy, 'event');
});

test('(d) a buy-before alert that saves money makes the step urgent; one without savings does not', () => {
  assert.deepEqual(codes(classifyPurchase(step({ kind: 'standard' }), ctx({ alert: { reason: 'pricier', saves: 500 } }))), ['price']);
  assert.deepEqual(codes(classifyPurchase(step({ kind: 'standard' }), ctx({ alert: { reason: 'gone', saves: Infinity } }))), ['price']);
  assert.equal(classifyPurchase(step(), ctx({ alert: { reason: 'pricier' } })).bucket, 'norush');
  assert.equal(classifyPurchase(step(), ctx({ alert: { reason: 'pricier', saves: 0 } })).bucket, 'norush');
});

test('a lock is optional whatever else is true of its offer', () => {
  const c = classifyPurchase(step({ kind: 'standard', limited: true }), { ...ctx(), lock: true });
  assert.equal(c.bucket, 'optional');
  assert.deepEqual(c.reasons, []);
});

test('your note "runs until" a far day makes a limited offer no rush; "ends soon" makes any offer urgent', () => {
  const until = (day) => ({ pairs: { '1-2': { until: day } } });
  const far = classifyPurchase(step({ limited: true }), ctx({ overrides: until('2026-11-29') }));
  assert.equal(far.bucket, 'norush', '10 days ahead overrides the limited-time flag');
  assert.equal(far.until, '2026-11-29');
  assert.equal(far.untilBy, 'note');
  const near = classifyPurchase(step(), ctx({ overrides: until('2026-11-21') }));
  assert.equal(near.bucket, 'today');
  assert.deepEqual(codes(near), ['note-ends']);
  const soon = classifyPurchase(step(), ctx({ overrides: { pairs: { '1-2': { soon: true } } } }));
  assert.equal(soon.bucket, 'today');
  assert.deepEqual(codes(soon), ['note-soon']);
  // The note is per pair.
  assert.equal(classifyPurchase(step({ to: 3, limited: true }), ctx({ overrides: until('2026-11-29') })).bucket, 'today');
  // A note about a day that has passed is ignored.
  assert.equal(offerNote(until('2026-11-18'), 1, 2, TODAY), null);
  assert.equal(classifyPurchase(step({ limited: true }), ctx({ overrides: until('2026-11-18') })).bucket, 'today');
  // The note does not hide a price rise.
  assert.deepEqual(codes(classifyPurchase(step({ kind: 'standard' }), ctx({ overrides: until('2026-11-29'), alert: { reason: 'pricier', saves: 100 } }))), ['price']);
});

test('setOfferEnd and clearOfferEnd keep your note per pair in the overrides document', () => {
  const doc = { plans: newState(), overrides: emptyOverrides(), saleEvents: emptySaleEvents() };
  const a = applyAction(doc, { type: 'setOfferEnd', from: 1, to: 2, until: '2026-12-02' });
  assert.equal(a.changed, 'overrides');
  assert.equal(a.overrides.pairs['1-2'].until, '2026-12-02');
  assert.equal(doc.overrides.pairs, undefined, 'the input document is untouched');
  const b = applyAction({ ...doc, overrides: a.overrides }, { type: 'setOfferEnd', from: 1, to: 2, soon: true });
  assert.deepEqual(Object.keys(b.overrides.pairs['1-2']).sort(), ['setAt', 'soon'], 'a new note replaces the old one');
  const c = applyAction({ ...doc, overrides: b.overrides }, { type: 'clearOfferEnd', from: 1, to: 2 });
  assert.equal(c.changed, 'overrides');
  assert.equal(c.overrides.pairs, undefined);
  assert.throws(() => applyAction(doc, { type: 'setOfferEnd', from: 1, to: 2, until: 'tomorrow' }), /day/);
  assert.throws(() => applyAction(doc, { type: 'setOfferEnd', from: 1, to: 2 }), /day/);
  assert.throws(() => applyAction(doc, { type: 'setOfferEnd', from: 1, to: 9, soon: true }, { ships: new Map([[1, {}], [2, {}]]) }), /unknown ship/);
});

test('when RSI flags nearly every offer as limited, the flag is ignored; a sparse flag still counts', () => {
  assert.equal(classifyPurchase(step({ limited: true }), ctx({ limitedUseful: false })).bucket, 'norush');
  assert.equal(classifyPurchase(step({ limited: true }), ctx({ limitedUseful: true })).bucket, 'today');
});

test('limitedShares is per offer kind, and the boundary is 50 %: 49 of 100 counts, 50 of 100 does not', () => {
  const offers = (kind, flagged, total) => Array.from({ length: total }, (_, i) => ({ kind, limited: i < flagged }));
  assert.deepEqual(limitedShares([]), { warbond: 0, standard: 0 }, 'no offers: nothing to judge');
  assert.deepEqual(limitedShares(null), { warbond: 0, standard: 0 });
  assert.equal(limitedShares(offers('warbond', 1, 1)).warbond, 1, 'one flagged offer is 100 %');
  assert.equal(limitedShares(offers('warbond', 0, 1)).warbond, 0);
  const mixed = [...offers('warbond', 100, 100), ...offers('standard', 10, 100)];
  assert.deepEqual(limitedShares(mixed), { warbond: 1, standard: 0.1 }, 'kinds are counted apart');
  assert.equal(isSaturated(limitedShares(offers('warbond', 49, 100)).warbond), false);
  assert.equal(isSaturated(limitedShares(offers('warbond', 50, 100)).warbond), true);
  assert.equal(isSaturated(0), false);
  assert.equal(isSaturated(1), true);
});

test('buildPlannerData reports the share per kind and where the history begins; the earliest first-seen is kept', async () => {
  const { buildPlannerData } = await import('../src/logic/mapping.mjs');
  const mk = (limitedA, limitedB) => ({
    catalog: { fetchedAt: 'C', ships: [1, 2, 3].map((id) => ({ id, name: `S${id}`, msrp: id * 5000, skus: [] })) },
    details: { details: { 2: { skus: [{ id: 20, title: 'Warbond Edition', limitedTimeOffer: limitedA, items: [] }] }, 3: { skus: [{ id: 30, title: 'Standard Edition', limitedTimeOffer: limitedB, items: [] }] } } },
    upgrades: [{ fromId: 1, fetchedAt: 'F', targets: [{ toId: 2, skus: [{ id: 20, available: true, upgradeUsdCents: 1000 }] }, { toId: 3, skus: [{ id: 30, available: true, upgradeUsdCents: 2000 }] }] }],
    hangar: null, buyback: null,
    history: [
      { at: '2026-11-18T10:00:00.000Z', event: 'appeared', fromId: 1, toId: 2, skuId: 20 },
      { at: '2026-11-19T10:00:00.000Z', event: 'disappeared', fromId: 1, toId: 2, skuId: 20 },
      { at: '2026-11-20T10:00:00.000Z', event: 'appeared', fromId: 1, toId: 2, skuId: 20 },
    ].map((e) => JSON.stringify(e)).join('\n'),
  });
  const d = buildPlannerData(mk(true, false), { items: {} });
  assert.deepEqual(d.meta.limitedShare, { warbond: 1, standard: 0 });
  assert.equal(d.meta.historyFrom, '2026-11-18T10:00:00.000Z');
  assert.equal(d.offers.find((o) => o.skuId === 20).firstSeen, '2026-11-18T10:00:00.000Z', 'a re-listing does not make it new');
  assert.equal(buildPlannerData({ ...mk(true, false), history: '' }, { items: {} }).meta.historyFrom, null);
});

test('routeAdvice trusts the flag per kind; without a session and without a share it trusts nothing', async () => {
  const { createSession } = await import('../src/logic/session.mjs');
  const { routeAdvice } = await import('../src/logic/advice.mjs');
  const { buildGraph } = await import('../src/logic/planner.mjs');
  const route = { steps: [{ from: 1, to: 2, kind: 'warbond', cash: 1000, limited: true }, { from: 2, to: 3, kind: 'standard', cash: 1000, limited: true }], cash: 2000 };
  const flags = (session, env = {}) => routeAdvice(session, { id: 'x', mode: 'finish', target: 3 }, route, env).buys.map((b) => b.reasons.some((r) => r.code === 'limited')); // true = the limited flag counted
  const withShare = (limitedShare) => createSession({ plans: newState(), graph: buildGraph({ offers: [] }), data: { ships: new Map(), offers: [], meta: { limitedShare } } });
  assert.deepEqual(flags(withShare({ warbond: 0.1, standard: 0.1 })), [true, true]);
  assert.deepEqual(flags(withShare({ warbond: 0.5, standard: 0.1 })), [false, true], 'only the saturated kind is ignored');
  assert.deepEqual(flags(withShare({ warbond: 0.82, standard: 0.5 })), [false, false]);
  assert.deepEqual(flags(null), [false, false], 'a null session defaults to ignoring the flag');
  assert.deepEqual(flags(null, { limitedShare: { warbond: 0, standard: 0 } }), [true, true], 'an explicit share is taken');
});

test('(b) is for mid-event drops only: after the event opened, after the history began, at most yesterday', () => {
  const avail = { today: TODAY, saleEvents: { events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-18', to: '2026-12-02' }] } };
  const at = (d) => step({ firstSeen: iso(2026, 11, d) });
  const histBefore = '2026-11-10';
  assert.equal(classifyPurchase(at(18), { avail }).bucket, 'norush', 'first seen on the event\'s first day: the sale opened with it');
  assert.equal(classifyPurchase(at(19), { avail, historyFrom: histBefore }).bucket, 'today', 'a drop after the event began');
  assert.equal(classifyPurchase(at(19), { avail, historyFrom: '2026-11-19' }).bucket, 'norush', 'first seen on the first day of the history: a baseline, not news');
  assert.equal(classifyPurchase(at(19), { avail, historyFrom: '2026-11-18' }).bucket, 'today');
  const later = { today: '2026-11-22', saleEvents: avail.saleEvents };
  assert.equal(classifyPurchase(at(19), { avail: later, historyFrom: histBefore }).bucket, 'norush', 'more than a day ago');
  assert.equal(classifyPurchase(step({ kind: 'standard', firstSeen: iso(2026, 11, 19) }), { avail, historyFrom: histBefore }).bucket, 'norush', 'a Standard upgrade is never a sale drop');
});

test('(b) and (c) and "on sale" are for Warbonds: a Standard step only says it is available', () => {
  const avail = { today: TODAY, saleEvents: event('2026-11-20') };
  const std = classifyPurchase(step({ kind: 'standard', firstSeen: iso(2026, 11, 19) }), { avail });
  assert.equal(std.bucket, 'norush');
  assert.equal(std.since, null);
  assert.equal(std.until, null);
  assert.equal(onSaleText(std), 'Available now, no rush');
  assert.equal(classifyPurchase(step(), { avail }).bucket, 'today');
});

test('a goal in finish mode buys every step now: no deadline needed, and the reason says why', () => {
  const s = step({ kind: 'standard' });
  assert.equal(classifyPurchase(s, { avail: { today: TODAY } }).bucket, 'norush');
  const c = classifyPurchase(s, { avail: { today: TODAY }, finish: true });
  assert.equal(c.bucket, 'today');
  assert.deepEqual(c.reasons, [{ code: 'finish' }]);
  assert.equal(classifyPurchase(s, { avail: { today: TODAY }, finish: true, lock: true }).bucket, 'optional', 'a lock stays a lock');
});

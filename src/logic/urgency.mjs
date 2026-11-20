// How soon a purchase should be made: "buy now", "on sale" (no rush) or "optional". Pure.
//
// Warbonds are sale offers, but most of them stay for weeks. A step is worth buying TODAY when its
// offer may end soon: the SKU is a limited-time offer, it only just appeared during a sale event, the
// sale event ends within SOON_DAYS days, or waiting would cost money (a buy-before alert with `saves`).
// Your own note on an offer ("runs until <day>" or "ends soon", price-overrides.json `pairs`) beats the
// first three signals. A step that only locks a price is optional: a bet, not a deadline.
//
// Offer fields come from the route step itself (the planner copies the offer): `limited` (SKU
// limitedTimeOffer, ship-details.json) and `firstSeen` (ISO time of the earliest "appeared" event in
// offer-history.jsonl).
//
// "On sale", "new during the sale" and "the event ends" describe Warbonds, which are the sale offers. A Standard
// upgrade is always available, so it only says "available now, no rush".

import { localToday, isDay, ongoingEvent } from './availability.mjs';

export const SOON_DAYS = 2;
/**
 * RSI marks every SKU of an event sale as limitedTimeOffer (on 2026-11-19 82 % of all offers and every Warbond), so
 * the flag says nothing about one offer then. A kind (warbond / standard) whose share of flagged offers is at least
 * this is "saturated" and its flag is ignored.
 */
export const LIMITED_SATURATED = 0.5;
/** The share of offers of each kind that carry the limited flag: { warbond, standard } in 0..1 (0 for a kind without offers). */
export function limitedShares(offers) {
  const share = (kind) => {
    const of = (offers ?? []).filter((o) => o.kind === kind);
    return of.length ? of.filter((o) => o.limited === true).length / of.length : 0;
  };
  return { warbond: share('warbond'), standard: share('standard') };
}
/** True when a share of flagged offers is high enough that the flag tells nothing. */
export const isSaturated = (share) => share >= LIMITED_SATURATED;
export const BUCKETS = ['today', 'norush', 'optional'];

const dayNumber = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export const daysBetween = (from, to) => Math.round(dayNumber(to) - dayNumber(from));

/** The local calendar day of an ISO timestamp, or null. */
export function dayOfIso(iso) {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : localToday(d);
}

export const pairKey = (from, to) => `${from}-${to}`;

/**
 * Your note on an offer: { until: 'YYYY-MM-DD' } or { soon: true }. An "until" day that has already
 * passed no longer counts (the note was about an offer that is over).
 */
export function offerNote(overrides, from, to, today) {
  const n = overrides?.pairs?.[pairKey(from, to)];
  if (!n) return null;
  if (n.soon === true) return { soon: true };
  if (isDay(n.until) && n.until >= today) return { until: n.until };
  return null;
}

/**
 * Where a purchase step belongs.
 * @param {object} step planner step (kind, from, to, limited?, firstSeen?)
 * @param {{ avail?: object|null, overrides?: object|null, alert?: object|null, lock?: boolean, limitedUseful?: boolean, historyFrom?: string|null, finish?: boolean }} [ctx]
 *   finish: the goal is in finish mode ("get it as soon as possible"): every purchase it can make now is "buy now", whatever the offer's own deadline.
 *   limitedUseful: false when the limitedTimeOffer flag is on nearly every offer and so tells nothing (see LIMITED_SATURATED); historyFrom: the day the offer history begins (offers first seen then were not new); avail: an availCtx (today, saleEvents); alert: the step's buy-before alert (routeAdvice); lock: the step only locks the target price.
 * @returns {{ bucket: 'today'|'norush'|'optional', reasons: Array<{ code: string, event?: object, until?: string }>, since: string|null, until: string|null, untilBy: 'event'|'note'|null, note: object|null }}
 * reasons codes: 'limited', 'new', 'event-ends', 'price', 'note-soon', 'note-ends', 'finish'. `since` = the day the offer first
 * appeared; `until` = when it is expected to end (your note, else the ongoing sale event's last day).
 */
export function classifyPurchase(step, { avail = null, overrides = null, alert = null, lock = false, limitedUseful = true, historyFrom = null, finish = false } = {}) {
  const today = avail?.today ?? localToday();
  const event = ongoingEvent(avail?.saleEvents, today);
  const note = offerNote(overrides, step.from, step.to, today);
  const since = dayOfIso(step.firstSeen);
  const warbond = step.kind === 'warbond';
  const until = note?.until ?? (warbond ? event?.to : null) ?? null;
  const untilBy = note?.until ? 'note' : warbond && event ? 'event' : null;
  const base = { kind: step.kind, since: warbond ? since : null, until, untilBy, note };
  if (lock) return { bucket: 'optional', reasons: [], ...base };

  const reasons = [];
  if (note?.soon) reasons.push({ code: 'note-soon' });
  else if (note?.until) {
    if (daysBetween(today, note.until) <= SOON_DAYS) reasons.push({ code: 'note-ends', until: note.until });
  } else {
    if (limitedUseful && step.limited === true) reasons.push({ code: 'limited' });
    // Only a mid-event drop is news: not one from the event's first day (the sale opened with it), not one from
    // the first sync (the history just began), and only until yesterday.
    if (warbond && event && since != null && since > event.from && (historyFrom == null || since > historyFrom) && daysBetween(since, today) <= 1) reasons.push({ code: 'new' });
    if (warbond && event && daysBetween(today, event.to) <= SOON_DAYS) reasons.push({ code: 'event-ends', event: { name: event.name, to: event.to } });
  }
  // Waiting would cost money: not something a note about the offer's run can undo.
  if (alert && ['pricier', 'gone'].includes(alert.reason) && alert.saves > 0) reasons.push({ code: 'price' });
  // A goal that should be finished now has nothing to wait for.
  if (finish && !reasons.length) reasons.push({ code: 'finish' });
  return { bucket: reasons.length ? 'today' : 'norush', reasons, ...base };
}

/**
 * Whether a later Standard step with a buy-before alert should be bought today after all: waiting costs
 * money, or it is only known on sale during an event that ends within SOON_DAYS days.
 * @returns {{ code: string, event?: object }|null} the reason, or null
 */
export function promotingAlert(alert, avail = null) {
  if (['pricier', 'gone'].includes(alert.reason) && alert.saves > 0) return { code: 'price' };
  if (alert.reason === 'event' && alert.event) {
    const today = avail?.today ?? localToday();
    if (daysBetween(today, alert.event.to) <= SOON_DAYS) return { code: 'event-ends', event: { name: alert.event.name, to: alert.event.to } };
  }
  return null;
}

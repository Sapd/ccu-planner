// Store observations from Standard SKUs, grouped by local sync day.
// Sale event date ranges are inclusive and label observations on those days.

import { loc, t } from './i18n.mjs';
export const MAX_HISTORY_DAYS = 365;
export const MELT_MIN_CLEAR_DAYS = 2; // sync days clear of every sale event before a melt is suggested

/** 'YYYY-MM-DD' moved by n days. */
const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const AVAILABILITY = ['regular'];

/** The local calendar day of a Date as YYYY-MM-DD. */
export function localToday(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** True for a real calendar date written YYYY-MM-DD. */
export function isDay(s) {
  const m = typeof s === 'string' && DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-27' -> 'Nov 27'. */
export const shortDay = loc('shortDay', (s) => (isDay(s) ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}` : String(s)));
/** A full day for lists ('2026-11-27' in English, '27.11.2026' in German). */
export const dayText = loc('dayText', (s) => String(s));

const eventList = (saleEvents) => (Array.isArray(saleEvents?.events) ? saleEvents.events : []);
const covers = (e, day) => e.from <= day && day <= e.to;

/** The sale event that covers `today`, or null. */
export const ongoingEvent = (saleEvents, today) => eventList(saleEvents).find((e) => covers(e, today)) ?? null;

// Older histories recorded only positive observations, so their known sync days
// are the union of those observations. New histories also record empty syncs.
function syncDays(history) {
  return [...new Set([
    ...Object.keys(history?.syncs ?? {}),
    ...Object.values(history?.ships ?? {}).flatMap((ship) => ship?.onSaleDays ?? []),
  ])].filter(isDay).sort();
}

export const hasSaleSync = (history, matchesDay) => syncDays(history).some(matchesDay);

/** The Standard SKU of a catalog ship is on sale (no title: any SKU that is not a Warbond). */
export const hasStandardSku = (catalogShip) => (catalogShip?.skus ?? []).some((s) => s.available !== false && (s.title ? /standard/i.test(s.title) : true));

/** Observations for one ship. An unobserved last-sync state is null. */
export function availability(shipId, { saleHistory, saleEvents, overrides, days = syncDays(saleHistory) } = {}) {
  const events = eventList(saleEvents);
  const seen = [...new Set(saleHistory?.ships?.[shipId]?.onSaleDays ?? [])].filter(isDay).sort();
  const seenSet = new Set(seen);
  const lastSyncDay = days.at(-1) ?? null;
  const lastSyncAt = saleHistory?.syncs?.[lastSyncDay] ?? null;
  // A ship can be seen earlier on a day and missing at that day's last sync.
  const latestIds = Object.hasOwn(saleHistory?.syncs ?? {}, lastSyncDay) ? saleHistory.lastSyncShipIds : null;
  const inStore = lastSyncDay == null ? null : latestIds ? latestIds.some((id) => String(id) === String(shipId)) : seenSet.has(lastSyncDay);
  let sinceIndex = days.length - 1;
  if (inStore) while (sinceIndex > 0 && seenSet.has(days[sinceIndex - 1])) sinceIndex--;
  const seenOutsideEvents = seen.some((day) => !events.some((e) => covers(e, day)));
  // For melting (irreversible) only: sync days clear of every event by a day on each side, since RSI's banner dates
  // have no time zone. Needs recorded events at all, at least two such days, and the ship in the store at the last sync.
  const clearDays = seen.filter((day) => !events.some((e) => shiftDay(e.from, -1) <= day && day <= shiftDay(e.to, 1))).length;
  const meltSafe = events.length > 0 && inStore === true && clearDays >= MELT_MIN_CLEAR_DAYS;
  return {
    inStore, lastSyncDay, lastSyncAt,
    since: inStore ? days[sinceIndex] : null,
    previousMiss: inStore ? days[sinceIndex - 1] ?? null : null,
    lastSeen: seen.at(-1) ?? null,
    seenDays: seen.length,
    seenOutsideEvents,
    // A label for the observations when a single event covers all of them.
    seenIn: seen.length && !seenOutsideEvents ? events.find((e) => seen.every((day) => covers(e, day))) ?? null : null,
    confirmedOutsideEvents: overrides?.ships?.[shipId]?.availability === 'regular',
    meltSafe,
  };
}

/** The history and event dates may come from different revisions of app state. */
export function availCtx({ data, saleEvents, overrides }, today = localToday()) {
  let saleHistory = data?.saleHistory ?? null;
  let days = syncDays(saleHistory);
  // The catalog also records an observation. Use it if a legacy or interrupted
  // sync wrote the catalog without recording its timestamp in sale history.
  const catalogAt = data?.meta?.catalogAt;
  const catalogTime = Date.parse(catalogAt);
  if (data?.ships && Number.isFinite(catalogTime)) {
    const day = localToday(new Date(catalogTime));
    const latestDay = days.at(-1);
    const recordedAt = saleHistory?.syncs?.[latestDay];
    if ((!latestDay || day >= latestDay) && (!recordedAt || catalogTime > Date.parse(recordedAt))) {
      const shipIds = [...data.ships].filter(([, ship]) => ship.standard).map(([id]) => id);
      saleHistory = appendSaleHistory(saleHistory, shipIds, day, catalogAt);
      days = syncDays(saleHistory);
    }
  }
  return { saleHistory, saleEvents: saleEvents ?? data?.saleEvents ?? null, overrides, today, days };
}

export const shipAvailability = (ctx, shipId) => availability(shipId, ctx ?? undefined);

/** Ids of the catalog ships with a Standard SKU on sale: the set one sync records for today. */
export const onSaleShipIds = (catalogShips) => (catalogShips ?? []).filter(hasStandardSku).map((s) => s.id);

/** Record positive observations for the day and the full set at the latest sync. */
export function appendSaleHistory(history, shipIds, today, at = null) {
  const ships = { ...(history?.ships ?? {}) };
  for (const id of shipIds) {
    const days = new Set(ships[id]?.onSaleDays ?? []);
    days.add(today);
    ships[id] = { ...ships[id], onSaleDays: [...days].sort().slice(-MAX_HISTORY_DAYS) };
  }
  const syncs = { ...history?.syncs, [today]: at };
  const latest = Object.keys(syncs).sort().slice(-MAX_HISTORY_DAYS);
  return {
    ...history, ships,
    syncs: Object.fromEntries(latest.map((day) => [day, syncs[day]])),
    lastSyncShipIds: [...shipIds],
  };
}

// ----- sale events (pure edits; the caller saves the document) -----

export function addSaleEvent(doc, { name, from, to }) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error(t('a sale event needs a name'));
  if (!isDay(from) || !isDay(to)) throw new Error(t('sale event dates must be YYYY-MM-DD'));
  if (from > to) throw new Error(t('a sale event cannot end before it starts'));
  const events = eventList(doc);
  const nextId = events.reduce((m, e) => Math.max(m, Number(String(e.id).replace(/^\D+/, '')) || 0), 0) + 1;
  const event = { id: `e${nextId}`, name: n, from, to };
  return { doc: { ...doc, events: [...events, event] }, event };
}

export function removeSaleEvent(doc, id) {
  const events = eventList(doc);
  if (!events.some((e) => e.id === id)) throw new Error(t('unknown sale event {id}', { id: String(id) }));
  return { ...doc, events: events.filter((e) => e.id !== id) };
}

export const emptySaleEvents = () => ({ rev: 0, events: [] });

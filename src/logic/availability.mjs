// Is a ship's Standard upgrade bought outside sale events too? Pure.
//
// During a sale event (e.g. IAE) many upgrades are buyable only because of it,
// and stock flags do not tell (every on-sale ship has an unlimited-stock
// Standard SKU). So availability is learned from the days a sync saw the ship
// on sale (sale-history.json) against the sale events you maintain
// (sale-events.json), and your own override wins.
//
// Dates are local calendar days 'YYYY-MM-DD'; ranges are inclusive. Callers pass
// `today` in so results are deterministic.

export const REGULAR_MIN_DAYS = 2; // distinct on-sale days outside every event ...
export const REGULAR_MIN_GAP = 7; // ... whose earliest and latest are this many days apart
export const MAX_HISTORY_DAYS = 365;
export const AVAILABILITY = ['regular', 'event-only'];

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
const dayNumber = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-27' -> 'Nov 27'. */
export const shortDay = (s) => (isDay(s) ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}` : String(s));

const eventList = (saleEvents) => (Array.isArray(saleEvents?.events) ? saleEvents.events : []);
const covers = (e, day) => e.from <= day && day <= e.to;

/** The sale event that covers `today`, or null. */
export const ongoingEvent = (saleEvents, today) => eventList(saleEvents).find((e) => covers(e, today)) ?? null;

/** The Standard SKU of a catalog ship is on sale (no title: any SKU that is not a Warbond). */
export const hasStandardSku = (catalogShip) => (catalogShip?.skus ?? []).some((s) => s.available !== false && (s.title ? /standard/i.test(s.title) : true));

/**
 * @param {number|string} shipId
 * @param {{ saleHistory?: object|null, saleEvents?: object|null, overrides?: object|null, today: string, standardNow?: boolean }} ctx
 *   standardNow false = no Standard SKU today (off-sale); leave it out when unknown.
 * @returns {{ status: 'regular'|'event-only'|'unknown'|'off-sale', override: boolean, daysOutside: number, firstSeen: string|null, lastSeen: string|null, event: object|null, sawIn: object|null }}
 */
export function availability(shipId, { saleHistory = null, saleEvents = null, overrides = null, today, standardNow } = {}) {
  const events = eventList(saleEvents);
  const days = [...new Set(saleHistory?.ships?.[shipId]?.onSaleDays ?? [])].filter(isDay).sort();
  const outside = days.filter((d) => !events.some((e) => covers(e, d)));
  const base = {
    daysOutside: outside.length, firstSeen: days[0] ?? null, lastSeen: days.at(-1) ?? null,
    event: ongoingEvent(saleEvents, today),
    sawIn: events.find((e) => days.length && covers(e, days.at(-1))) ?? null, // the event of the latest sale day
  };
  const ov = overrides?.ships?.[shipId]?.availability;
  if (AVAILABILITY.includes(ov)) return { ...base, status: ov, override: true };
  if (standardNow === false) return { ...base, status: 'off-sale', override: false };
  if (outside.length >= REGULAR_MIN_DAYS && dayNumber(outside.at(-1)) - dayNumber(outside[0]) >= REGULAR_MIN_GAP) return { ...base, status: 'regular', override: false };
  // Only ever seen on event days, and one of those events is over: it did not stay on sale.
  if (days.length && !outside.length && events.some((e) => e.to < today && days.some((d) => covers(e, d)))) return { ...base, status: 'event-only', override: false };
  return { ...base, status: 'unknown', override: false };
}

/**
 * The inputs availability() needs, from an app/CLI state: sale history lives in
 * the data, the events document and overrides may be newer than that data.
 */
export function availCtx({ data, saleEvents, overrides }, today = localToday()) {
  return { saleHistory: data?.saleHistory ?? null, saleEvents: saleEvents ?? data?.saleEvents ?? null, overrides: overrides ?? null, today, ships: data?.ships ?? null };
}

/** availability() for a ship id through an availCtx (adds standardNow from the ships map). With no ctx the ship is unknown. */
export function shipAvailability(ctx, shipId) {
  if (!ctx) return { status: 'unknown', override: false, daysOutside: 0, firstSeen: null, lastSeen: null, event: null };
  const ship = ctx.ships?.get(shipId);
  return availability(shipId, { ...ctx, standardNow: ship ? ship.standard : undefined });
}

/** Ids of the catalog ships with a Standard SKU on sale: the set one sync records for today. */
export const onSaleShipIds = (catalogShips) => (catalogShips ?? []).filter(hasStandardSku).map((s) => s.id);

/** Sale history with today's date added for every ship id in `shipIds`; at most MAX_HISTORY_DAYS newest days per ship. */
export function appendSaleHistory(history, shipIds, today) {
  const ships = { ...(history?.ships ?? {}) };
  for (const id of shipIds) {
    const days = new Set(ships[id]?.onSaleDays ?? []);
    days.add(today);
    ships[id] = { ...ships[id], onSaleDays: [...days].sort().slice(-MAX_HISTORY_DAYS) };
  }
  return { ...history, ships };
}

// ----- sale events (pure edits; the caller saves the document) -----

export function addSaleEvent(doc, { name, from, to }) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('a sale event needs a name');
  if (!isDay(from) || !isDay(to)) throw new Error('sale event dates must be YYYY-MM-DD');
  if (from > to) throw new Error('a sale event cannot end before it starts');
  const events = eventList(doc);
  const nextId = events.reduce((m, e) => Math.max(m, Number(String(e.id).replace(/^\D+/, '')) || 0), 0) + 1;
  const event = { id: `e${nextId}`, name: n, from, to };
  return { doc: { ...doc, events: [...events, event] }, event };
}

export function removeSaleEvent(doc, id) {
  const events = eventList(doc);
  if (!events.some((e) => e.id === id)) throw new Error(`unknown sale event ${id}`);
  return { ...doc, events: events.filter((e) => e.id !== id) };
}

export const emptySaleEvents = () => ({ rev: 0, events: [] });

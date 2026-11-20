// Pure: raw files -> everything the UI reads. No I/O.
import { buildPlannerData } from '../../../../src/logic/mapping.mjs';
import { buildGraph } from '../../../../src/logic/planner.mjs';
import { newState } from '../../../../src/logic/chains.mjs';
import { emptyOverrides, expectedOffers } from '../../../../src/logic/prices.mjs';
import { emptySaleEvents } from '../../../../src/logic/availability.mjs';
import { setPricing } from '../../../../src/logic/format.mjs';
import { createSession } from '../../../../src/logic/session.mjs';
import { mergeSaleEvents, userSaleEvents, feedEventsOf } from '../../../../src/logic/feed.mjs';

/** @returns {null | { data, graph, plans, overrides, saleEvents, expected }} null when there is no data yet */
/** `applyPricing: false` leaves the money formatter alone (the sync's snapshot step must not change what is shown). */
export function deriveAppState(raw, aliases, { applyPricing = true, feed = undefined } = {}) {
  if (!raw) return null;
  const data = buildPlannerData(raw, aliases);
  if (applyPricing) setPricing(data.pricing);
  const graph = buildGraph(data);
  return withDocs({ data, graph }, raw.plans ?? newState(), raw.overrides ?? emptyOverrides(), raw.saleEvents ?? emptySaleEvents(), feed);
}

/**
 * The same derived state with new plans/overrides/sale-events documents; the data and graph are reused, the planning session is new.
 * `saleEvents` is your own document (sale-events.json) or a merged one; `app.saleEvents` is always the merge of yours and the feed's
 * (feed events tagged source 'feed'), and userSaleEvents(app.saleEvents) is what may be saved. `feed` = { events, at } sets the feed's
 * part; left out, it is taken from the tagged events of `saleEvents` (a job worker gets a merged document) or kept from `app`.
 */
export function withDocs(app, plans, overrides, saleEvents = userSaleEvents(app.saleEvents ?? emptySaleEvents()), feed = undefined) {
  const o = { ...overrides, rev: overrides.rev ?? 0, ships: overrides.ships ?? {} };
  const given = feed ?? (saleEvents?.feedAt || feedEventsOf(saleEvents).length ? { events: feedEventsOf(saleEvents), at: saleEvents.feedAt ?? null } : null);
  const f = given ?? { events: app.feedEvents ?? [], at: app.feedAt ?? null };
  const ev = mergeSaleEvents({ ...saleEvents, rev: saleEvents.rev ?? 0, events: saleEvents.events ?? [] }, f.events, f.at);
  // The expected offers only depend on the price overrides: keep the same array while they are unchanged, so
  // caches keyed on it (the waiting penalty) survive edits of plans or sale events.
  const same = app.overrides && app.expected && JSON.stringify(app.overrides.ships) === JSON.stringify(o.ships);
  const next = {
    data: app.data, graph: app.graph, plans, overrides: o, saleEvents: ev, feedEvents: f.events, feedAt: f.at,
    expected: same ? app.expected : expectedOffers(app.data.offers, app.data.ships, o),
  };
  // One planning session per set of documents: everything derived from them is computed once and dropped with them.
  next.session = createSession(next);
  return next;
}

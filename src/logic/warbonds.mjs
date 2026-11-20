// Warbond offers on sale now, grouped by target ship. Pure: no file or network access.
// Shared by the Warbonds tab and `chain warbonds`. No predictions: only offers and events on record.
//
// Offers: { from, to, kind: 'standard'|'warbond', cash, skuId, title, fetchedAt, limited, firstSeen } (USD cents).
// History events (offer-history.jsonl): { at, event: 'appeared'|'disappeared', fromId, toId, skuId, cash }.

import { shipName, norm } from './ships.mjs';
import { matchesQuery, searchText } from './search.mjs';
import { parseHistory } from './mapping.mjs';

const HOUR = 3600e3;

export { parseHistory };

/** Events within the last `hours` (inclusive of the boundary). */
export function eventsSince(history, hours = 24, now = Date.now()) {
  const since = now - hours * HOUR;
  return (history ?? []).filter((e) => Date.parse(e.at) >= since);
}

const kindBySku = (offers) => new Map(offers.map((o) => [o.skuId, o.kind]));

/** Warbond offers that appeared and offers (any kind) that disappeared within `hours`. */
export function recentWarbondEvents(history, offers, hours = 24, now = Date.now()) {
  const events = eventsSince(history, hours, now);
  const kindOf = kindBySku(offers);
  return {
    appeared: events.filter((e) => e.event === 'appeared' && kindOf.get(e.skuId) === 'warbond'),
    disappeared: events.filter((e) => e.event === 'disappeared'),
  };
}

/** "from-to" -> chain ids whose best route (the session's shared plan) uses that Warbond step. */
export function warbondUsage(session) {
  const usedBy = new Map();
  for (const c of Object.values(session.plans.chains)) {
    const best = session.route(c.id);
    for (const s of best?.steps ?? []) {
      if (s.kind !== 'warbond' || s.virtual) continue;
      const key = `${s.from}-${s.to}`;
      usedBy.set(key, [...(usedBy.get(key) ?? []), c.id]);
    }
  }
  return usedBy;
}

/**
 * Ship ids that are in your hangar as a ship: pledges with a matched ship (ship and package pledges, like the Hangar's
 * ship gallery). An upgrade you own does not count here; see upgradeIntoIds.
 */
export function hangarShipIds(data) {
  const ids = new Set();
  for (const p of data.pledges ?? []) {
    if (p.category != null && p.category !== 'ship' && p.category !== 'package') continue;
    for (const s of p.ships ?? []) if (s.shipId != null) ids.add(s.shipId);
  }
  return ids;
}

/** Ship ids you own an upgrade into: the targets of your CCU copies. Owning one does not give you the ship itself. */
export function upgradeIntoIds(data) {
  const ids = new Set();
  for (const c of data.owned ?? []) if (c.to != null) ids.add(c.to);
  return ids;
}

/** Source scopes of the Store filter: every source, ships in the hangar, or ships you own an upgrade into. */
export const SOURCE_SCOPES = ['all', 'hangar', 'upgrade'];

/** What your own data says about a source ship: 'ship' (in the hangar), 'upgrade' (only an upgrade into it) or null. */
export function ownershipOf(from, { hangar = new Set(), upgradeInto = new Set() } = {}) {
  return hangar.has(from) ? 'ship' : upgradeInto.has(from) ? 'upgrade' : null;
}

/**
 * The offers with the Warbond offers whose source ship is outside the scope removed. Standard offers stay: they are the
 * price a Warbond is compared with. Scope 'hangar' keeps sources that are ships in the hangar, 'upgrade' those you own
 * an upgrade into (also when the ship itself is in the hangar); 'all' changes nothing.
 */
export function scopeOffers(offers, scope, own = {}) {
  if (scope === 'hangar') return offers.filter((o) => o.kind !== 'warbond' || (own.hangar ?? new Set()).has(o.from));
  if (scope === 'upgrade') return offers.filter((o) => o.kind !== 'warbond' || (own.upgradeInto ?? new Set()).has(o.from));
  return offers;
}

const cheapestStandard = (offers, from, to) => {
  let best = null;
  for (const o of offers) if (o.kind === 'standard' && o.from === from && o.to === to && (best == null || o.cash < best)) best = o.cash;
  return best;
};

/**
 * Every Warbond offer into `to`, cheapest first, with the Standard price of the same step. `ownership` is what your data
 * says about the source ship (ownershipOf); `usedBy` the goals whose best route uses this exact step (warbondUsage).
 */
export function warbondSources(offers, ships, to, { hangar = new Set(), upgradeInto = new Set(), usage = new Map() } = {}) {
  const std = new Map();
  for (const o of offers) if (o.to === to && o.kind === 'standard' && (!std.has(o.from) || o.cash < std.get(o.from))) std.set(o.from, o.cash);
  return offers
    .filter((o) => o.kind === 'warbond' && o.to === to)
    .map((o) => {
      const standard = std.get(o.from) ?? null;
      return { from: o.from, fromName: shipName(ships, o.from), cash: o.cash, standard, saving: standard == null ? null : standard - o.cash, limited: o.limited === true, ownership: ownershipOf(o.from, { hangar, upgradeInto }), usedBy: usage.get(`${o.from}-${to}`) ?? [] };
    })
    .sort((a, b) => a.cash - b.cash || a.from - b.from);
}

/** One entry per ship that has a Warbond offer into it; your chains' targets first, then the biggest saving, then name. */
export function warbondTargets(offers, ships, { session = null, history = [], now = Date.now(), hours = 24, usage = null } = {}) {
  const used = usage ?? (session ? warbondUsage(session) : new Map());
  const kindOf = kindBySku(offers);
  const chains = Object.values(session?.plans.chains ?? {});
  const recent = eventsSince(history, hours, now).filter((e) => e.event === 'appeared' && kindOf.get(e.skuId) === 'warbond');
  const byTarget = new Map();
  for (const o of offers) if (o.kind === 'warbond') byTarget.set(o.to, [...(byTarget.get(o.to) ?? []), o]);

  const rows = [];
  for (const [to, list] of byTarget) {
    const best = list.reduce((a, b) => (b.cash < a.cash || (b.cash === a.cash && b.from < a.from) ? b : a));
    const standard = cheapestStandard(offers, best.from, to);
    const ship = ships.get(to);
    const usedBy = [...new Set([...used].filter(([k]) => Number(k.split('-')[1]) === to).flatMap(([, ids]) => ids))];
    const newest = recent.filter((e) => e.toId === to).map((e) => e.at).sort().pop() ?? null;
    rows.push({
      to, name: shipName(ships, to), msrp: ship?.msrp ?? null, concept: !!ship?.concept,
      sources: list.length,
      cheapest: { from: best.from, cash: best.cash, standard, saving: standard == null ? null : standard - best.cash },
      limited: list.some((o) => o.limited === true),
      newSince: newest,
      usedBy,
      targetOf: chains.filter((c) => c.target === to).map((c) => c.id),
    });
  }
  return rows.sort((a, b) =>
    (b.targetOf.length > 0) - (a.targetOf.length > 0)
    || (a.cheapest.saving == null) - (b.cheapest.saving == null)
    || (b.cheapest.saving ?? 0) - (a.cheapest.saving ?? 0)
    || a.name.localeCompare(b.name));
}

/** Targets whose own ship plus Warbond source ships (name, manufacturer) contain every word of the query. */
export function filterWarbondTargets(targets, ships, offers, text) {
  if (!norm(text)) return targets;
  const label = (id) => { const s = ships.get(id); return searchText(s?.name, s?.manufacturer?.name ?? s?.manufacturer); };
  return targets.filter((t) => matchesQuery(searchText(label(t.to), offers.filter((o) => o.kind === 'warbond' && o.to === t.to).map((o) => label(o.from))), text));
}

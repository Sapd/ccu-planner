// Hangar, Melt and Prices tab helpers. Pure.
import { reservations } from '../../../../src/logic/chains.mjs';
import { excludedCopies } from '../../../../src/logic/goals.mjs';
import { shipName, goalNamer } from '../../../../src/logic/ships.mjs';
import { matchesQuery, searchText } from '../../../../src/logic/search.mjs';
import { parseSlackUsd } from '../../../../src/logic/wantedView.mjs';
import { meltPlan, classifyCopies } from '../../../../src/logic/melt.mjs';
import { hangarSummary, isUsd } from '../../../../src/logic/hangar.mjs';
import { usd } from '../../../../src/logic/format.mjs';
import { hasPriceOverrides, pricedShips } from '../../../../src/logic/prices.mjs';
import { shipAvailability, localToday, ongoingEvent } from '../../../../src/logic/availability.mjs';
import { sessionOf } from '../../../../src/logic/session.mjs';
import { N_ } from '../../../../src/logic/i18n.mjs';

/** One row per owned CCU copy. `review` items stay as they are. */
export function hangarRows(data, plans) {
  const reserved = reservations(plans);
  const excluded = excludedCopies(plans);
  const goalName = goalNamer(plans, data.ships);
  return {
    rows: data.owned.map((c) => ({
      copyId: c.copyId, from: c.from, to: c.to,
      fromName: shipName(data.ships, c.from), toName: shipName(data.ships, c.to),
      paid: c.paid?.cents ?? null, giftable: !!c.giftable, meltable: !!c.meltable,
      reservedBy: reserved.get(c.copyId) ?? null,
      reservedByName: reserved.has(c.copyId) ? goalName(reserved.get(c.copyId)) : null,
      matchMethod: c.matchMethod, extras: c.extras ?? [], edition: c.edition ?? null,
      excluded: excluded.has(String(c.copyId)),
    })),
    review: data.review ?? [],
  };
}

/** Items with collision-safe keys: the id when present and first seen, else the id (or "item") plus the index. */
export function keyed(list, idOf) {
  const seen = new Set();
  return list.map((item, i) => {
    const id = idOf(item);
    let key = id == null || id === '' ? null : String(id);
    if (key == null || seen.has(key)) key = `${key ?? 'item'}#${i}`;
    seen.add(key);
    return { item, key };
  });
}

/** Buy-back entries still on RSI, newest first seen first. */
export function buybackRows(data) {
  return (data.buyback ?? [])
    .filter((e) => !e.goneSince && e.data)
    .map((e) => ({ id: e.data.buybackPledgeId ?? null, name: e.data.name, reclaimDate: e.data.reclaimDate ?? null, contained: e.data.contained ?? null, firstSeen: e.firstSeen ?? null, link: e.data.buyBackLink ?? null }))
    .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)));
}

/** Melt candidates largest first, as chart bars. */
export function candidateBars(candidates, ships) {
  return [...candidates]
    .sort((a, b) => b.paid - a.paid || String(a.copy.copyId).localeCompare(String(b.copy.copyId)))
    .map((c) => ({ copyId: c.copy.copyId, label: `${shipName(ships, c.copy.from)} → ${shipName(ships, c.copy.to)}`, paid: c.paid }));
}

/** A price typed in dollars -> whole cents above zero, or null. */
export function parsePriceUsd(text) {
  const c = parseSlackUsd(text);
  return c != null && c > 0 ? c : null;
}

/** Expected-price rows: today vs expected, and how many Standard offers change. */
export function priceRows(data, overrides, expected) {
  return pricedShips(overrides).map((id) => {
    const o = overrides.ships[id];
    return {
      shipId: id, name: shipName(data.ships, id), today: data.ships.get(id)?.msrp ?? null, override: o,
      affected: expected.filter((e) => e.assumed && (e.from === id || e.to === id)).length,
    };
  });
}

/** Concept ships, with their msrp and whether RSI sells them now. */
export function conceptShips(ships) {
  return [...ships.values()].filter((s) => s.concept).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: s.id, name: s.name, msrp: s.msrp, onSale: !!s.onSale }));
}

function computeMeltView(app, today = localToday()) {
  const hasOverrides = hasPriceOverrides(app.overrides);
  const expected = hasOverrides ? app.expected : null;
  const protect = new Set();
  const session = sessionOf(app);
  const avail = session.avail(today);
  const plan = meltPlan(app.data, app.plans, { protect, expected, overrides: app.overrides, avail, session });
  const without = hasOverrides ? meltPlan(app.data, app.plans, { protect, avail, session }).candidates.length - plan.candidates.length : 0;
  const kept = classifyCopies(app.data, app.plans, { protect, expected, avail }).filter((c) => !c.candidate);
  // An event is on and some copies wait only for sale history: the suggestions are still conservative.
  const event = ongoingEvent(avail.saleEvents, today);
  const hintEvent = event && kept.some((c) => c.availability === 'unknown') ? event : null;
  return { plan, without, kept, hasOverrides, hintEvent };
}

/** Melt plan, extra candidate count and kept copies, cached in the app's planning session per local day. */
export function meltView(app, { compute = computeMeltView, today = localToday() } = {}) {
  return sessionOf(app).memo('melt', today, () => compute(app, today));
}

/** Prices-tab availability rows: every ship with a Standard SKU today (and any you marked), by name. */
export function availabilityRows(app, today = localToday()) {
  const ctx = sessionOf(app).avail(today);
  const marked = (id) => ['regular', 'event-only'].includes(app.overrides.ships[id]?.availability);
  return [...app.data.ships.values()]
    .filter((s) => s.standard || marked(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ shipId: s.id, name: s.name, ...shipAvailability(ctx, s.id), mark: app.overrides.ships[s.id]?.availability ?? 'auto' }));
}

/** Category chips of the Hangar tab. `cats` are the pledge categories each chip covers (null = all). */
export const PLEDGE_CHIPS = [
  { id: 'ships', label: N_('Ships and packages'), cats: ['ship', 'package'] },
  { id: 'ccu', label: N_('CCUs'), cats: ['ccu'] },
  { id: 'others', label: N_('All other pledges'), cats: ['paint', 'equipment', 'other'] },
  { id: 'paint', label: N_('Paints'), cats: ['paint'] },
  { id: 'equipment', label: N_('Equipment'), cats: ['equipment'] },
  { id: 'other', label: N_('Other'), cats: ['other'] },
  { id: 'all', label: N_('All'), cats: null },
];

/** The three views of the Hangar, as the switch at the top shows them. */
export const HANGAR_VIEWS = [
  { id: 'ships', label: N_('Ships') },
  { id: 'ccu', label: N_('Upgrades') },
  { id: 'other', label: N_('Other pledges') },
];
/** How a pledge category is named (shown through t()). */
export const PLEDGE_CATEGORY = { ship: N_('ship'), package: N_('package'), ccu: N_('ccu'), paint: N_('paint'), equipment: N_('equipment'), other: N_('other') };

/** Summary strip numbers plus a pledge count per chip id. */
export function pledgeOverview(pledges) {
  const summary = hangarSummary(pledges);
  const chips = Object.fromEntries(PLEDGE_CHIPS.map((c) => [c.id, c.cats ? c.cats.reduce((n, k) => n + (summary.byCategory[k] ?? 0), 0) : summary.count]));
  return { summary, chips };
}

/** What a pledge row is searched by: its name, ship manufacturers and item titles. */
export const pledgeSearchText = (p) => searchText(p.name, p.ships.map((s) => s.manufacturer), p.items.map((it) => it.title));

/** Pledges of a chip whose name, manufacturers and item titles contain every word of the query. */
export function filterPledges(pledges, chipId, query = '') {
  const cats = PLEDGE_CHIPS.find((c) => c.id === chipId)?.cats ?? null;
  return pledges.filter((p) => (!cats || cats.includes(p.category)) && matchesQuery(pledgeSearchText(p), query));
}

/** Pledge for a row id (pledge id or CCU copy id), or null. */
export const pledgeById = (pledges, id) => pledges.find((p) => String(p.pledgeId) === String(id)) ?? null;

/** USD (or unknown currency) as dollars; others as "EUR 5.00" (2-decimal currencies) or "500 (XYZ cents)". */
export function valueLabel(value) {
  if (!value || value.cents == null) return '?';
  if (isUsd(value)) return usd(value.cents);
  const code = String(value.currency ?? '').trim();
  return /^[A-Z]{3}$/.test(code) ? `${code} ${(value.cents / 100).toFixed(2)}` : `${value.cents} (${code} cents)`;
}

/** Availability rows split in two: ships with a verdict (or one you set), and ships the sync has not seen often enough yet. */
export function splitAvailability(rows) {
  const unknown = rows.filter((r) => r.status === 'unknown' && r.mark === 'auto');
  return { known: rows.filter((r) => !unknown.includes(r)), unknown };
}

/** "1 upgrade" / "2 upgrades". */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

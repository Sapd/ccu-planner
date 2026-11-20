// The Hangar's Upgrades view: one table row per From → To pair of identical copies. Pure.
// Only what the planner has: ship prices from the catalog (today's list prices) and what you paid. A missing price stays missing.
import { matchesQuery, searchText } from '../../../../src/logic/search.mjs';
import { applyFilters } from './filters.mjs';

/**
 * Hangar rows with the numbers beside them: fromValue and toValue (today's ship prices), value (what the same upgrade costs today
 * as a Standard offer; `standard` is the Map of standardPrices(); without an offer the difference of the two ship prices, and
 * `estimate` is then true), saving (value minus paid; one definition with Worth melting and the Store), pct (saving as a percent
 * of value, whole numbers), warbond (RSI's own "Warbond Edition" flag, copy.edition) and the target's stage. A number is null
 * whenever one of its inputs is unknown.
 */
export function ccuRows(rows, ships, standard = new Map()) {
  return rows.map((r) => {
    const a = ships.get(r.from)?.msrp ?? null;
    const b = ships.get(r.to)?.msrp ?? null;
    const offer = standard.get(`${r.from}-${r.to}`) ?? null;
    const value = offer ?? (a != null && b != null ? b - a : null);
    const estimate = offer == null && value != null;
    const saving = value != null && r.paid != null ? value - r.paid : null;
    const to = ships.get(r.to);
    return {
      ...r, fromValue: a, toValue: b, value, estimate, saving,
      pct: saving != null && value > 0 ? Math.round((saving / value) * 100) : null,
      warbond: r.edition === 'Warbond',
      stage: to ? (to.concept ? 'concept' : 'flight') : null,
    };
  });
}

/**
 * Identical copies as one row with a count: same ships, price, flags and extras (a reservation does not split a group, so a row
 * can say "1 of 3 reserved"). `members` lists every copy; copyId is the first one's. reservedBy/reservedByName are set only when
 * every reserved copy belongs to one goal and none is free; `goals` lists each goal with its copy count.
 */
export function groupCcuPairs(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify([r.from, r.to, r.paid, r.edition, r.giftable, r.meltable, r.extras]);
    const g = groups.get(key);
    if (g) { g.members.push(r); } else groups.set(key, { ...r, members: [r] });
  }
  return [...groups.values()].map((g) => {
    const goals = [];
    for (const m of g.members) {
      if (!m.reservedBy) continue;
      const e = goals.find((x) => x.id === m.reservedBy);
      if (e) e.count++; else goals.push({ id: m.reservedBy, name: m.reservedByName, count: 1 });
    }
    const reservedCount = goals.reduce((n, x) => n + x.count, 0);
    const whole = reservedCount === g.members.length && goals.length === 1;
    return {
      ...g, count: g.members.length, copyIds: g.members.map((m) => m.copyId), goals, reservedCount,
      excludedCount: g.members.filter((m) => m.excluded).length,
      reservedBy: whole ? goals[0].id : null, reservedByName: whole ? goals[0].name : null,
    };
  });
}

/**
 * The filter groups of the Upgrades view. "Not reserved" means no goal holds the copy; "Not in use" is stricter: no goal holds it and
 * no goal's current (proposed) chain uses it either (rows marked by hangarSummary.markInUse). "Needs review" lists unmatched pledges; it matches no copy. */
export const CCU_GROUPS = [
  { id: 'use', label: 'Use', options: [
    { id: 'reserved', label: 'Reserved', test: (r) => !!r.reservedBy },
    { id: 'free', label: 'Not reserved', test: (r) => !r.reservedBy },
    { id: 'unused', label: 'Not in use', test: (r) => r.inUse === undefined ? !r.reservedBy : !r.inUse },
    { id: 'review', label: 'Needs review', test: () => false },
  ] },
  { id: 'saving', label: 'Saving', options: [
    { id: 'saving', label: 'Saving', test: (r) => r.saving != null && r.saving > 0 },
    { id: 'none', label: 'No saving', test: (r) => r.saving === 0 },
    { id: 'negative', label: 'Negative value', test: (r) => r.saving != null && r.saving < 0 },
  ] },
  { id: 'warbond', label: 'Warbond', options: [{ id: 'warbond', label: 'Warbond edition', test: (r) => r.warbond }] },
  { id: 'gift', label: 'Giftable', options: [{ id: 'gift', label: 'Giftable', test: (r) => r.giftable }] },
  { id: 'melt', label: 'Meltable', options: [
    { id: 'melt', label: 'Meltable', test: (r) => r.meltable },
    { id: 'nomelt', label: 'Not meltable', test: (r) => !r.meltable },
  ] },
  { id: 'stage', label: 'Stage of target', options: [
    { id: 'flight', label: 'Flight ready', test: (r) => r.stage === 'flight' },
    { id: 'concept', label: 'Concept', test: (r) => r.stage === 'concept' },
  ] },
  { id: 'range', label: 'Upgrade value', kind: 'range', value: (r) => r.value },
];

/**
 * Everything the Upgrades view shows: the copies that pass search and filters (grouped), the review items when "Needs review" is
 * ticked, and the counts. Ticking only "Needs review" hides the copies. `total` counts every copy, and the review items while "Needs review" is ticked.
 */
export function ccuResult(rows, review, sel, query = '') {
  const text = (r) => searchText(r.fromName, r.toName);
  const searched = rows.filter((r) => matchesQuery(text(r), query));
  const use = sel.use ?? [];
  const onlyReview = use.length > 0 && use.every((u) => u === 'review');
  const copies = onlyReview ? [] : applyFilters(searched, CCU_GROUPS, { ...sel, use: use.filter((u) => u !== 'review') });
  const showReview = use.includes('review');
  const reviewShown = showReview ? review.filter((r) => matchesQuery(searchText(r.name, r.reason), query)) : [];
  return { copies, groups: groupCcuPairs(copies), review: reviewShown, showReview, shown: copies.length + reviewShown.length, total: rows.length + (showReview ? review.length : 0) };
}

/** Sort keys of the table and their natural first direction: names A to Z, numbers largest first. */
export const CCU_SORT_FIRST = { from: 'asc', to: 'asc', x: 'desc', reserved: 'desc', fromValue: 'desc', toValue: 'desc', value: 'desc', paid: 'desc', saving: 'desc', pct: 'desc' };

/** The value a row is sorted by for a column key. */
export function ccuSortValue(g, key) {
  switch (key) {
    case 'from': return g.fromName;
    case 'to': return g.toName;
    case 'x': return g.count;
    case 'reserved': return g.reservedCount;
    default: return g[key] ?? null;
  }
}

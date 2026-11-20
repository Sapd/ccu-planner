// A small filter engine for the Hangar's filter column. Pure.
// A group is { id, label, strict?, defaults?, options: [{ id, label, offLabel?, test(item) }] } or, for a range,
// { id, label, kind: 'range', value(item) -> cents|null }. A group may have appliesTo(item): it then restricts and counts only those items (the others pass).
// Inside a group the ticked options are alternatives (OR); groups combine (AND). An empty group does not restrict, unless it is `strict`
// (then nothing ticked shows nothing). `defaults` are the options ticked from the start; a chip is shown only for what differs from them.

/** The ticked options of every group at the start (a range group is two empty fields). */
export const emptySel = (groups) => Object.fromEntries(groups.map((g) => [g.id, g.kind === 'range' ? { min: '', max: '' } : [...(g.defaults ?? [])]]));

/** The stored selection, or a fresh one when it is missing or does not fit the groups (an older session). */
export function selOf(stored, groups) {
  const fresh = emptySel(groups);
  if (!stored) return fresh;
  return Object.fromEntries(groups.map((g) => [g.id, g.kind === 'range'
    ? { min: String(stored[g.id]?.min ?? ''), max: String(stored[g.id]?.max ?? '') }
    : (Array.isArray(stored[g.id]) ? stored[g.id].filter((id) => g.options.some((o) => o.id === id)) : fresh[g.id])]));
}

const dollars = (text) => {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const rangeOf = (sel) => ({ min: dollars(sel?.min), max: dollars(sel?.max) });
const rangeActive = (sel) => { const r = rangeOf(sel); return r.min != null || r.max != null; };

function groupPasses(item, g, sel) {
  if (g.appliesTo && !g.appliesTo(item)) return true;
  if (g.kind === 'range') {
    const r = rangeOf(sel[g.id]);
    if (r.min == null && r.max == null) return true;
    const v = g.value(item);
    return v != null && (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
  }
  const ticked = sel[g.id] ?? [];
  if (!ticked.length) return !g.strict;
  return g.options.some((o) => ticked.includes(o.id) && o.test(item));
}

/** The items that pass every group. */
export function applyFilters(items, groups, sel) {
  return items.filter((it) => groups.every((g) => groupPasses(it, g, sel)));
}

/** How many items each option shows: the items that pass every OTHER group and the option itself. { groupId: { optionId: n } } */
export function optionCounts(items, groups, sel) {
  const out = {};
  for (const g of groups) {
    if (g.kind === 'range') continue;
    const others = items.filter((it) => groups.every((o) => o === g || groupPasses(it, o, sel)));
    const counted = g.appliesTo ? others.filter(g.appliesTo) : others;
    out[g.id] = Object.fromEntries(g.options.map((o) => [o.id, counted.filter((it) => o.test(it)).length]));
  }
  return out;
}

/** The selection with one option switched on or off. */
export function toggleOption(sel, groupId, optionId) {
  const cur = sel[groupId] ?? [];
  return { ...sel, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
}

/** A range field changed. */
export const setRange = (sel, groupId, key, value) => ({ ...sel, [groupId]: { ...sel[groupId], [key]: value } });

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const groupIsDefault = (g, sel) => (g.kind === 'range' ? !rangeActive(sel[g.id]) : sameSet(sel[g.id] ?? [], g.defaults ?? []));

/** Does this group differ from its start state (it shows "(reset)")? */
export const groupActive = (groups, sel, groupId) => { const g = groups.find((x) => x.id === groupId); return !!g && !groupIsDefault(g, sel); };

/** The group back at its start state. */
export function resetGroup(groups, sel, groupId) {
  const g = groups.find((x) => x.id === groupId);
  return g ? { ...sel, [groupId]: emptySel([g])[groupId] } : sel;
}
export const resetAll = (groups) => emptySel(groups);

const money = (c) => (c == null ? '' : `$${c % 100 === 0 ? c / 100 : (c / 100).toFixed(2)}`);

/**
 * What differs from the start state, one removable chip each: a ticked option, an option of a default-on group that was unticked
 * ("No goal ships"), or a range. Entry: { id, groupId, optionId|null, kind: 'on'|'off'|'range', label }.
 */
export function activeFilters(groups, sel) {
  const out = [];
  for (const g of groups) {
    if (g.kind === 'range') {
      const r = rangeOf(sel[g.id]);
      if (r.min == null && r.max == null) continue;
      const text = r.min != null && r.max != null ? `${money(r.min)} to ${money(r.max)}` : r.min != null ? `${money(r.min)} or more` : `up to ${money(r.max)}`;
      out.push({ id: `${g.id}:range`, groupId: g.id, optionId: null, kind: 'range', label: `${g.label} ${text}` });
      continue;
    }
    const ticked = sel[g.id] ?? [];
    const defaults = g.defaults ?? [];
    for (const o of g.options) {
      if (ticked.includes(o.id) && !defaults.includes(o.id)) out.push({ id: `${g.id}:${o.id}`, groupId: g.id, optionId: o.id, kind: 'on', label: o.label });
      else if (!ticked.includes(o.id) && defaults.includes(o.id)) out.push({ id: `${g.id}:${o.id}`, groupId: g.id, optionId: o.id, kind: 'off', label: o.offLabel ?? `Not ${o.label.toLowerCase()}` });
    }
  }
  return out;
}

/** Takes one chip away: the option goes back to its start state, a range is emptied. */
export function removeFilter(groups, sel, entry) {
  return entry.kind === 'range' ? resetGroup(groups, sel, entry.groupId) : toggleOption(sel, entry.groupId, entry.optionId);
}

/** "Showing 23 of 197", or just "197 upgrades" when nothing is filtered out. */
export const resultsText = (shown, total, noun) => (shown === total ? `${total} ${total === 1 ? noun.replace(/s$/, '') : noun}` : `Showing ${shown} of ${total}`);

/** The "Filters (2 active)" button of the narrow layout. */
export const filtersButtonText = (n) => (n > 0 ? `Filters (${n} active)` : 'Filters');

/** Next sort after a click on a header: the column's natural direction first, then the other, then none. */
export function nextSort(sort, key, firstDir = 'asc') {
  if (!sort || sort.key !== key) return { key, dir: firstDir };
  if (sort.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return null;
}
/** aria-sort value of a header. */
export const ariaSortOf = (sort, key) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

/** Rows sorted by a value function (numbers or text); no value goes last in both directions; ties keep their order. */
export function sortBy(rows, sort, valueOf) {
  if (!sort) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = (x, y) => (typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y);
  return rows.map((r, i) => ({ r, i, v: valueOf(r, sort.key) })).sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    return cmp(a.v, b.v) * sign || a.i - b.i;
  }).map((e) => e.r);
}

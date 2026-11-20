// The Goals list as a table row per goal, and its sorting. Pure.
// One price per goal: what is left to pay in the shared plan, the same number the planned total adds up
// (a reserved goal at its reserved price, the others at today's plan). Details are in the goal's own view.

const KINDS = ['own', 'now', 'norush', 'optional', 'wait'];

/**
 * How far along a chain is: upgrades owned out of all its upgrades. One helper for the Goals list and the goal panel,
 * so both count the same journey (the reserved chain when the goal has one, else the proposed chain).
 * @param {{ steps?: any[], bar?: object }|null} j a journey
 * @returns {{ own: number, total: number }}
 */
export function chainProgress(j) {
  const bar = j?.bar ?? {};
  const own = bar.own ?? 0;
  const total = (j?.steps?.length) || KINDS.reduce((n, k) => n + (bar[k] ?? 0), 0);
  return { own, total };
}

/** "15 of 17 upgrades owned" (the line beside the money figure, and the Goals list's bar label). */
export const progressText = ({ own, total }) => `${own} of ${total} ${total === 1 ? 'upgrade' : 'upgrades'} owned`;

/**
 * The one chip a goal shows in the list: its most urgent state, Buy now > On sale > Optional > Wait > Owned, with the count.
 * @param {{ buyCount?: number, noRushCount?: number, optionalCount?: number, waitCount?: number }} g a todayView goal
 * @param {number} own upgrades already owned (the chip of a goal with nothing left to do)
 * @returns {{ state: string, count: number }|null}
 */
export function urgentChip(g, own = 0) {
  const order = [['now', g.buyCount], ['norush', g.noRushCount], ['optional', g.optionalCount], ['wait', g.waitCount]];
  for (const [state, count] of order) if ((count ?? 0) > 0) return { state, count };
  return own > 0 ? { state: 'own', count: own } : null;
}

/** The bar's buckets of the counted chain as the counts urgentChip reads (so the chip counts the chain the bar and price count). */
export const chipCounts = (bar) => ({ buyCount: bar?.now, noRushCount: bar?.norush, optionalCount: bar?.optional, waitCount: bar?.wait });

/** "from your Pulse · LTI" -> "Pulse · LTI"; "from Carrack (fixed)" -> "Carrack (fixed)"; the no-starting-ship text stays out (the chip says it). */
export const shortStart = (line) => (!line || /^needs a starting ship/i.test(line) ? null : line.replace(/^from (your )?/i, ''));

/** @param {object} g a todayView goal */
export function goalRow(g) {
  const stuck = g.status === 'no-route' || g.status === 'no-token';
  // The reserved chain's journey when the goal has one: the same chain the price counts and the goal panel shows.
  const counted = g.counted ?? g.journey;
  const { own, total } = chainProgress(counted);
  const left = stuck ? null : (g.countedCash ?? g.acceptedCash ?? g.cash ?? null);
  const flag = g.status === 'no-token' ? { text: 'Needs a starting ship', tone: 'warn' }
    : g.status === 'no-route' ? { text: 'No route', tone: 'warn' }
    : g.status === 'done' ? { text: 'All upgrades owned', tone: 'own' }
    : null;
  return {
    id: g.goalId, name: g.targetName ?? g.name, from: shortStart(g.startLine), left, own, total, bar: counted?.bar ?? null, chip: flag ? null : urgentChip(chipCounts(counted?.bar), own), flag,
    reserved: g.acceptedCash != null,
    // A reserved goal whose price moved: the table shows the reserved price, the tooltip the price at today's prices.
    nowCash: g.acceptedCash != null && g.cash != null && g.cash !== g.acceptedCash ? g.cash : null,
    // A reserved goal whose proposed chain is cheaper: how much less new cash switching would need.
    cheaperBy: g.acceptedCash != null && g.cash != null && g.cash < g.acceptedCash ? g.acceptedCash - g.cash : null,
    ratio: total ? own / total : 0,
  };
}

/** Next sort state after a click on a column header: first click starts the column's natural direction, then it flips, then it clears. */
export function nextSort(sort, key) {
  const first = key === 'progress' ? 'desc' : 'asc';
  if (!sort || sort.key !== key) return { key, dir: first };
  if (sort.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return null;
}

/** Sorts rows inside one group; no sort keeps the planning order. Goals without a value stay last. */
export function sortRows(rows, sort) {
  if (!sort) return rows;
  const val = (r) => (sort.key === 'progress' ? (r.total ? r.ratio : null) : r.left);
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = val(a.r), y = val(b.r);
    if (x == null && y == null) return a.i - b.i;
    if (x == null) return 1;
    if (y == null) return -1;
    return x === y ? a.i - b.i : (x - y) * sign;
  }).map((e) => e.r);
}

/** aria-sort value of a column header. */
export const ariaSort = (sort, key) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

/** The line beside the planned total: "10 goals · nothing to buy today". */
export const tableSummary = (goals, buyToday) => `${goals} ${goals === 1 ? 'goal' : 'goals'} · ${buyToday > 0 ? `${buyToday} to buy today` : 'nothing to buy today'}`;

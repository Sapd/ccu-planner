// The hangar-health banner: upgrades in the hangar the planner could not read. A plan cannot use what it cannot read, so it
// may propose buying an upgrade the user already owns. Pure.
import { t } from '../../../../src/logic/i18n.mjs';

/**
 * @param {{ review?: Array<{ pledgeId: number, fromShip?: number|null, toShip?: number|null }>, owned?: Array<unknown> }} data app.data
 * @param {Array<{ goalId: string, name: string, targetId?: number, journey?: { steps?: Array<{ state: string, step: { from: number, to: number } }> } }>} goals todayView(app).goals
 * @returns {null | { count: number, total: number, goals: string[], key: string, text: string }}
 */
export function hangarHealth(data, goals) {
  const review = data?.review ?? [];
  if (!review.length) return null;
  const total = review.length + (data.owned?.length ?? 0);
  // A goal may be affected when it plans to buy into, or out of, a ship an unreadable upgrade starts or ends at.
  const touched = new Set();
  for (const r of review) { if (r.fromShip != null) touched.add(r.fromShip); if (r.toShip != null) touched.add(r.toShip); }
  const names = [];
  for (const g of goals ?? []) {
    const buys = (g.journey?.steps ?? []).filter((x) => x.state !== 'own');
    if (touched.has(g.targetId) || buys.some((x) => touched.has(x.step.to) || touched.has(x.step.from))) names.push(g.name);
  }
  const what = review.length === 1 ? t('1 upgrade in your hangar could not be read') : t('{n} of {total} upgrades in your hangar could not be read', { n: review.length, total });
  const effect = names.length
    ? ` ${t('Plans for {names} may suggest buying an upgrade you already own.', { names: names.join(', ') })}`
    : ` ${t('A plan may suggest buying an upgrade you already own.')}`;
  // Dismissing hides the banner for this exact set of upgrades; a new unreadable upgrade brings it back.
  const key = review.map((r) => String(r.pledgeId)).sort().join(',');
  return { count: review.length, total, goals: names, key, text: `${what}.${effect}` };
}

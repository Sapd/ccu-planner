// "CCUs you own into this ship": the owned CCUs whose target is the ship, and what each copy is used for. Pure.
import { t } from './i18n.mjs';
import { sessionFor } from './session.mjs';
import { goalNamer } from './ships.mjs';
import { localToday } from './availability.mjs';


/**
 * @param {object} app planner app
 * @param {number} shipId target ship of the CCUs
 * @param {{ goalId?: string|null, day?: string }} [opts] goalId: the goal being looked at, so its own copies read "used on this route"
 * @returns {{
 *   shipId: number, total: number,
 *   groups: Array<{ from: number, fromName: string, count: number, copies: Array<{ copyId: string, paid: number|null, giftable: boolean, use: { kind: 'used'|'cover'|'unused', goalId: string|null, goalName: string|null, text: string } }> }>,
 * }}
 * A copy is 'used' when a goal's route in the shared plan takes it (use.goalId, use.goalName), 'cover' when it is the backup that
 * caps the price rise of a goal's locked last step (lockCover; the goal is use.goalId), else 'unused'. Groups are by source ship,
 * biggest first; copies keep their planning order (cheapest-paid first).
 */
export function ownedInto(app, shipId, { goalId = null, day = localToday() } = {}) {
  const session = sessionFor(app);
  const { plans, graph, data } = session;
  const ships = data?.ships ?? null;
  const namer = goalNamer(plans, ships);
  const shipName = (id) => ships?.get(id)?.name ?? t('unknown ship');

  const holders = new Map(); // copyId -> goal id
  for (const [id, entry] of session.shared) for (const s of entry.route?.steps ?? []) if (s.copyId) holders.set(s.copyId, id);

  // Copies that cover a locked goal's price rise (only goals whose lock applies look for one).
  const covers = new Map(); // copyId -> goal id
  for (const [id, entry] of session.shared) {
    const chain = plans.chains[id];
    if (!entry.route || (chain.mode ?? 'watch') !== 'watch') continue;
    const d = session.advice(id, { route: entry.route, day }).dec;
    if (d.cover?.copyId && d.reason) covers.set(d.cover.copyId, id);
  }

  const groups = [];
  for (const [from, edges] of graph.edges) {
    for (const e of edges) {
      if (e.kind !== 'owned' || e.to !== shipId) continue;
      const copies = e.copies.map((c) => {
        let use;
        if (holders.has(c.copyId)) {
          const id = holders.get(c.copyId);
          use = { kind: 'used', goalId: id, goalName: namer(id), text: id === goalId ? 'used on this route' : `used by ${namer(id)}` };
        } else if (covers.has(c.copyId)) {
          const id = covers.get(c.copyId);
          use = { kind: 'cover', goalId: id, goalName: namer(id), text: `covers ${namer(id)}'s price rise` };
        } else use = { kind: 'unused', goalId: null, goalName: null, text: 'unused' };
        return { copyId: c.copyId, paid: c.paid?.cents ?? null, giftable: !!c.giftable, use };
      });
      groups.push({ from, fromName: shipName(from), count: copies.length, copies });
    }
  }
  groups.sort((a, b) => b.count - a.count || a.fromName.localeCompare(b.fromName));
  return { shipId, total: groups.reduce((n, g) => n + g.count, 0), groups };
}

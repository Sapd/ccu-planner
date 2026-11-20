// What changed since the last sync: a snapshot of the shared plan is stored with every sync (plan-snapshots.json),
// and the current plan is compared with the latest snapshot of older data. Pure: the CLI sync script writes the file.
import { goalLabel } from './ships.mjs';

export const SNAPSHOT_MAX = 30;

// The newest fetch time of any offer: an `upgrades` sync changes it, a catalog or hangar sync does not.
const offersAtOf = (data) => (data?.offers ?? []).reduce((m, o) => (o.fetchedAt && (!m || o.fetchedAt > m) ? o.fetchedAt : m), null);
const stampsOf = (data) => ({ storeAt: data?.meta?.catalogAt ?? null, hangarAt: data?.meta?.hangarAt ?? null, offersAt: offersAtOf(data) });
export const sameStamps = (a, b) => (a.storeAt ?? null) === (b.storeAt ?? null) && (a.hangarAt ?? null) === (b.hangarAt ?? null) && (a.offersAt ?? null) === (b.offersAt ?? null);

/** What identifies the data and the plan documents of a session: the sync stamps (store, hangar, offers) and the plan/price/sale-event revisions. */
export const snapshotKey = (session) => ({ ...stampsOf(session.data), revs: session.revs ?? null });

/**
 * A snapshot of the session's shared plan, goals in planning order:
 * { at, storeAt, hangarAt, offersAt, revs, total, goals: { [id]: { name, cash, route: [[from, to, kind, cash, copyId|null]] | null } },
 *   msrp: { [shipId]: cents } (every catalog ship), copies: [copyId] (every CCU in the hangar) }.
 * `copies` lets a later comparison tell a new hangar copy from one another goal gave up.
 */
export function buildSnapshot(session, at = new Date().toISOString()) {
  const { plans, data } = session;
  const goals = {};
  let total = 0;
  for (const [id, entry] of session.shared) {
    const r = entry.route;
    goals[id] = { name: goalLabel(plans.chains[id], data?.ships), cash: r?.cash ?? null, route: r ? r.steps.map((s) => [s.from, s.to, s.kind, s.cash ?? 0, s.copyId ?? null]) : null };
    total += r?.cash ?? 0;
  }
  const msrp = {};
  for (const [id, s] of data?.ships ?? []) if (s.msrp != null) msrp[id] = s.msrp;
  return { at, ...snapshotKey(session), total, goals, msrp, copies: (data?.owned ?? []).map((o) => o.copyId) };
}

/**
 * `list` plus `snap`; keeps the newest `max`. A snapshot of the same data (storeAt, hangarAt, offersAt) is replaced, so the
 * latest one wins and plan edits made since the last sync become part of the baseline.
 */
export function addSnapshot(list, snap, max = SNAPSHOT_MAX) {
  const items = Array.isArray(list) ? list : [];
  return [...items.filter((s) => !sameStamps(s, snap)), snap].slice(-max);
}

const key = (kind, from, to) => `${kind}:${from}-${to}`;

/**
 * `list` with a snapshot of the session's plan added (see addSnapshot), or null when nothing needs recording: the newest
 * snapshot already has these stamps and the same plan, price and sale-event revisions (a `details` or `buyback` sync). Pure:
 * the CLI (src/data.mjs recordSnapshot) and the desktop app (app/src/lib/plan-snapshot.js) store the result.
 */
export function withSnapshot(list, session, at = new Date().toISOString()) {
  const key = snapshotKey(session);
  const last = list.at(-1);
  if (last && sameStamps(last, key) && last.revs === key.revs) return null;
  return addSnapshot(list, buildSnapshot(session, at));
}

/**
 * The current plan against the latest snapshot whose data (storeAt, hangarAt, offersAt) differs from the current data.
 * @returns {null | {
 *   since: string|null, previousAt: string, was: number, total: number, totalDelta: number,
 *   goals: Array<{ goalId: string, name: string, was: number|null, now: number|null, delta: number|null, causes: object[] }>,
 *   added: Array<{ goalId: string, name: string, cash: number|null }>, removed: Array<{ goalId: string, name: string, cash: number|null }>,
 * }} null without a snapshot of older data. `since` = when that older data was fetched.
 * was / total / totalDelta add up only the goals present in both snapshots, so adding or removing a goal never moves them;
 * added and removed goals are listed apart with their cash. Only common goals with a different cash are in `goals`.
 * Causes, in this order: msrp { shipId, was, now } (a ship of a Standard step whose price changed), step-gone { step, from, to },
 * step-repriced { step, from, to, was, now } (the same offer at another price, no msrp change explains it), new-warbond { from, to, cash },
 * copy-gone / copy-new { from, to }, taken { from, to, by }, and when none applies order {} (the planning order changed) or none {}.
 */
export function changesSinceSync(session, snapshots) {
  const cur = stampsOf(session.data);
  const prev = [...(snapshots ?? [])].reverse().find((s) => !sameStamps(s, cur));
  if (!prev) return null;
  const now = session.memo('snapshot', '', () => buildSnapshot(session));
  const offerCash = new Map(); // kind:from-to -> cheapest current offer
  for (const o of session.data?.offers ?? []) {
    const k = key(o.kind, o.from, o.to);
    if (!offerCash.has(k) || o.cash < offerCash.get(k)) offerCash.set(k, o.cash);
  }
  const inHangar = new Set((session.data?.owned ?? []).map((o) => o.copyId));
  const hadCopies = prev.copies ? new Set(prev.copies) : null;
  const common = Object.keys(now.goals).filter((id) => id in prev.goals);
  const prevOrder = Object.keys(prev.goals).filter((id) => id in now.goals);
  const orderChanged = JSON.stringify(prevOrder) !== JSON.stringify(common);
  // owned copy -> goal that uses it now
  const usedNow = new Map();
  for (const [id, g] of Object.entries(now.goals)) for (const s of g.route ?? []) if (s[4]) usedNow.set(s[4], id);
  const msrpMoved = (id) => prev.msrp?.[id] != null && now.msrp[id] != null && prev.msrp[id] !== now.msrp[id];

  const goals = [];
  for (const id of common) {
    const a = prev.goals[id];
    const b = now.goals[id];
    if (a.cash === b.cash) continue;
    const delta = a.cash != null && b.cash != null ? b.cash - a.cash : null;
    const oldSteps = a.route ?? [];
    const newSteps = b.route ?? [];
    const causes = [];
    // msrp: a ship of a Standard step that costs something else now than on the old route
    const oldStd = new Map(oldSteps.filter((st) => st[2] === 'standard').map(([from, to, kind, cash]) => [key(kind, from, to), cash]));
    const newStd = new Map(newSteps.filter((st) => st[2] === 'standard').map(([from, to, kind, cash]) => [key(kind, from, to), cash]));
    const seen = new Set();
    for (const [from, to, kind] of [...oldSteps, ...newSteps]) {
      const k = key(kind, from, to);
      if (kind !== 'standard' || (oldStd.has(k) && newStd.has(k) && oldStd.get(k) === newStd.get(k))) continue;
      for (const shipId of [from, to]) {
        if (seen.has(shipId) || !msrpMoved(shipId)) continue;
        seen.add(shipId);
        causes.push({ kind: 'msrp', shipId, was: prev.msrp[shipId], now: now.msrp[shipId] });
      }
    }
    for (const [from, to, kind] of oldSteps) if (kind !== 'owned' && !offerCash.has(key(kind, from, to))) causes.push({ kind: 'step-gone', step: kind, from, to });
    for (const [from, to, kind, cash] of oldSteps) {
      const nowCash = kind === 'owned' ? undefined : offerCash.get(key(kind, from, to));
      if (nowCash === undefined || nowCash === cash) continue;
      if (kind === 'standard' && (msrpMoved(from) || msrpMoved(to))) continue; // told by the msrp cause
      causes.push({ kind: 'step-repriced', step: kind, from, to, was: cash, now: nowCash });
    }
    const oldKeys = new Set(oldSteps.map(([from, to, kind]) => key(kind, from, to)));
    for (const [from, to, kind, cash] of newSteps) if (kind === 'warbond' && !oldKeys.has(key(kind, from, to))) causes.push({ kind: 'new-warbond', from, to, cash });
    for (const [from, to, kind, , copyId] of oldSteps) if (kind === 'owned' && copyId && !inHangar.has(copyId)) causes.push({ kind: 'copy-gone', from, to });
    if (hadCopies) for (const [from, to, kind, , copyId] of newSteps) if (kind === 'owned' && copyId && !hadCopies.has(copyId)) causes.push({ kind: 'copy-new', from, to });
    if (!causes.length) {
      for (const [from, to, kind, , copyId] of oldSteps) {
        const by = kind === 'owned' && copyId && inHangar.has(copyId) ? usedNow.get(copyId) : null;
        if (by && by !== id) causes.push({ kind: 'taken', from, to, by: now.goals[by].name });
      }
    }
    if (!causes.length) causes.push({ kind: orderChanged ? 'order' : 'none' });
    goals.push({ goalId: id, name: b.name, was: a.cash, now: b.cash, delta, causes });
  }
  const sum = (src, ids) => ids.reduce((n, id) => n + (src[id].cash ?? 0), 0);
  const was = sum(prev.goals, common);
  const total = sum(now.goals, common);
  const stamp = (field) => (prev[field] ?? null) !== (cur[field] ?? null) ? prev[field] : null;
  const since = [stamp('storeAt'), stamp('hangarAt'), stamp('offersAt')].filter(Boolean).sort().pop() ?? prev.at;
  const listed = (src, ids) => ids.map((id) => ({ goalId: id, name: src[id].name, cash: src[id].cash }));
  return {
    since, previousAt: prev.at, was, total, totalDelta: total - was, goals,
    added: listed(now.goals, Object.keys(now.goals).filter((id) => !(id in prev.goals))),
    removed: listed(prev.goals, Object.keys(prev.goals).filter((id) => !(id in now.goals))),
  };
}

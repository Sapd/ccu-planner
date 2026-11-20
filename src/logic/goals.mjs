// Goal state, reservations and the accepted route. Pure functions over a state object;
// the CLI does the file I/O. (A goal is stored as a "chain" in plans.json.)
//
// Rules
// - A chain's accepted route holds a firm reservation on each owned copy it uses.
//   One copy belongs to at most one chain. Drafts and proposals hold nothing.
// - Store credit is one pool per profile: credit used by accepted chains is
//   committed; a new proposal only sees the uncommitted rest.
// - Refreshing a chain never takes copies from another chain. What that costs
//   it is told by sharedEffect (sharedEffect.mjs).
// - Accepting re-checks every claim against the current state; a copy taken in
//   the meantime is a conflict, not a silent overwrite.

import { edgeKey } from './planner.mjs';

export const PRIORITY = { high: 0, normal: 1, low: 2 };

export function newState() {
  return { version: 1, rev: 0, profile: { credit: 0 }, nextId: 1, chains: {} };
}

// watch  = goal you want eventually; wait for better Warbonds, buy nothing by default
// finish = goal you want to complete now; enters the purchase list and melt planning
export const MODES = ['watch', 'finish'];

// A goal starts from `start`: { kind: 'token' } (any LTI token), { kind: 'token', pledgeId } or { kind: 'ship', ship }.
export const startOf = (chain) => chain.start;

// `base` is an input shorthand for a fixed ship start; it is never stored.
export function addChain(state, { name, start, base, target, priority = 'normal', mode = 'watch' }) {
  start ??= base != null ? { kind: 'ship', ship: base } : undefined;
  if (!(priority in PRIORITY)) throw new Error(`priority must be one of ${Object.keys(PRIORITY).join(', ')}`);
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  const id = `c${state.nextId++}`;
  state.chains[id] = { id, name: name ?? id, start, target, priority, mode, objective: 'cash', createdAt: new Date().toISOString(), accepted: null, lastSeen: null, history: [] };
  return state.chains[id];
}

export const OBJECTIVES = ['cash', 'allin'];

/** cash: least new cash · allin: lowest all-in cost (new purchases + consumed CCUs' cost) */
export function setObjective(state, chainId, objective) {
  if (!OBJECTIVES.includes(objective)) throw new Error(`objective must be one of ${OBJECTIVES.join(', ')}`);
  state.chains[chainId].objective = objective;
}

export function setMode(state, chainId, mode) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  state.chains[chainId].mode = mode;
}

export const LOCKS = ['auto', 'on', 'off'];

export function setLock(state, chainId, lock) {
  if (!LOCKS.includes(lock)) throw new Error(`lock must be one of ${LOCKS.join(', ')}`);
  state.chains[chainId].lock = lock;
}

/**
 * Remembers the latest proposal so the next refresh can say what changed
 * (e.g. "$15 less since yesterday: new Warbond X -> Y"). Returns the change.
 */
export function recordSeen(state, chainId, route, at = new Date().toISOString()) {
  const chain = state.chains[chainId];
  const prev = chain.lastSeen;
  const sig = route ? route.steps.map(edgeKey).join('|') : null;
  const cur = route ? { at, cash: route.cash, cashNow: route.steps.filter((s) => s.kind === 'warbond').reduce((n, s) => n + s.cash, 0), sig, steps: route.steps.map(slim) } : { at, cash: null, sig: null, steps: [] };
  chain.lastSeen = cur;
  if (!prev) return { kind: 'first', since: null };
  const prevKeys = new Set(prev.steps.map(edgeKey));
  const newSteps = cur.steps.filter((s) => !prevKeys.has(edgeKey(s)));
  return {
    kind: prev.sig === sig ? (prev.cash === cur.cash ? 'unchanged' : 'repriced') : 'changed',
    since: prev.at, cashBefore: prev.cash, cashAfter: cur.cash,
    newWarbonds: newSteps.filter((s) => s.kind === 'warbond'),
  };
}

/** copyId -> chainId for all accepted chains (optionally ignoring one chain). */
export function reservations(state, exceptChainId = null) {
  const out = new Map();
  for (const c of Object.values(state.chains)) {
    if (c.id === exceptChainId || !c.accepted) continue;
    for (const s of c.accepted.steps) if (s.copyId) out.set(s.copyId, c.id);
    if (c.accepted.token?.copyId) out.set(c.accepted.token.copyId, c.id);
  }
  return out;
}

/**
 * What a reservation's Standard steps do with the owned copies nobody reserves: a reserved Standard step counts as bought
 * once you own a copy of that upgrade that no reservation holds and no earlier goal has used (the credit it used is
 * gone from the balance already, so it must not stay committed). That copy then belongs to this goal alone.
 * `taken` = copy ids already reserved or used by earlier goals (not changed here).
 * @returns {{ credit: number, bought: string[] }} credit still to spend, and the copies this reservation uses up
 */
export function settleStandard(accepted, graph, taken = new Set()) {
  const credit = accepted?.creditUsed ?? 0;
  if (!graph) return { credit, bought: [] };
  const used = new Set(taken);
  const bought = [];
  let toBuy = 0;
  for (const s of accepted.steps) {
    if (s.kind !== 'standard') continue;
    const edge = (graph.edges.get(s.from) ?? []).find((e) => e.kind === 'owned' && e.to === s.to);
    const copy = edge?.copies.find((c) => !used.has(c.copyId));
    if (copy) { used.add(copy.copyId); bought.push(copy.copyId); } else toBuy += s.cash;
  }
  return { credit: Math.min(credit, toBuy), bought };
}

/**
 * The store credit a reservation still has to spend: its credit, capped by the Standard steps that are not bought
 * yet (see settleStandard). Without `graph` the whole reserved credit counts.
 */
export function creditToSpend(accepted, graph = null, taken = new Set()) {
  return settleStandard(accepted, graph, taken).credit;
}

/** Accepted goals in the one order every credit and copy claim is settled in. */
export const acceptedInOrder = (state) => Object.values(state.chains).filter((c) => c.accepted).sort(byPriority);

/** Credit held by the reservations of all goals (except one): see creditToSpend. One copy settles one goal's step only. */
export function creditCommitted(state, exceptChainId = null, graph = null) {
  const taken = graph ? new Set(reservations(state).keys()) : null;
  let sum = 0;
  for (const c of acceptedInOrder(state)) {
    const { credit, bought } = settleStandard(c.accepted, graph, taken ?? undefined);
    if (taken) for (const id of bought) taken.add(id);
    if (c.id !== exceptChainId) sum += credit;
  }
  return sum;
}

const slim = (s) => ({ kind: s.kind, from: s.from, to: s.to, cash: s.cash, ...(s.copyId ? { copyId: s.copyId } : {}), ...(s.skuId ? { skuId: s.skuId } : {}) });

export const byPriority = (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export const startShip = (chain, route) => route?.start?.ship ?? chain.accepted?.token?.ship ?? (startOf(chain).kind === 'ship' ? startOf(chain).ship : null);

/**
 * Checks an accepted route against current offers and hangar.
 * `lti` (hangar token pledges) enables the token-gone check; without it the check is skipped.
 * Issues are plain objects; describe.mjs (issueLine) words them. kinds: token-gone { pledgeId, ship }, copy-gone { copyId, from, to },
 * copy-shared { copyId, from, to, by (goal id) }, offer-gone { step (kind), from, to }, repriced { step (kind), from, to, was, now }.
 * @returns {{ status: 'ok'|'repriced'|'blocked', cash: number, issues: object[] }}
 */
export function evaluateAccepted(state, chainId, { offers, owned, lti }) {
  const chain = state.chains[chainId];
  if (!chain.accepted) return { status: 'draft', cash: null, issues: [] };
  const ownedIds = new Set(owned.map((o) => o.copyId));
  const bestOffer = new Map();
  for (const o of offers) {
    const k = `${o.kind}:${o.from}-${o.to}`;
    if (!bestOffer.has(k) || o.cash < bestOffer.get(k).cash) bestOffer.set(k, o);
  }
  const others = reservations(state, chainId);
  const issues = [];
  const usedHere = new Set(chain.accepted.steps.filter((s) => s.copyId).map((s) => s.copyId));
  let blocked = false;
  let wb = 0;
  let std = 0;
  const tk = chain.accepted.token;
  if (tk && lti && !lti.some((t) => String(t.pledgeId) === String(tk.pledgeId))) {
    blocked = true;
    issues.push({ kind: 'token-gone', pledgeId: tk.pledgeId, ship: tk.ship ?? null });
  }
  for (const s of chain.accepted.steps) {
    if (s.kind === 'owned') {
      if (!ownedIds.has(s.copyId)) { blocked = true; issues.push({ kind: 'copy-gone', copyId: s.copyId, from: s.from, to: s.to }); }
      if (others.has(s.copyId)) { blocked = true; issues.push({ kind: 'copy-shared', copyId: s.copyId, from: s.from, to: s.to, by: others.get(s.copyId) }); }
      continue;
    }
    const cur = bestOffer.get(edgeKey(s));
    if (!cur) {
      // A step you now own a usable copy of (not held by another goal) is bought, so its offer may be gone.
      const bought = owned.find((o) => o.from === s.from && o.to === s.to && !others.has(o.copyId) && !usedHere.has(o.copyId));
      if (bought) { usedHere.add(bought.copyId); continue; }
      blocked = true; issues.push({ kind: 'offer-gone', step: s.kind, from: s.from, to: s.to });
      continue;
    }
    if (cur.cash !== s.cash) issues.push({ kind: 'repriced', step: s.kind, from: s.from, to: s.to, was: s.cash, now: cur.cash });
    if (s.kind === 'warbond') wb += cur.cash; else std += cur.cash;
  }
  const credit = Math.min(std, chain.accepted.creditUsed ?? 0);
  const cash = wb + std - credit;
  return { status: blocked ? 'blocked' : issues.length ? 'repriced' : 'ok', cash, issues };
}

/** Classifies a proposal against the accepted route. */
export function diffRoutes(accepted, proposed) {
  if (!accepted) return { kind: 'new', cashDelta: null };
  if (!proposed) return { kind: 'no-route', cashDelta: null };
  const a = accepted.steps.map(edgeKey).join('|');
  const p = proposed.steps.map(edgeKey).join('|');
  const cashDelta = proposed.cash - accepted.cash;
  const aCopies = new Set(accepted.steps.filter((s) => s.copyId).map((s) => s.copyId));
  const pCopies = new Set(proposed.steps.filter((s) => s.copyId).map((s) => s.copyId));
  const released = [...aCopies].filter((c) => !pCopies.has(c));
  const claimed = [...pCopies].filter((c) => !aCopies.has(c));
  if (a === p) {
    const sameCopies = !released.length && !claimed.length;
    return { kind: cashDelta === 0 && sameCopies ? 'unchanged' : 'same-path', cashDelta, released, claimed };
  }
  return { kind: 'alternative', cashDelta, released, claimed };
}

export class ConflictError extends Error {}

/** Accepts a route: re-checks claims, stores an immutable revision, reserves copies. */
export function acceptRoute(state, chainId, route, meta = {}, { graph = null } = {}) {
  const chain = state.chains[chainId];
  const others = reservations(state, chainId);
  const clash = route.steps.filter((s) => s.copyId && others.has(s.copyId));
  if (clash.length) throw new ConflictError(`copies already reserved: ${clash.map((s) => `${s.copyId} by ${others.get(s.copyId)}`).join(', ')}`);
  const tk = route.start?.token;
  if (tk && others.has(tk.copyId)) throw new ConflictError(`token already used by ${others.get(tk.copyId)}`);
  const free = Math.max(0, (state.profile.credit ?? 0) - creditCommitted(state, chainId, graph));
  if (route.creditUsed > free) throw new ConflictError(`needs ${route.creditUsed} credit, only ${free} uncommitted`);
  const rev = (chain.accepted?.rev ?? 0) + 1;
  if (chain.accepted) chain.history.push(chain.accepted);
  chain.accepted = {
    rev, acceptedAt: new Date().toISOString(), ...meta,
    cash: route.cash, creditUsed: route.creditUsed, ownedBasis: route.ownedBasis ?? null, allIn: route.allIn ?? null,
    objective: state.chains[chainId].objective ?? 'cash', steps: route.steps.map(slim),
    token: tk ? { ...tk, ship: route.start.ship } : null,
  };
  return chain.accepted;
}

export function releaseChain(state, chainId) {
  const chain = state.chains[chainId];
  if (chain.accepted) chain.history.push({ ...chain.accepted, releasedAt: new Date().toISOString() });
  chain.accepted = null;
}

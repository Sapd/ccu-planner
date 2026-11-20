// The decision graph: the best route merged with its alternatives into one
// directed graph, every step annotated with the options it was chosen from and
// why. Pure; the same inputs give the same result.

import { startShip, reservations, diffRoutes } from './chains.mjs';
import { routeAdvice } from './advice.mjs';
import { sessionOf } from './session.mjs';
import { edgeKey, incomingCount } from './planner.mjs';
import { localToday, shipAvailability } from './availability.mjs';
import { shipName, goalNamer } from './ships.mjs';
import { usd } from './format.mjs';
import { conceptTieText, noRouteMessage, NO_TOKEN_TEXT, routeLine, eventLockWhy, eventBuyWhy, eventLockDecision, eventAlertText, standardLaterText, bestDiffers, BEST_DIFFERS_LABEL } from './describe.mjs';

const metricOf = (objective) => (objective === 'allin' ? (r) => r.allIn : (r) => r.cash);
const optionOrder = (a, b) => Number(!!b.chosen) - Number(!!a.chosen) || Number(b.available) - Number(a.available) || a.cash - b.cash || String(a.copyId ?? '').localeCompare(String(b.copyId ?? ''));

/**
 * @param {object} app { plans, graph, data: { ships }, overrides?, expected?, saleEvents? }
 * @param {string} chainId
 * @param {{ k?: number, wanted?: object|null, avail?: object, today?: string }} [opts]
 *   wanted: a precomputed wantedWarbonds result; null skips the would-help lines; omitted computes it.
 *   avail: an availCtx; omitted builds it from the app for `today`.
 * @returns {{ nodes: object[], edges: object[], steps: object[], verdict: object }}
 */
export function decisionGraph(app, chainId, { k = 5, wanted, avail, today = localToday() } = {}) {
  const { plans, graph } = app;
  const session = sessionOf(app);
  const ships = app.data.ships;
  const chain = plans.chains[chainId];
  const name = (id) => shipName(ships, id);
  const ctx = avail ?? session.avail(today);
  const objective = chain.objective ?? 'cash';
  const metric = metricOf(objective);
  const { routes, noToken } = session.proposal(chainId, k);
  const best = routes[0];
  if (!best) {
    return { nodes: [], edges: [], steps: [], verdict: { objective, cash: null, creditUsed: 0, allIn: null, versus: null, helps: [], text: noToken ? NO_TOKEN_TEXT : noRouteMessage(name(chain.target), incomingCount(graph, chain.target)) } };
  }

  // ----- merged graph -----
  const edges = new Map();
  routes.forEach((r, i) => {
    const delta = metric(r) - metric(best);
    for (const s of r.steps) {
      const key = edgeKey(s);
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { from: s.from, to: s.to, kind: s.kind, cash: s.cash, ...(s.copyId ? { copyId: s.copyId } : {}), routes: [], best: false, delta: Infinity }));
      e.routes.push(i);
      e.best ||= i === 0;
      e.delta = Math.min(e.delta, delta);
    }
  });

  // Layers: ships of the best route sit at their step index. A ship only on an
  // alternative sits between the best-route ships around it on that route, by
  // price when it is alone in the gap and evenly spread otherwise.
  const layers = new Map(best.steps.length ? [[startShip(chain, best), 0], ...best.steps.map((s, i) => [s.to, i + 1])] : []);
  const loose = new Map(); // ship -> layers proposed by alternatives
  const msrp = (id) => ships.get(id)?.msrp ?? null;
  for (const r of routes.slice(1)) {
    const path = [r.steps[0].from, ...r.steps.map((s) => s.to)];
    for (let i = 0; i < path.length;) {
      if (layers.has(path[i])) { i++; continue; }
      let j = i;
      while (j < path.length && !layers.has(path[j])) j++;
      const lo = layers.get(path[i - 1]) ?? 0;
      const hi = layers.get(path[j]) ?? lo + 1;
      const span = hi > lo ? hi - lo : 1;
      const m0 = msrp(path[i - 1]); const m1 = msrp(path[j]);
      for (let x = i; x < j; x++) {
        let f = (x - i + 1) / (j - i + 1);
        if (j - i === 1 && m0 != null && m1 != null && m1 > m0 && msrp(path[x]) != null) f = Math.min(0.85, Math.max(0.15, (msrp(path[x]) - m0) / (m1 - m0)));
        if (!loose.has(path[x])) loose.set(path[x], []);
        loose.get(path[x]).push(lo + f * span);
      }
      i = j;
    }
  }
  for (const [id, ls] of loose) layers.set(id, ls.reduce((a, b) => a + b, 0) / ls.length);
  const nodes = [...layers].map(([id, layer]) => {
    const s = ships.get(id);
    return { id, name: name(id), msrp: s?.msrp ?? 0, concept: !!s?.concept, layer, onBest: best.steps.some((e) => e.from === id || e.to === id) };
  });

  // ----- steps -----
  const taken = reservations(plans, chainId);
  const goalName = goalNamer(plans, ships);
  const expected = app.expected ?? app.data.offers ?? [];
  // The session's cached advice when this is its own context (the usual case: every page then shares one answer object);
  // a caller-supplied availability context is its own question.
  const adv = avail ? routeAdvice(session, chain, best, { ships, overrides: app.overrides ?? null, expected, avail: ctx }) : session.advice(chainId, { route: best, day: today });
  const { finish, dec } = adv;
  const lockWhy = adv.lockCode;
  const lockStep = adv.groups.lockNow[0] ?? null;
  const alertFor = (s) => adv.alerts.find((a) => a.step === s) ?? null;
  const coverText = adv.coverText;
  const targetEvent = adv.lockEvent;

  const ties = conceptTieNotes(best, routes, { concept: graph.concept, name, objective });
  const steps = best.steps.map((s, index) => {
    const last = index === best.steps.length - 1;
    const isLock = s === lockStep;
    const alert = isLock ? null : alertFor(s);
    const raw = [];
    for (const e of graph.edges.get(s.from) ?? []) {
      if (e.to !== s.to) continue;
      if (e.kind === 'owned') for (const c of e.copies) raw.push({ kind: 'owned', cash: 0, copyId: c.copyId, paid: c.paid?.cents ?? null, reservedBy: taken.get(c.copyId) ?? null });
      else raw.push({ kind: e.kind, cash: e.cash, ...(e.virtual ? { virtual: true, virtualId: e.virtualId } : {}), ...(e.skuId != null ? { skuId: e.skuId } : {}) });
    }
    const stdOffer = raw.find((o) => o.kind === 'standard');
    const diff = msrp(s.to) != null && msrp(s.from) != null ? msrp(s.to) - msrp(s.from) : null;
    if (!stdOffer && diff > 0) raw.push({ kind: 'standard', cash: diff, offered: false });
    const exp = expected.find((o) => o.kind === 'standard' && o.assumed && o.from === s.from && o.to === s.to);
    if (exp) raw.push({ kind: 'expected', cash: exp.cash });

    const isChosen = (o) => o.kind === s.kind && !!o.virtual === !!s.virtual && (!s.virtual || o.virtualId === s.virtualId) && (s.kind !== 'owned' || o.copyId === s.copyId);
    const lockText = !isLock ? null : lockWhy === 'event' ? eventLockWhy(targetEvent) : lockWhy === 'concept' ? 'concept: lock now'
      : lockWhy === 'expected' ? `price will rise (expected${exp ? ` ${usd(exp.cash)}` : ''})` : 'lock now: lock is set to on';
    // Compare with what the objective counts: all-in includes the paid basis of an owned copy.
    const val = (o) => (objective === 'allin' && o.kind === 'owned' ? o.paid ?? 0 : o.cash);
    const chosenVal = val(raw.find(isChosen) ?? { cash: s.cash });
    const options = raw.map((o) => {
      const chosen = isChosen(o);
      let why; let available = true;
      if (chosen) {
        why = isLock ? lockText
          : alert?.reason === 'event' ? eventBuyWhy(alert.event)
          : alert?.reason === 'pricier' ? `price will rise (expected ${usd(alert.expected)})`
          : alert?.reason === 'concept' ? 'concept: lock now'
          : 'chosen';
      } else if (o.kind === 'expected') {
        available = false;
        why = o.cash > (stdOffer?.cash ?? diff ?? 0) ? `price will rise (expected ${usd(o.cash)})` : `price will fall (expected ${usd(o.cash)})`;
      } else if (o.offered === false) {
        available = false;
        why = 'not on sale';
      } else if (o.reservedBy) {
        available = false;
        why = `reserved by ${goalName(o.reservedBy)}`;
      } else if (o.kind === 'owned' && s.kind === 'owned') {
        why = 'another copy of the same CCU is used';
      } else {
        const d = val(o) - chosenVal;
        why = d > 0 && objective === 'allin' && o.kind === 'owned' ? `higher all-in (paid ${usd(o.paid ?? 0)})`
          : d > 0 ? `costs ${usd(d)} more` : d < 0 ? `cheaper by ${usd(-d)}` : 'same price';
      }
      return { ...o, chosen, available, why };
    }).sort(optionOrder);

    const stdCash = stdOffer?.cash ?? null;
    let decision;
    if (s.kind === 'owned') {
      const c = options.find((o) => o.chosen);
      decision = `Use your owned CCU${c?.paid != null ? ` (paid ${usd(c.paid)})` : ''}: free now.`;
    } else if (s.kind === 'warbond') {
      const vs = stdCash == null ? 'no Standard upgrade is on sale' : stdCash > s.cash ? `${usd(stdCash - s.cash)} less than Standard` : 'not cheaper than Standard';
      decision = `Buy Warbond ${usd(s.cash)} now: ${vs}; Warbonds can vanish.`;
    } else if (isLock) {
      decision = lockWhy === 'event' ? eventLockDecision(s.cash, targetEvent)
        : `Buy Standard ${usd(s.cash)} later, or lock now: ${{ concept: 'target is a concept ship', expected: 'you expect its price to rise', on: 'lock is set to on' }[lockWhy]}.`;
    } else if (alert?.reason === 'event') {
      decision = `Buy Standard ${usd(s.cash)} before the sale ends: ${eventAlertText(alert)}.`;
    } else if (alert?.reason === 'pricier') {
      decision = `Buy Standard ${usd(s.cash)} before the price rises to ${usd(alert.expected)}.`;
    } else if (finish) {
      decision = `Buy Standard ${usd(s.cash)}: the chain is in finish mode.`;
    } else {
      decision = standardLaterText(s.cash, shipAvailability(ctx, s.to).status);
    }
    const cover = dec.covered && last ? coverText : null;
    if (cover) decision += ` ${cover}`;
    if (last && lockWhy && !isLock && s.kind !== 'standard') decision += ' This also locks the target price.';
    const tie = ties.get(edgeKey(s)) ?? null;
    return { index, from: s.from, to: s.to, chosen: { kind: s.kind, cash: s.cash, ...(s.copyId ? { copyId: s.copyId } : {}) }, options, decision, ...(cover ? { cover } : {}), ...(tie ? { tie } : {}) };
  });

  // ----- verdict -----
  const alt = routes[1] ?? null;
  const differsFromAccepted = bestDiffers(chain.accepted, best, diffRoutes);
  const w = wanted === undefined ? session.wanted(chainId) : wanted;
  const onRoute = new Set(best.steps.flatMap((s) => [s.from, s.to]));
  const helps = (w?.wanted ?? []).filter((x) => !x.createsRoute && (onRoute.has(x.from) || onRoute.has(x.to))).slice(0, 3)
    .map((x) => `a Warbond ${name(x.from)} → ${name(x.to)} below ${usd(x.below)} would switch the plan`);
  return {
    nodes, edges: [...edges.values()], steps,
    verdict: {
      objective, cash: best.cash, creditUsed: best.creditUsed, allIn: best.allIn, helps,
      versus: alt ? versusText(best, alt, objective, { concept: graph.concept, name }) : null,
      differsFromAccepted,
      text: `${differsFromAccepted ? `${BEST_DIFFERS_LABEL}: ` : ''}${objective === 'allin' ? 'Lowest all-in' : 'Least new money'}: ${routeLine(best)}`,
    },
  };
}

const sameCost = (a, b, objective) => a.creditUsed === b.creditUsed && a.cash === b.cash && (objective !== 'allin' || a.allIn === b.allIn);
const conceptWarbonds = (r, concept) => r.steps.filter((s) => s.kind === 'warbond' && concept.has(s.from));

/**
 * The planner prefers a Warbond from a flight-ready ship over an equal-cost one from a concept ship (the
 * concept ship's price may rise). For every step of `best` that won that way, one line naming the alternative.
 * @returns {Map<string, string>} edgeKey of the step -> "Chosen over Crucible → Galaxy (same price): the Crucible is a concept ship and may rise."
 */
export function conceptTieNotes(best, routes, { concept, name, objective = 'cash' }) {
  const notes = new Map();
  if (!concept?.size) return notes;
  for (const alt of routes) {
    if (alt === best || !sameCost(best, alt, objective)) continue;
    if (conceptWarbonds(alt, concept).length <= conceptWarbonds(best, concept).length) continue;
    for (const a of conceptWarbonds(alt, concept)) {
      // Only a step of the same kind that costs exactly the same: "same price" must be true of the two steps themselves.
      // Routes of other shapes (a different number of steps, or a tie decided by credit) get no note.
      const mine = best.steps.find((s) => s.kind === 'warbond' && s.to === a.to && s.from !== a.from && !concept.has(s.from) && s.cash === a.cash);
      if (mine && !notes.has(edgeKey(mine))) notes.set(edgeKey(mine), conceptTieText(name(a.from), name(a.to)));
    }
  }
  return notes;
}

/** The tie-break line of one step of a goal's best route (see conceptTieNotes), or null. Looks at the goal's five best routes. */
export function tieNoteFor(session, chainId, step) {
  const ships = session.data?.ships ?? null;
  const notes = session.memo('tie-notes', chainId, () => {
    const { routes } = session.proposal(chainId, 5);
    return routes.length > 1 ? conceptTieNotes(routes[0], routes, { concept: session.graph.concept, name: (id) => shipName(ships, id), objective: session.plans.chains[chainId]?.objective ?? 'cash' }) : new Map();
  });
  return notes.get(edgeKey(step)) ?? null;
}

/**
 * Why `best` beats `alt`, following the planner's tie-break order. `concept` (ids of concept ships) and `name`
 * let it word the flight-ready-Warbond rung.
 */
export function versusText(best, alt, objective = 'cash', { concept = null, name = null } = {}) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (objective === 'allin' && alt.allIn !== best.allIn) return `${usd(alt.allIn - best.allIn)} lower all-in than the next route`;
  if (alt.cash !== best.cash) return `${usd(alt.cash - best.cash)} less new money than the next route`;
  const lead = objective === 'allin' ? 'same all-in and cash' : 'same cash';
  if (alt.creditUsed !== best.creditUsed) return `${lead}, spends ${usd(Math.abs(alt.creditUsed - best.creditUsed))} ${alt.creditUsed > best.creditUsed ? 'less' : 'more'} store credit`;
  if (concept?.size && conceptWarbonds(alt, concept).length > conceptWarbonds(best, concept).length) {
    const who = conceptWarbonds(alt, concept).filter((a) => !conceptWarbonds(best, concept).some((b) => b.from === a.from)).map((a) => (name ? name(a.from) : 'unknown ship'));
    return `${lead}, prefers a flight-ready Warbond source: ${who.join(', ')} ${who.length === 1 ? 'is a concept ship' : 'are concept ships'} and may rise`;
  }
  if (alt.ownedUsed !== best.ownedUsed) return `${lead}, ${best.ownedUsed > alt.ownedUsed ? `reuses ${plural(best.ownedUsed - alt.ownedUsed, 'more owned CCU')}` : `keeps ${plural(alt.ownedUsed - best.ownedUsed, 'more owned CCU')} free`}`;
  if (alt.steps.length !== best.steps.length) return `${lead}, ${plural(Math.abs(alt.steps.length - best.steps.length), 'step')} ${alt.steps.length > best.steps.length ? 'fewer' : 'more'}`;
  const buys = (r) => r.steps.filter((x) => x.kind !== 'owned').length;
  if (buys(alt) !== buys(best)) return `${lead}, ${plural(Math.abs(buys(alt) - buys(best)), 'purchase')} ${buys(alt) > buys(best) ? 'fewer' : 'more'}`;
  return `${lead} and the same effort; a stable order breaks the tie`;
}

// The decision graph of a goal, cached in the app's planning session (it holds one result per goal, k and day).
export function decisionMemo(app, chainId, k = 5, today = localToday()) {
  const session = sessionOf(app);
  return session.memo('decision', `${chainId}|${k}|${today}`, () => decisionGraph(app, chainId, { k, wanted: session.wanted(chainId), today }));
}

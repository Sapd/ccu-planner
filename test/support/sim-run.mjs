// The day loop and the invariants of the end-to-end simulation (see sim.mjs for the store and the account).
//
// One day of the virtual user, in the order a real person works through the app:
//   1. store changes and the user's own bookkeeping for the day happen (script: record a sale event, set an expected price, top up credit);
//   2. the user reserves every goal that has a route and has not reserved it yet, and switches a reserved goal to the proposed chain
//      when the reserved one is blocked (an offer is gone) or the proposed one needs less new cash (the "Switch" button);
//   3. Today is opened: the policy picks what to buy; every purchase becomes an owned CCU copy; then step 2 again;
//   4. the invariants are checked on the morning plan and on the evening plan.
import assert from 'node:assert/strict';
import { sessionOf } from '../../src/logic/session.mjs';
import { journey } from '../../src/logic/journey.mjs';
import { evaluateAccepted, diffRoutes } from '../../src/logic/chains.mjs';
import { edgeKey } from '../../src/logic/planner.mjs';
import { act, appOf, todayOf, buy, createWorld, newAccount, addGoal, stepKey, goalOrder } from './sim.mjs';

const copyIdsOf = (route) => [...route.steps.filter((s) => s.copyId).map((s) => s.copyId), ...(route.start?.token ? [route.start.token.copyId] : [])];
const sum = (xs) => xs.reduce((n, x) => n + x, 0);

/** What each goal still needs in new cash: today's proposal, per goal that has a route. */
export function remaining(view) {
  const m = new Map();
  for (const g of view.goals) if (g.cash != null) m.set(g.goalId, g.cash);
  return m;
}

// ----- the user's reservation habits -----

/** Reserves goals that have a route; switches a reserved goal to its proposed chain when blocked or cheaper. Returns the notes. */
export function maintain(S, d) {
  const notes = [];
  for (const id of goalOrder(S)) {
    const app = appOf(S, d);
    const route = sessionOf(app).route(id);
    const chain = S.plans.chains[id];
    if (!route) continue;
    if (!chain.accepted) { act(S, { type: 'accept', chainId: id, route }); notes.push(`reserve ${id}`); continue; }
    const ev = evaluateAccepted(S.plans, id, { offers: app.data.offers, owned: app.data.owned, lti: app.graph.lti });
    const differs = diffRoutes(chain.accepted, route).kind !== 'unchanged';
    const cheaper = differs && route.cash < chain.accepted.cash;
    // The user bought a step of the reserved chain: the proposed chain uses the new copy where the reserved one still buys. The app offers
    // no "Switch" button when that costs the same (credit paid it), so this is the user releasing and reserving again.
    const bought = differs && route.steps.some((s) => s.kind === 'owned' && !chain.accepted.steps.some((a) => a.copyId === s.copyId) && chain.accepted.steps.some((a) => a.kind !== 'owned' && a.from === s.from && a.to === s.to));
    if (ev.status === 'blocked' || cheaper || bought) { act(S, { type: 'accept', chainId: id, route }); notes.push(`${ev.status === 'blocked' ? 'rebuild' : cheaper ? 'switch' : 'refresh'} ${id}`); }
  }
  return notes;
}

// ----- buying -----

/** Buys a list of { goalId, step } from one plan snapshot. Standard steps use at most the store credit the plan gave that goal. */
export function execute(S, d, app, list) {
  const session = sessionOf(app);
  const cap = new Map();
  const bought = [];
  for (const { goalId, step } of list) {
    if (!cap.has(goalId)) cap.set(goalId, session.route(goalId)?.creditUsed ?? 0);
    const p = buy(S, d, goalId, step, cap.get(goalId));
    if (p) { cap.set(goalId, cap.get(goalId) - p.credit); bought.push(p); }
  }
  return bought;
}

/** Every purchase of every goal's route, now. */
export function allSteps(app, ids) {
  const session = sessionOf(app);
  return ids.flatMap((id) => (session.route(id)?.steps ?? []).filter((s) => s.kind !== 'owned').map((step) => ({ goalId: id, step })));
}

/**
 * The patient user. Buys every row Today lists under "Buy today"; every row of a goal in finish mode ("get it as soon as possible");
 * and a no-rush or optional row on the last day before its offer is worth less: a Warbond on its last day in the store, a Standard
 * upgrade of an event-only ship on the last day of the event, a Standard upgrade into a ship whose announced price rise comes tomorrow.
 * (The user knows the calendar; the planner only knows the expected price, not the day.) Never buys a later Standard step, a price lock
 * or a no-rush row earlier than that.
 */
export const patient = {
  name: 'patient',
  pick(S, d, view) {
    const spec = S.world.spec;
    const lastDay = (step) => {
      if (step.kind === 'warbond') { const w = spec.warbonds.find((x) => x.id === step.skuId); return w.known !== false && w.end === d; }
      if ((spec.priceChanges ?? []).some((c) => c.ship === step.to && c.day === d + 1 && c.msrp > S.world.msrpOn(step.to, d))) return true;
      const to = spec.ships.find((s) => s.id === step.to);
      return !!to?.eventOnly && spec.events.some((e) => e.to === d);
    };
    return view.buys
      .filter((b) => b.effective === 'today' || S.plans.chains[b.goalId].mode === 'finish' || lastDay(b.step))
      .map((b) => ({ goalId: b.goalId, step: b.step }));
  },
};

/** The impatient user: buys every step of every goal's route as soon as the goal has a route. */
export const impatient = { name: 'impatient' };

// ----- the run -----

/**
 * @param {{ spec: object, goals: object[], script?: Record<number, Array<object>>, policy: object, check?: Function|null }} o
 *   script[d]: user actions (applyAction objects) or { topUp: cents }, done at the start of day d. On the last day every goal is
 *   put in finish mode ("I am done waiting") and everything left is bought.
 * @returns {{ S, ids, rows, trace, firstAnnounced: Map }}
 */
export function runSimulation({ spec, goals, script = {}, policy, check = checkInvariants }) {
  const world = createWorld(spec);
  const S = newAccount(spec, world);
  const ids = goals.map((g) => addGoal(S, g));
  const rows = [];
  const trace = { increases: [], acceptedDiffers: 0 }; // dearer-plan events with their named causes; days an accepted route differs from its proposal
  const firstAnnounced = new Map(); // goal -> { day, cash }
  let prev = null; // the evening before: { R: Map(goal -> cash) }
  const last = spec.days - 1;

  for (let d = 0; d < spec.days; d++) {
    for (const a of script[d] ?? []) {
      if (a.topUp) { act(S, { type: 'setCredit', cents: S.plans.profile.credit + a.topUp }); S.creditIn += a.topUp; } else act(S, a);
    }
    if (d === last) for (const id of ids) if (S.plans.chains[id].mode !== 'finish') act(S, { type: 'setMode', chainId: id, value: 'finish' });

    const notes = maintain(S, d);
    const { app, view } = todayOf(S, d);
    const R0 = remaining(view);
    for (const [id, cash] of R0) if (!firstAnnounced.has(id)) firstAnnounced.set(id, { day: d, cash });
    if (check) check({ S, d, app, view, stage: 'morning', ids, prev, R0, causes: prev ? dayChanges(world, S, d) : [], trace });

    const before = { cash: S.spent.cash, credit: S.spent.credit };
    let bought = [];
    if (d === last || policy.name === 'impatient') {
      // everything, repeated until the plan has nothing left to buy: one goal per round, so the routes are recomputed between goals
      let cur = app;
      for (let round = 0; round < 12; round++) {
        const list = allSteps(cur, goalOrder(S));
        if (!list.length) break;
        const got = execute(S, d, cur, list.filter((x) => x.goalId === list[0].goalId));
        bought.push(...got);
        notes.push(...maintain(S, d));
        cur = appOf(S, d);
        if (!got.length) break;
      }
    } else {
      bought = execute(S, d, app, policy.pick(S, d, view, app));
      notes.push(...maintain(S, d));
    }
    const { app: app2, view: view2 } = todayOf(S, d);
    const R1 = remaining(view2);
    const spentToday = { cash: S.spent.cash - before.cash, credit: S.spent.credit - before.credit };
    if (check) check({ S, d, app: app2, view: view2, stage: 'evening', ids, prev, R0, R1, spentToday, bought, causes: [], trace });
    rows.push({ day: d, date: world.dayStr(d), bought, spentToday, notes, R0, R1, view: view2, credit: S.plans.profile.credit,
      owned: S.owned.length, status: Object.fromEntries(view2.goals.map((g) => [g.goalId, g.status])) });
    const sess2 = sessionOf(app2);
    prev = { R: R1, routeKeys: new Map(ids.filter((id) => sess2.route(id)).map((id) => [id, new Set(sess2.route(id).steps.map(stepKey))])) };
  }
  return { S, ids, rows, trace, firstAnnounced };
}

/** What changed in the store between the evening of day d-1 and the morning of day d: the named causes of a dearer plan. */
export function dayChanges(world, S, d) {
  const out = [];
  const key = (o) => `${o.kind}:${o.from}-${o.to}`;
  const a = new Map(world.offers(d - 1, S.stock).map((o) => [key(o), o]));
  const b = new Map(world.offers(d, S.stock).map((o) => [key(o), o]));
  for (const [k, o] of a) {
    if (!b.has(k)) out.push({ code: o.kind === 'warbond' ? 'offer-gone' : 'standard-gone', key: k });
    else if (b.get(k).cash > o.cash) out.push({ code: 'price-rose', key: k });
  }
  return out;
}

// ----- the invariants -----

const routeSig = (r) => r.steps.map((s) => `${edgeKey(s)}${s.copyId ? `#${s.copyId}` : ''}`).join('|');

/** An accepted record as a route-shaped object. */
function acceptedAsRoute(a) {
  return { steps: a.steps, start: { ship: a.token?.ship ?? a.steps[0]?.from ?? null, token: a.token ? { copyId: a.token.copyId, pledgeId: a.token.pledgeId } : null } };
}

/**
 * Checked on the morning plan (before the user buys) and on the evening plan (after buying and reserving).
 *  1. no owned copy and no starting token is used by two goals (proposals, shared plan and reservations)
 *  2. store credit is only spent on Standard steps, never goes negative, and adds up; the plan never uses more credit than there is
 *  3. every route only uses what exists that day: owned copies, offers at their price, a token pledge in the pool
 *  4. (money) buying never makes the plan dearer by more than the cash paid; overnight a goal's announced cash goes up only with a named store change
 *  7. Today, the journey and the advice list the same steps to buy; the shared plan's route is the proposal
 * plus: a reservation never goes stale (no reserved goal is blocked) after the user's evening bookkeeping.
 */
export function checkInvariants(ctx) {
  const { S, d, app, view, stage, ids, prev, R0, R1, spentToday, causes, trace } = ctx;
  const at = `day ${d} ${stage}`;
  const session = sessionOf(app);
  const dayStr = S.world.dayStr(d);
  const offers = app.data.offers;
  const ownedBy = new Map(S.owned.map((c) => [c.copyId, c]));
  const routes = ids.map((id) => [id, session.route(id)]).filter(([, r]) => r);

  // 1. nothing is used twice
  const holder = new Map();
  const claim = (key, id, what) => { assert.ok(!holder.has(key) || holder.get(key) === id, `${at}: ${what} ${key} is used by ${holder.get(key)} and ${id}`); holder.set(key, id); };
  for (const [id, r] of routes) for (const c of copyIdsOf(r)) claim(c, id, 'copy/token');
  holder.clear();
  for (const [id, e] of session.shared) if (e.route) for (const c of copyIdsOf(e.route)) claim(c, id, 'copy/token (shared plan)');
  holder.clear();
  for (const id of ids) if (S.plans.chains[id].accepted) for (const c of copyIdsOf(acceptedAsRoute(S.plans.chains[id].accepted))) claim(c, id, 'copy/token (reserved)');

  // 2. credit
  assert.ok(S.plans.profile.credit >= 0, `${at}: credit went negative`);
  assert.equal(S.plans.profile.credit + S.spent.credit, S.creditIn, `${at}: credit does not add up`);
  for (const p of S.purchases) {
    assert.ok(p.credit === 0 || p.kind === 'standard', `a Warbond was paid with credit: ${JSON.stringify(p)}`);
    assert.ok(p.credit >= 0 && p.cash >= 0 && p.credit + p.cash === p.price, `purchase money does not add up: ${JSON.stringify(p)}`);
  }
  assert.ok(sum(routes.map(([, r]) => r.creditUsed)) <= S.plans.profile.credit, `${at}: the plan uses more store credit than there is`);
  for (const [id, r] of routes) assert.ok(r.creditUsed <= sum(r.steps.filter((s) => s.kind === 'standard').map((s) => s.cash)), `${at}: ${id} uses credit on something that is not Standard`);

  // 3. routes only use what exists today
  const pool = new Set(app.graph.lti.map((t) => t.pledgeId));
  for (const [id, r] of routes) {
    if (r.start?.token) assert.ok(pool.has(r.start.token.pledgeId), `${at}: ${id} starts from a token that is not in the hangar`);
    let here = r.start.ship;
    for (const s of r.steps) {
      assert.equal(s.from, here, `${at}: ${id} route is not a chain at ${stepKey(s)}`);
      here = s.to;
      if (s.kind === 'owned') {
        const c = ownedBy.get(s.copyId);
        assert.ok(c && c.from === s.from && c.to === s.to, `${at}: ${id} uses a copy you do not own: ${s.copyId} ${stepKey(s)}`);
      } else assert.ok(offers.some((o) => o.kind === s.kind && o.from === s.from && o.to === s.to && o.cash === s.cash), `${at}: ${id} uses an offer that is not in the store: ${stepKey(s)} $${s.cash}`);
    }
    assert.equal(here, S.plans.chains[id].target, `${at}: ${id} route does not end at its target`);
  }

  // 7. the pages agree
  const keysOf = (xs) => xs.map(stepKey).sort();
  for (const g of view.goals) {
    const route = session.route(g.goalId);
    const mine = view.buys.filter((b) => b.goalId === g.goalId);
    if (!route) { assert.equal(mine.length, 0, `${at}: ${g.goalId} has no route but Today lists purchases`); continue; }
    const chain = S.plans.chains[g.goalId];
    const adv = session.advice(g.goalId, { route, day: dayStr });
    const j = journey(route, chain, { session, advice: adv, ships: app.data.ships, overrides: app.overrides, expected: app.expected, avail: session.avail(dayStr), warbondPrices: null, saleEvents: null });
    assert.deepEqual(keysOf(mine.map((b) => b.step)), keysOf(adv.buys.map((b) => b.step)), `${at}: Today and the advice list different purchases for ${g.goalId}`);
    assert.deepEqual(keysOf(j.steps.filter((x) => x.state === 'now').map((x) => x.step)), keysOf(adv.buys.map((b) => b.step)), `${at}: the journey and the advice list different purchases for ${g.goalId}`);
    assert.deepEqual(keysOf(g.journey.steps.filter((x) => x.state === 'now').map((x) => x.step)), keysOf(adv.buys.map((b) => b.step)), `${at}: the journey on Today differs from the advice for ${g.goalId}`);
    const shared = session.shared.get(g.goalId);
    if (!chain.accepted) assert.equal(routeSig(shared.route), routeSig(route), `${at}: the shared plan and the proposal of ${g.goalId} differ`);
    else if (routeSig(acceptedAsRoute(chain.accepted)) !== routeSig(route)) trace.acceptedDiffers++;
  }
  assert.equal(view.hero.buyCount, view.buys.filter((b) => b.effective === 'today').length, `${at}: the hero counts different purchases than the buy list`);

  if (stage === 'evening') {
    // a reservation never goes stale
    for (const id of ids) {
      if (!S.plans.chains[id].accepted) continue;
      const ev = evaluateAccepted(S.plans, id, { offers, owned: S.owned, lti: app.graph.lti });
      assert.notEqual(ev.status, 'blocked', `${at}: the reservation of ${id} is blocked after the user's bookkeeping: ${JSON.stringify(ev.issues)}`);
    }
    // 4a. buying makes nothing dearer: the plan after the purchases needs what it needed minus the cash just paid
    for (const id of R0.keys()) assert.ok(R1.has(id), `${at}: ${id} had a route this morning and has none after buying`);
    const before = sum([...R0.values()]);
    const after = sum([...R1].filter(([id]) => R0.has(id)).map(([, c]) => c));
    assert.ok(after <= before - spentToday.cash, `${at}: the plan needs $${after / 100} after buying for $${spentToday.cash / 100}, it needed $${before / 100} before`);
  } else if (prev) {
    for (const id of prev.R.keys()) assert.ok(R0.has(id), `${at}: ${id} had a route yesterday evening and has none this morning`);
    // 4b. overnight: a goal's announced cash goes up only when the store changed in a way the app can name: an offer left (Warbond or
    // Standard) or a price rose. A higher-priority goal taking a copy needs no entry: reservations are made by the user in the evening,
    // and the evening checks cover what that does.
    for (const [id, c] of R0) {
      if (!prev.R.has(id)) continue; // newly routable: announced for the first time
      if (c > prev.R.get(id)) {
        // the best route of yesterday evening cost what it cost: it only gets dearer when one of its own offers left or rose
        const named = causes.filter((x) => prev.routeKeys.get(id)?.has(x.key));
        trace.increases.push({ day: d, goal: id, was: prev.R.get(id), now: c, causes: named });
        assert.ok(named.length > 0, `${at}: ${id} needs $${c / 100} now, it needed $${prev.R.get(id) / 100} yesterday evening, and no offer of its route left or rose (${JSON.stringify(causes)})`);
      }
    }
  }
}

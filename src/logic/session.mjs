// One planning session: everything derived from one set of documents (data, plans, overrides, sale
// events), computed once and dropped together. withDocs (the app) and the CLI build a new session
// whenever a document changes, so nothing here needs a key for plans.rev, overrides.rev or
// events.rev. Only the day (availability changes with it) and call parameters (k, slack) are keys.
//
// Lazy fields: `shared` (planGoals), `proposal(id, k)`, `route(id)`, `alone(id)`, `sharedEffect(id)`, `levels()`, `advice(id)`, `cover(id, route)`,
// `wanted(id)`, `avail(day)`. sessionOf(app) is the session of an app object; sessionFor(app) is the same for reading, also for an app
// that cannot take a session (frozen in a test): the one place that rule lives. Views cache their own results with `memo(namespace, key, compute)`; lock.mjs and
// priceChange.mjs keep their working data in `scratch(name, init)`.
import { planGoals, proposeChain, proposeFleet } from './sharedPlan.mjs';
import { lockCover } from './lock.mjs';
import { routeAdvice } from './advice.mjs';
import { wantedWarbonds } from './wanted.mjs';
import { warbondUsage } from './warbonds.mjs';
import { availCtx, localToday } from './availability.mjs';
import { aloneRoute, sharedEffect, planningLevels } from './sharedEffect.mjs';
import { withVirtualCcus } from './planner.mjs';
import { getLocale } from './i18n.mjs';

/** The graph goals are planned on: the store-and-hangar graph plus your virtual CCUs that have not expired on `today`. */
export const planningGraph = (graph, plans, today = localToday()) => withVirtualCcus(graph, plans?.profile?.virtualCcus, today);

export const MEMO_MAX = 16;

/** Cached compute(): a hit moves to the newest position; past `max` entries the oldest is dropped. */
export function memoized(memo, key, compute, max = MEMO_MAX) {
  if (memo.has(key)) { const hit = memo.get(key); memo.delete(key); memo.set(key, hit); return hit; }
  const result = compute();
  memo.set(key, result);
  if (memo.size > max) memo.delete(memo.keys().next().value);
  return result;
}

/**
 * @param {{ plans: object, graph: object, data?: object|null, overrides?: object|null, saleEvents?: object|null, expected?: object[]|null, maxSteps?: number }} docs
 * `data` is needed for avail() and wanted(); `maxSteps` is the planner's step limit.
 */
export function createSession({ plans, graph, data = null, overrides = null, saleEvents = null, expected = null, maxSteps = 25 }) {
  const memos = new Map(); // namespace -> Map(key -> value)
  const scratches = new Map();
  let shared = null;
  const session = {
    plans, graph, data, overrides, saleEvents, expected, maxSteps,
    /** Revision stamp of the documents this session was built for (see sessionOf). */
    revs: revStamp({ plans, overrides, saleEvents }),
    /** planGoals for these documents: Map(chainId -> { exclude, credit, route, noToken }). */
    get shared() { return (shared ??= planGoals(plans, graph, { maxSteps })); },
    /** Cached result of compute() in `namespace` under `key`, at most `max` entries per namespace. */
    memo(namespace, key, compute, max = Math.max(MEMO_MAX, 3 * Object.keys(plans.chains ?? {}).length)) {
      // Views cache texts too: each language keeps its own results.
      const ns = `${getLocale()}:${namespace}`;
      let m = memos.get(ns);
      if (!m) memos.set(ns, (m = new Map()));
      return memoized(m, key, compute, max);
    },
    /** A working object that lives as long as the session. `reset` replaces it. */
    scratch(name, init, reset = false) {
      if (reset || !scratches.has(name)) scratches.set(name, init());
      return scratches.get(name);
    },
    /** The availability context for a local day. */
    avail(day = localToday()) {
      return session.memo('avail', day, () => availCtx({ data, saleEvents, overrides }, day));
    },
    /** proposeChain for one goal inside the shared plan. */
    proposal(chainId, k = 1) {
      return session.memo('proposal', `${chainId}|${k}`, () => proposeChain(plans, chainId, graph, { k, maxSteps, plan: session.shared }));
    },
    /** The goal's best route in the shared plan, or null. */
    route(chainId) {
      return session.proposal(chainId, 1).routes[0] ?? null;
    },
    /** The goal's best route with nothing taken by other goals (sharedEffect.mjs), or null. */
    alone(chainId) {
      return session.memo('alone', chainId, () => aloneRoute(session, chainId));
    },
    /** What sharing costs the goal and who holds what its alone route would use (sharedEffect.mjs). */
    sharedEffect(chainId) {
      return session.memo('shared-effect', chainId, () => sharedEffect(session, chainId));
    },
    /** Goals by priority level, in planning order: [{ priority, ids }]. */
    levels() {
      return session.memo('levels', '', () => planningLevels(session));
    },
    /** proposeFleet for all goals (the Goals page's fleet summary). */
    fleet() {
      return session.memo('fleet', '', () => proposeFleet(plans, graph, { maxSteps, plan: session.shared }));
    },
    /** "from-to" -> goal ids whose best route uses that Warbond (warbonds.mjs). */
    warbondUsage() {
      return session.memo('warbond-usage', '', () => warbondUsage(session));
    },
    /**
     * routeAdvice (advice.mjs) for a goal's route (default: its best route) on a local day, or null without a route.
     * Cached per route object and day, so every page that asks gets the same answer object.
     */
    advice(chainId, { route = session.route(chainId), day = localToday() } = {}) {
      if (!route) return null;
      const byRoute = session.scratch('advice', () => new WeakMap());
      let days = byRoute.get(route);
      if (!days) byRoute.set(route, (days = new Map()));
      if (!days.has(day)) {
        const env = { ships: data?.ships ?? null, overrides, expected: expected ?? data?.offers ?? [], avail: session.avail(day) };
        days.set(day, routeAdvice(session, plans.chains[chainId], route, env));
      }
      return days.get(day);
    },
    /** lockCover for `route`; see lock.mjs. */
    cover(chainId, route, opts) {
      return lockCover(session, chainId, route, opts);
    },
    /** wantedWarbonds for one goal (slack in cents). `onProgress({ done, total })` is only called when the search really runs (not on a cache hit). */
    wanted(chainId, slack = 1000, { onProgress = null } = {}) {
      return session.memo('wanted', `${chainId}|${slack}`, () => wantedWarbonds(plans, chainId, graph, data.ships, { slack, maxSteps, plan: session.shared, onProgress }));
    },
  };
  return session;
}

const revStamp = ({ plans, overrides, saleEvents }) => `${plans?.rev ?? 0}|${overrides?.rev ?? 0}|${saleEvents?.rev ?? 0}${saleEvents?.feedAt ? `|${saleEvents.feedAt}` : ''}`;

/**
 * The session of an app object ({ plans, graph, data, overrides, saleEvents, expected, session? }).
 * withDocs attaches one; an app built by hand (tests) gets one on first use. A session is reused only
 * while the app still holds the same documents at the same revisions, otherwise a new one replaces it.
 */
export function sessionOf(app) {
  const s = app.session;
  const same = (a, b) => (a ?? null) === (b ?? null);
  if (s && s.plans === app.plans && s.graph === app.graph && same(s.data, app.data) && same(s.overrides, app.overrides)
    && same(s.saleEvents, app.saleEvents) && same(s.expected, app.expected) && s.revs === revStamp(app)) return s;
  return (app.session = createSession(app));
}

/** The session of `app` for reading: sessionOf, or for an app that cannot take a session (frozen in a test) a loose one. */
export const sessionFor = (app) => (Object.isExtensible(app) ? sessionOf(app) : (app.session ?? createSession(app)));

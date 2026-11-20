// The journey of one route: each step is own, buy now or wait for a sale, with
// money figures and the alert text. Pure: the caller passes ships, overrides,
// expected prices, availability and the saved Warbond prices. Which steps lock,
// wait or get an alert comes from routeAdvice; this only formats it.
import { startShip } from './chains.mjs';
import { routeAdvice } from './advice.mjs';
import { shipAvailability } from './availability.mjs';
import { seenSalePrice, warbondDiscounts } from './salePrices.mjs';
import { lockReasonText, waitReasonText, lockTradeText } from './describe.mjs';

const MIN_RUN = 3; // this many consecutive owned steps collapse into one group

/**
 * @param {object|null} route planner route ({ steps })
 * @param {object|null} chain saved goal ({ start, target, mode, lock })
 * @param {{ session?: object|null (a planning session: lets an owned CCU into the target cover a lock and checks what waiting costs), ships?: Map, overrides?: object|null, expected?: object[], avail?: object|null, warbondPrices?: object|null, saleEvents?: object|null, advice?: object (the routeAdvice of this route and goal, when the caller has it) }} ctx
 */
export function journey(route, chain, ctx = {}) {
  const { session = null, advice = null, ships = null, overrides = null, expected = [], avail = null, warbondPrices = null, saleEvents = null } = ctx;
  const msrp = (id) => ships?.get(id)?.msrp ?? null;
  const from = chain ? startShip(chain, route) : null;
  const fullPrice = chain && from != null && msrp(chain.target) != null && msrp(from) != null ? msrp(chain.target) - msrp(from) : null;

  if (!route) {
    return {
      steps: [], groups: [], bar: { unit: 'steps', own: 0, now: 0, norush: 0, optional: 0, wait: 0 },
      figures: { fullPrice, today: 0, ifSales: null, salesSeen: false, estimate: null, saveToday: null, saveIfSales: null },
      done: false,
    };
  }

  const adv = advice ?? routeAdvice(session, chain, route, { ships, overrides, expected, avail });
  const finish = adv.finish;
  const lockText = adv.lockCode ? lockReasonText(adv.lockCode, { event: adv.lockEvent }) : null;
  const alertOf = new Map(adv.alerts.map((a) => [a.step, a.text]));

  // Every purchase to make now (urgent or not, a lock, or a later step waiting would make dearer) is in adv.buys.
  const buyOf = new Map(adv.buys.map((b) => [b.step, b]));
  const stateOf = (s) => {
    if (s.kind === 'owned') return 'own';
    return buyOf.has(s) ? 'now' : 'wait';
  };
  const targetName = chain ? ships?.get(chain.target)?.name ?? 'the target' : null;

  const steps = route.steps.map((s) => {
    const state = stateOf(s);
    const buy = buyOf.get(s) ?? null;
    const lock = !!buy?.lock;
    const seen = state === 'wait' ? seenSalePrice(warbondPrices, s.from, s.to, saleEvents) : null;
    let reason = null;
    if (lock) reason = lockText;
    else if (state === 'wait') reason = waitReason(s, seen, ships, avail);
    const a = msrp(s.to);
    const b = msrp(s.from);
    const trade = lock ? lockTradeText({ targetName, cash: s.cash, code: adv.lockCode, event: adv.lockEvent, extraCash: adv.dec.cover?.extraCash ?? null }) : null;
    return {
      step: s, state, lock, reason, cover: s === adv.dec.coveredStep ? adv.coverText : null, alert: alertOf.get(s) ?? null, seen, value: a == null || b == null ? null : a - b, token: false,
      urgency: buy?.bucket ?? null, urgencyReasons: buy?.reasons ?? [], since: buy?.since ?? null, until: buy?.until ?? null, untilBy: buy?.untilBy ?? null, note: buy?.note ?? null, trade,
    };
  });
  // A route that starts from an LTI token: its first step is the token's upgrade (proposals carry start.token, accepted routes token).
  const tk = route.start?.token ?? route.token ?? null;
  if (tk && steps.length) steps[0].token = true;

  // today is what you pay in new money: the planner's route.cash, net of store credit.
  const today = route.cash;
  const lowerSeen = steps.filter((x) => x.state === 'wait' && x.seen && x.seen.cash < x.step.cash);
  const ifSales = !finish && lowerSeen.length ? Math.max(0, today - lowerSeen.reduce((n, x) => n + (x.step.cash - x.seen.cash), 0)) : null;
  // No sale price seen yet: estimate from the usual Warbond discount in your own history (a range, not a promise).
  let estimate = null;
  const waitingStd = steps.filter((x) => x.state === 'wait' && x.step.kind === 'standard');
  const usual = !finish && ifSales == null && waitingStd.length ? warbondDiscounts(warbondPrices, ships) : null;
  if (usual) {
    const total = waitingStd.reduce((n, x) => n + x.step.cash, 0);
    const at = (d) => Math.max(0, today - Math.round(total * d));
    estimate = { typical: at(usual.median), low: at(usual.high), high: at(usual.low), n: usual.n };
  }
  const figures = {
    fullPrice, today, ifSales, salesSeen: ifSales != null, estimate,
    saveToday: fullPrice == null ? null : fullPrice - today,
    saveIfSales: fullPrice == null || ifSales == null ? null : fullPrice - ifSales,
  };

  // One unit everywhere: upgrades (steps). A purchase is split by its real urgency, so the bar and its legend say what each step is.
  const count = (f) => steps.filter(f).length;
  const bar = {
    unit: 'steps',
    own: count((x) => x.state === 'own'),
    now: count((x) => x.state === 'now' && x.urgency !== 'norush' && x.urgency !== 'optional'),
    norush: count((x) => x.state === 'now' && x.urgency === 'norush'),
    optional: count((x) => x.state === 'now' && x.urgency === 'optional'),
    wait: count((x) => x.state === 'wait'),
  };

  return { steps, groups: groupRuns(steps), bar, figures, done: steps.length > 0 && steps.every((x) => x.state === 'own') };
}

/**
 * Which plain reason a waiting step has when no lower sale price was seen:
 * 'event-only' (only known on sale during an event), 'off-store' (no Standard SKU today) or 'normal'.
 */
function waitReasonKind(step, ships, avail) {
  const a = shipAvailability(avail, step.to);
  if (a.status === 'event-only' && a.event) return 'event-only';
  if (a.status === 'off-sale' || ships?.get(step.to)?.standard === false) return 'off-store';
  return 'normal';
}

/** Why a waiting step waits: a lower sale price seen, else waitReasonKind's text. */
function waitReason(s, seen, ships, avail) {
  if (seen && seen.cash < s.cash) return waitReasonText('seen', { event: seen.event, seen, cash: s.cash });
  const kind = waitReasonKind(s, ships, avail);
  if (kind === 'event-only') return waitReasonText(kind, { event: shipAvailability(avail, s.to).event });
  return waitReasonText(kind, { cash: s.cash });
}

/** Step groups in route order; runs of at least MIN_RUN owned steps collapse into one 'owned-run'. */
function groupRuns(steps) {
  const groups = [];
  let i = 0;
  while (i < steps.length) {
    let end = i;
    if (steps[i].state === 'own') while (end + 1 < steps.length && steps[end + 1].state === 'own') end++;
    if (end - i + 1 >= MIN_RUN) {
      groups.push({ kind: 'owned-run', from: i, to: end, count: end - i + 1 });
      i = end + 1;
    } else {
      groups.push({ kind: 'step', index: i });
      i++;
    }
  }
  return groups;
}

/**
 * Where a chain's "new cash still needed" comes from. `steps` are the journey's steps and `route` its route; `paidOf`
 * maps a copyId to the cents you paid for that CCU (or null/undefined when unknown).
 * owned: upgrades you own in this chain, with the sum of what you paid for those whose price is known (paidKnown of count);
 * purchases: the upgrades still to buy with their list price at today's offers; credit: store credit applied to them;
 * cash: what is left to pay (the route's cash, so purchases.cash - credit).
 */
export function cashBreakdown(steps, route, paidOf = () => null) {
  const own = steps.filter((x) => x.state === 'own');
  const buy = steps.filter((x) => x.state !== 'own');
  const paid = own.map((x) => paidOf(x.step.copyId)).filter((c) => c != null);
  return {
    owned: { count: own.length, paid: paid.reduce((n, c) => n + c, 0), paidKnown: paid.length },
    purchases: { count: buy.length, cash: buy.reduce((n, x) => n + x.step.cash, 0) },
    credit: route?.creditUsed ?? 0,
    cash: route?.cash ?? 0,
  };
}

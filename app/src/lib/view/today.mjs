// What to do today, across all watch chains. Pure.
import { startShip, startOf, diffRoutes, PRIORITY } from '../../../../src/logic/chains.mjs';
import { startLineText, bestDiffers, waitReasonText, alertDetailText, neededBecauseText, paymentText, creditLineText, LIMITED_IGNORED_NOTE, standardPriceText, urgencyReasonText, onSaleText, buyCountText, forGoalsText, buyListEnd, otherGroupsLine } from '../../../../src/logic/describe.mjs';
import { isSaturated } from '../../../../src/logic/urgency.mjs';
import { tieNoteFor } from '../../../../src/logic/decision.mjs';
import { localToday, ongoingEvent } from '../../../../src/logic/availability.mjs';
import { sessionOf } from '../../../../src/logic/session.mjs';
import { journey } from '../../../../src/logic/journey.mjs';
import { edgeKey } from '../../../../src/logic/planner.mjs';
import { neededBecause } from '../../../../src/logic/sharedEffect.mjs';
import { meltView } from './hangar.mjs';

/** The one-click "Don't lock this goal" action of a lock row. */
export const dontLockAction = (chainId) => ({ type: 'setLock', chainId, value: 'off' });
/** Your note on a buy row's offer: "runs until <day>" or "ends soon" (urgency.mjs), and clearing it. */
export const offerNoteAction = (row, note) => ({ type: 'setOfferEnd', from: row.from, to: row.to, ...note });
export const clearOfferNoteAction = (row) => ({ type: 'clearOfferEnd', from: row.from, to: row.to });

/**
 * The Today home page. Every goal's journey (the planner's proposal, not the accepted route),
 * the buy-now steps, the waiting steps with their alerts and the melt summary.
 * Cached in the app's planning session per local day.
 */
export function todayView(app, today = localToday()) {
  return sessionOf(app).memo('today', today, () => computeTodayView(app, today));
}

function computeTodayView(app, today) {
  const { plans, overrides, data, expected } = app;
  const session = sessionOf(app);
  const avail = session.avail(today);
  const ongoing = ongoingEvent(avail.saleEvents, today);
  const event = ongoing ? { name: ongoing.name, to: ongoing.to } : null;
  const goalChains = Object.values(plans.chains).sort((a, b) => priorityOf(a) - priorityOf(b) || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)) || a.id.localeCompare(b.id));

  const goals = [];
  const buys = [];
  const alerts = [];
  const eventOnly = [];
  const waitGoals = [];
  const noticeSrc = []; // { order, idx, from, to, goalId, kind: 'event'|'alert', text }
  let waitCount = 0;
  for (const chain of goalChains) {
    const proposal = session.proposal(chain.id, 1);
    const [route] = proposal.routes;
    const advice = route ? session.advice(chain.id, { route, day: today }) : null;
    const j = journey(route ?? null, chain, {
      session, advice, ships: data.ships, overrides, expected, avail, warbondPrices: data.warbondPrices ?? null, saleEvents: avail.saleEvents,
    });
    const differs = bestDiffers(chain.accepted, route, diffRoutes);
    // sharedEffect searches again for the alone route: only when a card or a step asks for it.
    const fx = () => session.sharedEffect(chain.id);
    // "Buy today" counts only the urgent purchases; the rest are no-rush or optional (routeAdvice.buys).
    const countOf = (bucket) => j.steps.filter((x) => x.state === 'now' && x.urgency === bucket).length;
    const buyCount = countOf('today');
    const noRushCount = countOf('norush');
    const optionalCount = countOf('optional');
    const waitN = j.steps.filter((x) => x.state === 'wait').length;
    const status = proposal.noToken ? 'no-token' : !route ? 'no-route' : j.done ? 'done' : buyCount ? 'buy' : noRushCount || optionalCount ? 'norush' : 'wait';
    const start = startOf(chain);
    const tokenUsed = route?.start?.token ? { pledgeId: route.start.token.pledgeId, ship: route.start.ship } : null;
    const sName = (id) => data.ships?.get(id)?.name ?? 'unknown ship';
    // Nothing to say about a token goal that found no route for another reason than a missing token.
    const startLine = start.kind === 'ship' ? startLineText(start, null, sName(start.ship))
      : tokenUsed ? startLineText(start, tokenUsed, sName(tokenUsed.ship))
      : proposal.noToken ? startLineText(start, null, null) : null;
    // The journey of the chain that counts: the reserved chain when the goal has one (the plan total, the Goals list and
    // the goal panel all count it), else the proposed chain. Built only when asked: most callers never need it.
    let countedJ = null;
    const counted = () => countedJ ??= (chain.accepted && differs
      ? journey(chain.accepted, chain, { session, ships: data.ships, overrides, expected, avail, warbondPrices: data.warbondPrices ?? null, saleEvents: avail.saleEvents })
      : j);
    goals.push({ get counted() { return counted(); }, goalId: chain.id, cash: route?.cash ?? null, acceptedCash: chain.accepted ? (chain.accepted.cash ?? null) : null,
      // What the plan total counts for this goal: an accepted goal at the price it was accepted at, the others at today's route.
      countedCash: chain.accepted ? (session.shared.get(chain.id)?.route?.cash ?? chain.accepted.cash ?? null) : (route?.cash ?? null), get aloneCash() { const e = fx(); return e.extra > 0 ? e.alone.cash : null; }, name: chain.name ?? chain.id, targetName: data.ships?.get(chain.target)?.name ?? chain.name ?? chain.id, start, startLine, targetId: chain.target, journey: j, status, buyCount, noRushCount, optionalCount, waitCount: waitN,
      startShip: startShip(chain, route ?? null), token: tokenUsed, noToken: proposal.noToken });

    const order = goalChains.indexOf(chain);
    const nm = (id) => data.ships?.get(id)?.name ?? 'unknown ship';
    for (const x of j.steps) {
      if (x.state === 'now') {
        // A goal with an accepted route holds its CCUs: nothing is "needed because" of others there.
        buys.push({ goalId: chain.id, step: x.step, lock: x.lock, reason: x.reason, urgency: x.urgency, urgencyReasons: x.urgencyReasons, since: x.since, until: x.until, untilBy: x.untilBy, note: x.note, trade: x.trade, differs,
          // The goal has a reserved chain and this step is not in it: buying it is not part of what the plan total counts.
          outsideReserved: !!chain.accepted && !chain.accepted.steps.some((a) => edgeKey(a) === edgeKey(x.step)),
          get needed() { const why = chain.accepted ? null : neededBecause(fx(), x.step); return why ? neededBecauseText(why, { name: nm }) : null; } });
      }
      if (x.state === 'wait') { waitCount++; if (!waitGoals.includes(chain.id)) waitGoals.push(chain.id); }
      if (x.alert != null) {
        alerts.push({ goalId: chain.id, step: x.step, text: x.alert });
        if (x.state === 'now') continue; // a step to buy today is in the buy list, not in the waiting notices
        noticeSrc.push({ order, idx: route.steps.indexOf(x.step), from: x.step.from, to: x.step.to, goalId: chain.id, kind: 'alert', text: alertDetailText(x.alert, nm(x.step.from), nm(x.step.to)) });
      }
    }

    // Later Standard steps into a ship only known on sale during the ongoing event (watch goals only).
    if (advice && !advice.finish) {
      for (const a of advice.alerts) {
        if (a.reason === 'event' && !advice.buys.some((b) => b.step === a.step)) {
          const ev = { name: a.event.name, to: a.event.to };
          eventOnly.push({ goalId: chain.id, step: a.step, event: ev });
          noticeSrc.push({ order, idx: route.steps.indexOf(a.step), from: a.step.from, to: a.step.to, goalId: chain.id, kind: 'event', text: waitReasonText('event-only', { event: ev }) });
        }
      }
    }
  }

  // One line per distinct from-to pair; the event-only sentence wins over the alert text.
  const byPair = new Map();
  for (const n of noticeSrc.sort((a, b) => a.order - b.order || a.idx - b.idx)) {
    const k = `${n.from}>${n.to}`;
    let e = byPair.get(k);
    if (!e) byPair.set(k, (e = { from: n.from, to: n.to, goals: [], text: n.text, eventOnly: n.kind === 'event' }));
    if (!e.goals.includes(n.goalId)) e.goals.push(n.goalId);
    if (n.kind === 'event' && !e.eventOnly) { e.text = n.text; e.eventOnly = true; }
  }
  const notices = [...byPair.values()];

  // The buy list: one row per (kind, from, to, cash) across goals, so a pair never shows in two groups. The row takes the
  // most urgent group of its goals; a goal whose step is only a lock stays optional and is listed in the row's trades.
  // "buy N" = the goals that need a copy now. Each goal's counts are then taken from the row's group, so the headline,
  // the goal cards and the rows always agree.
  const RANK = { today: 0, norush: 1, optional: 2 };
  const credit = plans.profile?.credit ?? 0;
  const standardOf = (from, to) => {
    let best = null;
    for (const o of data.offers ?? []) if (o.kind === 'standard' && o.from === from && o.to === to && (best == null || o.cash < best)) best = o.cash;
    return best;
  };
  const rowMap = new Map();
  for (const b of buys) {
    const { step } = b;
    const kind = step.virtual ? 'virtual' : step.kind;
    const key = `${kind}|${step.from}-${step.to}|${step.cash}`;
    let row = rowMap.get(key);
    if (!row) {
      const std = kind === 'warbond' ? standardOf(step.from, step.to) : null;
      row = {
        key, bucket: b.urgency, kind, note: b.note, virtualNote: step.virtual ? step.note ?? null : null, from: step.from, to: step.to, cash: step.cash, count: 0, goals: [], lock: true,
        payment: paymentText(kind), standardText: std != null ? standardPriceText(std) : null,
        reasons: [], since: null, until: null, untilBy: null, onSale: '', trades: [], steps: [],
        get needed() { return [...new Set(this.steps.map((x) => x.needed).filter(Boolean))]; },
        get tie() { return this.steps.map((x) => tieNoteFor(session, x.goalId, x.step)).find(Boolean) ?? null; },
      };
      rowMap.set(key, row);
    }
    row.steps.push(b);
    if (RANK[b.urgency] < RANK[row.bucket]) row.bucket = b.urgency;
  }
  const rowList = [...rowMap.values()];
  const gNameOf = (id) => goals.find((g) => g.goalId === id)?.targetName ?? 'a goal';
  for (const r of rowList) {
    for (const b of r.steps) {
      b.effective = b.urgency === 'optional' ? 'optional' : r.bucket;
      if (b.lock && b.trade) r.trades.push({ goalId: b.goalId, goalName: gNameOf(b.goalId), text: b.trade, action: dontLockAction(b.goalId) });
      if (b.effective === 'optional' && r.bucket !== 'optional') continue; // only listed as a trade
      r.goals.push({ goalId: b.goalId, name: gNameOf(b.goalId) });
      r.count++;
      if (!b.lock) r.lock = false;
      for (const x of b.urgencyReasons ?? []) if (!r.reasons.some((y) => y.code === x.code)) r.reasons.push(x);
      r.since ??= b.since; r.until ??= b.until; r.untilBy ??= b.untilBy;
    }
    r.onSale = r.lock ? '' : onSaleText({ kind: r.kind, since: r.since, until: r.until, untilBy: r.untilBy });
    r.countText = buyCountText(r.count);
    r.forText = forGoalsText(r.goals.map((g) => g.name));
    r.reasonTexts = r.reasons.map(urgencyReasonText);
    r.detail = [r.payment, r.standardText, r.forText].filter(Boolean).join(' · ');
  }
  // A goal's counts come from the rows: its step is in its row's group.
  for (const g of goals) {
    const mine = buys.filter((b) => b.goalId === g.goalId);
    const n = (bucket) => mine.filter((b) => b.effective === bucket).length;
    g.buyCount = n('today'); g.noRushCount = n('norush'); g.optionalCount = n('optional');
    if (g.status === 'buy' || g.status === 'norush' || g.status === 'wait') g.status = g.buyCount ? 'buy' : g.noRushCount || g.optionalCount ? 'norush' : 'wait';
  }
  const inBucket = (bk) => rowList.filter((r) => r.bucket === bk);
  const buyList = { today: inBucket('today'), norush: inBucket('norush'), optional: inBucket('optional') };
  buyList.creditLine = credit > 0 && rowList.some((r) => r.kind === 'standard') ? creditLineText(credit) : null;
  // The limited mark is ignored for a kind whose offers nearly all carry it; say so once when that kind is in the list.
  const share = data.meta?.limitedShare;
  buyList.limitedNote = share && rowList.some((r) => isSaturated(share[r.kind] ?? 0)) ? LIMITED_IGNORED_NOTE : null;
  const todayCount = buyList.today.reduce((n, r) => n + r.count, 0);
  const otherRows = [...buyList.norush, ...buyList.optional];
  const otherCount = otherRows.reduce((n, r) => n + r.count, 0);
  const otherCash = otherRows.reduce((n, r) => n + r.count * (r.cash ?? 0), 0);
  buyList.end = buyListEnd(todayCount, otherCount);

  const todayBuys = buys.filter((b) => b.effective === 'today');
  const buyCash = todayBuys.reduce((n, b) => n + (b.step.cash ?? 0), 0);
  const goalsTouched = [...new Set(todayBuys.map((b) => b.goalId))];
  const hero = goals.find((g) => g.buyCount > 0) ?? goals[0] ?? null;
  const nothing = todayBuys.length === 0;
  let nothingWhy = null;
  if (nothing && goals.length) {
    if (goals.every((g) => g.status === 'done')) nothingWhy = 'all-owned';
    else if (goals.every((g) => g.status === 'no-route' || g.status === 'no-token')) nothingWhy = goals.some((g) => g.status === 'no-route') ? 'no-route' : 'no-token';
    else if (buys.length) nothingWhy = 'no-rush';
    else nothingWhy = 'waiting';
  }
  const otherLine = otherGroupsLine({ norush: buyList.norush.reduce((n, r) => n + r.count, 0), optional: buyList.optional.reduce((n, r) => n + r.count, 0) });

  const p = meltView(app, { today }).plan;
  const melt = p.candidates.length ? { count: p.candidates.length, credit: p.candidateCredit } : null;

  return {
    empty: goals.length === 0,
    hero: {
      goalId: hero?.goalId ?? null,
      shipId: hero?.targetId ?? null,
      buyCount: todayBuys.length,
      buyCash,
      otherLine,
      otherCount,
      otherCash,
      goalsTouched,
      nothing,
      nothingWhy,
    },
    buys,
    buyList,
    waiting: {
      count: waitCount,
      goals: waitGoals,
      event,
      eventOnly,
      alerts,
      notices,
    },
    melt,
    goals,
    catalogAt: data.meta?.catalogAt ?? null,
    hangarAt: data.meta?.hangarAt ?? null,
  };
}

const priorityOf = (chain) => PRIORITY[chain.priority ?? 'normal'] ?? PRIORITY.normal;

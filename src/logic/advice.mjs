// The one answer to "what do we do with this route of this goal": whether its last step locks the
// target now, how the route splits into buy-now / lock / later / owned, which steps get a
// "buy before the price changes" alert (with the cost of waiting and its text), and which steps an
// alert would be pointless for. Today, the goal journey, the decision graph, the melt plan and the CLI
// all take this object and only format it, so they cannot disagree. Pure.
import { t } from './i18n.mjs';
import { splitRoute, lockDecision } from './lock.mjs';
import { expectedChanges } from './priceChange.mjs';
import { shipAvailability } from './availability.mjs';
import { buyBeforeText, lockCoveredText } from './describe.mjs';
import { classifyPurchase, promotingAlert, isSaturated, dayOfIso } from './urgency.mjs';

const NO_LOCK = Object.freeze({ reason: null, cover: null, covered: false, coveredStep: null, lock: false });

/**
 * @param {object|null} session planning session (lets an owned CCU into the target cover a lock and checks what waiting costs); null: neither
 * @param {object|null} chain the saved goal; null for a free-standing route (no lock, no goal mode)
 * @param {object} route planner route ({ steps }) of that goal: its best proposal or its accepted route
 * @param {{ ships?: Map|null, overrides?: object|null, expected?: object[], avail?: object|null, limitedShare?: { warbond: number, standard: number }|null, historyStart?: string|null }} [env]
 *   limitedShare: share of limited-flagged offers per kind and historyStart: ISO time the offer history begins (both default to the session's data.meta)
 * @returns {{
 *   finish: boolean,
 *   dec: { reason: string|null, cover: object|null, covered: boolean, coveredStep: object|null, lock: boolean },
 *   lockCode: string|null, lockEvent: object|null, coverText: string|null,
 *   split: ReturnType<typeof splitRoute>,
 *   skip: object[],
 *   groups: { buyNow: object[], lockNow: object[], later: object[], owned: object[] },
 *   alerts: Array<{ step: object, reason: string, now: number, expected: number|null, saves?: number, together?: boolean, event?: object, text: string }>,
 *   buys: Array<{ step: object, bucket: 'today'|'norush'|'optional', lock: boolean, promoted: boolean, reasons: object[], since: string|null, until: string|null, untilBy: string|null, note: object|null }>,
 *   cheaper: object[], changes: object, laterExpected: number,
 * }}
 * finish: a goal in finish mode buys every non-owned step now and never locks. `lockCode` is the lock
 * reason only when the last step is actually bought now to lock (not when an owned CCU covers it).
 * `skip` = the steps that need no alert (the locked step and a covered one). `alerts` = the "buy
 * before" alerts for the other steps, in route order, worded with ship names; `cheaper` = steps that
 * get cheaper after the price change. `groups.later` and `laterExpected` (the Standard cash of the later
 * steps at your expected prices) are for watch goals. alerts, cheaper, changes and laterExpected are computed on first use.
 *
 * `buys` is the one list of purchases to make now, in route order, each in a bucket (urgency.mjs): 'today' (the
 * offer may end soon), 'norush' (on sale, no deadline) or 'optional' (a price lock). It is the steps in
 * groups.buyNow and groups.lockNow, plus a later Standard step whose buy-before alert says waiting costs money
 * (`promoted`). Every page and the CLI count "buy now" from it. Computed on first use.
 */
export function routeAdvice(session, chain, route, { ships = null, overrides = null, expected = [], avail = null, limitedShare = null, historyStart = null } = {}) {
  const finish = chain?.mode === 'finish';
  const dec = chain && !finish ? lockDecision(session, chain, route, { ships, overrides, avail }) : NO_LOCK;
  const split = splitRoute(route, { lock: dec.lock });
  const skip = [...split.lockNow, ...(dec.coveredStep ? [dec.coveredStep] : [])];
  const groups = finish
    ? { buyNow: route.steps.filter((s) => s.kind !== 'owned'), lockNow: [], later: [], owned: split.owned }
    : { buyNow: split.buyNow, lockNow: split.lockNow, later: split.later, owned: split.owned };
  const name = (id) => ships?.get(id)?.name ?? t('unknown ship');
  const lockCode = dec.lock ? dec.reason : null;
  const waitCtx = session && chain?.id != null ? { session, chainId: chain.id } : null;
  let changes = null;
  let alerts = null;
  let laterExpected = null;
  let buys = null;
  // Is the limited flag worth anything? Judged per offer kind from the share of flagged offers. Without a session and
  // without an explicit share nothing is known, so the flag is not trusted.
  const share = limitedShare ?? session?.data?.meta?.limitedShare ?? null;
  const limitedUseful = (kind) => (share ? !isSaturated(share[kind] ?? 0) : !!session);
  const historyFrom = dayOfIso(historyStart ?? session?.data?.meta?.historyFrom ?? null);
  return {
    finish, dec, lockCode, split, skip, groups,
    lockEvent: lockCode === 'event' ? shipAvailability(avail, chain.target).event : null,
    coverText: dec.covered ? lockCoveredText(name(dec.cover.from), name(chain.target), dec.cover.extraCash) : null,
    get changes() { return (changes ??= expectedChanges(route, expected, ships, avail, waitCtx)); },
    get alerts() {
      return (alerts ??= this.changes.buyBefore.filter((a) => !skip.includes(a.step)).map((a) => ({ ...a, text: buyBeforeText(a, { name }) })));
    },
    get buys() {
      return (buys ??= route.steps.flatMap((s) => {
        const lock = groups.lockNow.includes(s);
        const alert = this.alerts.find((a) => a.step === s) ?? null;
        const c = () => classifyPurchase(s, { avail, overrides, alert, lock, limitedUseful: limitedUseful(s.kind), historyFrom, finish });
        if (lock || groups.buyNow.includes(s)) return [{ step: s, lock, promoted: false, ...c() }];
        const why = s.kind === 'standard' && alert ? promotingAlert(alert, avail) : null;
        return why ? [{ step: s, lock: false, promoted: true, ...c(), bucket: 'today', reasons: [why] }] : [];
      }));
    },
    get cheaper() { return this.changes.alerts.filter((a) => a.reason === 'cheaper'); },
    get laterExpected() { return (laterExpected ??= expectedChanges({ steps: groups.later }, expected).standardLaterExpected); },
  };
}

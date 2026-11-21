// Wording shared by the CLI and the app. Pure.
import { usd } from './format.mjs';
import { shortDay } from './availability.mjs';
import { loc, N_ } from './i18n.mjs';

/** One-line summary of a route: cash, credit, owned CCUs, purchases, all-in. */
export const routeLine = loc('routeLine', (r) => `${usd(r.cash)} cash${r.creditUsed ? ` + ${usd(r.creditUsed)} credit` : ''} · ${r.steps.filter((s) => s.kind === 'owned').length} owned${r.ownedBasis ? ` (${usd(r.ownedBasis)}${r.unknownBasis ? ' + unknown' : ''})` : ''} · ${r.steps.filter((s) => s.kind !== 'owned').length} to buy${r.allIn != null ? ` · all-in ${usd(r.allIn)}` : ''}`);

/** Wording for a diffRoutes result. */
function describeDiffEn(d) {
  const delta = d.cashDelta == null ? '' : d.cashDelta < 0 ? ` · ${usd(-d.cashDelta)} less cash` : d.cashDelta > 0 ? ` · ${usd(d.cashDelta)} more cash` : ' · same cash';
  const copies = d.released?.length || d.claimed?.length ? ` · releases ${d.released.length}, claims ${d.claimed.length} CCU(s)` : '';
  return { new: 'New plan', 'no-route': 'Blocked · no route', unchanged: 'Unchanged', 'same-path': `Same path${delta}${copies}`, alternative: `Alternative path${delta}${copies}` }[d.kind];
}
export const describeDiff = loc('describeDiff', describeDiffEn);

/** Message when planRoutes found nothing: the target has no incoming edge at all, or just no route from here. */
export const noRouteMessage = loc('noRouteMessage', (targetName, incoming) => incoming === 0
  ? `No route: RSI currently offers no upgrade to ${targetName}, and you own no CCU into it.`
  : 'No route found with the current offers and owned CCUs.');

/**
 * One evaluateAccepted issue as a sentence, with ship and goal names (never ids). `name` maps a ship id to its
 * name, `goalName` a goal id to its name (goalNamer in ships.mjs).
 */
function issueLineEn(i, { name, goalName, arrow = '→' }) {
  const pair = () => `${name(i.from)} ${arrow} ${name(i.to)}`;
  const kind = () => (i.step === 'warbond' ? 'Warbond' : 'Standard');
  switch (i.kind) {
    case 'token-gone': return `Starting ship${i.ship != null ? ` ${name(i.ship)}` : ''} no longer in the hangar`;
    case 'copy-gone': return `CCU ${pair()} no longer in hangar`;
    case 'copy-shared': return `CCU ${pair()} also reserved by ${goalName(i.by)}`;
    case 'offer-gone': return `${kind()} offer ${pair()} no longer available`;
    case 'repriced': return `${kind()} ${pair()} repriced ${usd(i.was)} ${arrow} ${usd(i.now)}`;
    default: return String(i.kind);
  }
}
export const issueLine = loc('issueLine', issueLineEn);

/** Headline of the melt candidates. */
export const meltHeadline = loc('meltHeadline', (p, hasOverrides) => `Melt candidates: ${p.candidates.length} unused CCU(s), ${usd(p.candidateCredit)} credit (no saving${hasOverrides ? ' at current or expected prices' : ''}, Standard offer at the last sync, target seen in the store on two syncs clear of any sale, or confirmed, not into a concept ship, no extras, not reserved)`);

/** Note on candidates that only your expected prices rule out, or null when there are none. */
export const meltWithoutNote = loc('meltWithoutNote', (n) => (n ? `(${n} more would qualify without your expected prices; kept because they save money after the change)` : null));

export const MELT_IDLE = 'No chain is in finish mode or locks a target with a Standard step, so nothing needs to be melted now.';
/** App variant of MELT_IDLE. */
export const MELT_IDLE_APP = N_('No goal is in finish mode or locks a target with a Standard step, so nothing needs to be melted now.');
export const MELT_NOTE = N_('Melting is done by you on RSI; it gives up the option that these targets get more expensive.');

function meltPlanBuild(p, name, { lockLine, finishText, locksOnly }) {
  const out = [];
  for (const l of p.locks) out.push(lockLine(l));
  out.push(`${p.finishChains.length ? finishText(p.finishChains) : locksOnly}: Warbond ${usd(p.warbond)} (always new money) + Standard ${usd(p.standard)} - credit pool ${usd(p.pool)} = ${usd(p.newMoneyBefore)} new money`);
  if (!p.melt.length) out.push('Nothing to melt: the credit pool already covers the Standard purchases.');
  else out.push(`Melt ${p.melt.length} CCU(s) for ${usd(p.meltCredit)} credit -> new money ${usd(p.newMoneyAfter)}${p.creditLeftAfter ? `, ${usd(p.creditLeftAfter)} credit left` : ''}:`);
  return out;
}

/** The melt plan as lines: locks, finish chains, what to melt. `name` maps a ship id to its name; `goalName` (default: the id) a goal id to its name. */
export const meltPlanLines = (p, name, goalName = (id) => id) => meltPlanBuild(p, name, {
  lockLine: (l) => `Lock ${goalName(l.chainId)}: ${name(l.step.from)} -> ${name(l.step.to)} ${usd(l.step.cash)} Standard now (counted below)`,
  finishText: (ids) => `Finish chains ${ids.map(goalName).join(', ')}`,
  locksOnly: 'Locks only',
});

/** App variant of meltPlanLines: says "goal" and names goals instead of showing ids. `goalName` maps a chain id to its name. */
export const meltPlanLinesApp = loc('meltPlanLinesApp', (p, name, goalName) => meltPlanBuild(p, name, {
  lockLine: (l) => `Lock the price for ${goalName(l.chainId)}: ${name(l.step.from)} -> ${name(l.step.to)} ${usd(l.step.cash)} Standard now (counted below)`,
  finishText: (ids) => `Goals in finish mode: ${ids.map(goalName).join(', ')}`,
  locksOnly: 'Locks only',
}));

/** One picked melt: `melt <id>: A -> B (paid $x, Standard today $y)`. */
export const meltPickLine = (m, name) => `melt ${m.copy.copyId}: ${name(m.copy.from)} -> ${name(m.copy.to)} (paid ${usd(m.paid)}, Standard today ${usd(m.standardNow)})`;

/** App variant of meltPickLine: ships and amounts only, no copy id. */
export const meltPickLineApp = loc('meltPickLineApp', (m, name) => `Melt ${name(m.copy.from)} -> ${name(m.copy.to)} (paid ${usd(m.paid)}, Standard today ${usd(m.standardNow)})`);

/**
 * One expected-price line. `covered` is how many Standard offers the assumption covers. Only a real before/after
 * difference says the price of those offers changes; an unchanged assumption just says what it covers.
 */
function priceLineEn(shipName, today, o, covered) {
  const offers = plural(covered, 'Standard offer', 'Standard offers');
  if (today === o.msrp) return `${shipName}: current and expected ship value both ${usd(today)}. This assumption covers ${offers}.${o.note ? ` Note: ${o.note}.` : ''}`;
  return `${shipName}: ${usd(today)} today -> ${usd(o.msrp)} expected${o.note ? ` (${o.note})` : ''} · changes the expected price of ${offers}`;
}
export const priceLine = loc('priceLine', priceLineEn);

/** Heading note of the expected prices: how many Standard offers the assumptions cover in all. */
export const assumptionsCoverText = loc('assumptionsCoverText', (n) => `Your assumptions cover ${plural(n, 'Standard offer', 'Standard offers')} in all.`);

/** The CLI's notice when no sale event is entered: no sync days are covered by a sale event. (The app's is NO_EVENTS_NOTICE_APP.) */
export const NO_EVENTS_NOTICE = 'No sale events recorded. All sync days count as outside sale events. Add the current event with: chain event add "<name>" <from> <to>.';

/** The notice for a sale-events document, or null once it has an event. */
export const noEventsNotice = (saleEvents) => (saleEvents?.events?.length ? null : NO_EVENTS_NOTICE);

/** What store syncs recorded for this ship. */
function availabilityTextEn(a) {
  if (a.inStore == null) return 'No store sync recorded.';
  if (!a.inStore) return `Not in the store at the last sync (${shortDay(a.lastSyncDay)}).${a.lastSeen ? ` Last seen ${shortDay(a.lastSeen)}.` : ''}`;
  const current = a.previousMiss
    ? `In the store since ${shortDay(a.since)}; not there at the ${shortDay(a.previousMiss)} sync.`
    : `In the store since the ${shortDay(a.since)} sync.`;
  if (a.seenOutsideEvents) return `${current} Seen in the store outside sale events.`;
  const during = a.seenIn
    ? `all during ${a.seenIn.name} (RSI's banner: until ${shortDay(a.seenIn.to)})`
    : 'all during sale events';
  return `${current} Seen in the store on ${plural(a.seenDays, 'sync day', 'sync days')}, ${during}.`;
}
export const availabilityText = loc('availabilityText', availabilityTextEn);

/** A step's short store note, only when something is notable: missing at the last sync, or back after a sync missed it. */
function availabilityNoteTextEn(a) {
  if (a.inStore === false) return `Not in the store at the last sync (${shortDay(a.lastSyncDay)}).`;
  if (a.inStore && a.previousMiss) return `In the store since ${shortDay(a.since)}; not there at the ${shortDay(a.previousMiss)} sync.`;
  return '';
}
export const availabilityNoteText = loc('availabilityNoteText', availabilityNoteTextEn);
export const availabilityNote = (a) => { const s = availabilityNoteText(a); return s ? ` ${s}` : ''; };

export const standardLaterText = loc('standardLaterText', (cash) => `Buy Standard ${usd(cash)} later. Store credit works.`);

/** Label for plans shown from the current best proposal while the chain has a different reserved route. */
export const BEST_DIFFERS_LABEL = N_('current best plan (differs from your reserved chain)');

/** App wording for a buy row whose goal has a different accepted route. */
export const BEST_DIFFERS_PLAIN = N_('This is the current best plan. It differs from your reserved chain.');

/** True when the chain has an accepted route and the current best proposal is not the same plan. */
export const bestDiffers = (accepted, best, diff) => !!accepted && !!best && diff(accepted, best).kind !== 'unchanged';

/** What waiting costs, for an alert whose penalty was computed (expectedChanges with a ctx). */
export const waitingCostText = loc('waitingCostText', (a) => (a.saves == null ? '' : a.saves === Infinity ? ' (waiting leaves no route)' : ` (waiting costs ${usd(a.saves)} more${a.together ? ' for these steps together' : ''})`));

/** The "Buy before ..." warning of one alert (expectedChanges). `name` maps a ship id to its name; `hint` is appended to the concept warning (CLI). */
function buyBeforeTextEn(a, { name, arrow = '→', hint = '' }) {
  const path = `${name(a.step.from)} ${arrow} ${name(a.step.to)}`;
  const after = { pricier: usd(a.expected), gone: 'no Standard upgrade', concept: `more (concept ship, rise not known yet${hint})` }[a.reason];
  return `Buy before the price ${a.reason === 'concept' ? 'rises' : 'changes'}: ${path} ${usd(a.now)} now, ${after} after${waitingCostText(a)}`;
}
export const buyBeforeText = loc('buyBeforeText', buyBeforeTextEn);

// ----- journey (Today/Goals step view) -----

/** Chip labels for a journey step state. */
export const STATE_LABEL = { own: N_('Owned'), now: N_('Buy now'), wait: N_('Wait'), norush: N_('On sale'), optional: N_('Optional'), reserved: N_('Reserved') };

/** Chip label for a step that locks its price now. */
export const LOCK_LABEL = N_('Buy now · locks the price');
/** The label of a waiting step no Warbond can make cheaper: it can use store credit when offered. */
export const FILLER_LABEL = N_('Filler');

/** What each chip means, shown as its tooltip. Same meaning as the glossary's "status" entry, one or two plain sentences each. */
export const STATE_HELP = {
  own: 'Owned: you already have this upgrade in your hangar. Nothing to buy.',
  now: 'Buy now: buy it today. The offer may end soon, and waiting could cost more.',
  wait: 'Wait: don\'t buy yet. A Warbond in this price range would make this step cheaper; they mostly appear during sales.',
  norush: 'On sale: on offer at the last sync, with no sign that it ends soon.',
  optional: 'Optional: a bet. Buying now may save money later, but you can also wait.',
  reserved: 'Reserved: held for this goal by its reserved chain, so other goals cannot use it.',
};
/** Tooltip of a step that locks its price now. */
export const LOCK_HELP = 'Buy now to lock the price: buying this Standard upgrade today fixes its price before it rises, even though you do not need it yet.';
/** Tooltip of a filler step. */
export const FILLER_HELP = 'No Warbond fits this price gap. The Standard upgrade takes store credit and is available while the ship is in the store.';

/** The tooltip for a chip: the filler and lock texts take precedence over the state's own. */
function chipHelpEn(state, { lock = false, filler = false } = {}) {
  if (filler) return FILLER_HELP;
  if (lock && state === 'now') return LOCK_HELP;
  return STATE_HELP[state] ?? null;
}
export const chipHelp = loc('chipHelp', chipHelpEn);

/** Shown where a lock would have been when an owned CCU into the target already caps a price rise. */
export const lockCoveredText = loc('lockCoveredText', (fromName, targetName, extraCash) => `Price rise covered: your ${fromName} → ${targetName} CCU limits it to ${usd(extraCash)} more`);

/** One plain sentence for a lockReason code ('on' | 'expected' | 'concept'), or null. */
function lockReasonTextEn(code) {
  return { on: 'You chose to lock the price of this step.', expected: 'The normal price of this ship is expected to go up.', concept: 'This ship is a concept; its price usually rises when it becomes flyable.' }[code] ?? null;
}
export const lockReasonText = loc('lockReasonText', lockReasonTextEn);

/** A Warbond slot, a filler, a Standard price, or a lower observed Warbond price. */
function waitReasonTextEn(kind, { event = null, seen = null, cash = null, slot = null, gap = null } = {}) {
  if (kind === 'slot') return slot ? `Wait for a Warbond into any ship from ${usd(slot.fromMsrp)} to ${usd(slot.toMsrp)} (${slot.fromName} to ${slot.toName}). One could save up to ${usd(slot.save)} here.` : 'Wait for a Warbond.';
  if (kind === 'filler') return `No Warbond fits the ${usd(gap)} gap, so the Standard upgrade is the cheapest way. Store credit works.`;
  if (kind === 'normal') return `Standard price: ${usd(cash)}.`;
  if (kind === 'seen') return `Seen for ${usd(seen.cash)} during ${event?.name ?? 'an earlier sale'}.`;
  return null;
}
export const waitReasonText = loc('waitReasonText', waitReasonTextEn);

/** Labels of the money figures of a chain, and the help line under each. */
export const NEW_CASH_LABEL = N_('New cash still needed');
export const LIST_VALUE_LABEL = N_('Direct upgrade at list value');
export const SALES_CASH_LABEL = N_('New cash if the sales come back');
export const FIGURE_HELP = {
  fullPrice: N_('For comparison only: the price difference between your starting ship and the goal ship if you bought one direct upgrade at today\'s list prices. It is not money you saved or spent.'),
  today: N_('The money you still have to pay at today\'s store prices for the upgrades you do not own yet, after the upgrades you own and any store credit. Steps marked "Wait" are included but are not meant to be bought today.'),
  ifSales: N_('The new cash still needed if each waiting step gets the lowest sale price seen so far. Not guaranteed.'),
};

/** Under the sales figure: how much less new cash than today's prices ("about $5 less new cash than at today's prices"). */
export const cashCutText = loc('cashCutText', (cashText) => `up to ≈ ${cashText} less new cash than at today's prices`);

/** Shown instead of the if-sales figure when no waiting step has a lower sale price seen. */
export const NO_SALES_SEEN = N_('Sale prices not seen yet; keep syncing during sales');

/** Step numbers are zero-padded to the same width: "01" ... "19" (at least two digits). */
export const stepNumber = (n, total) => String(n).padStart(Math.max(2, String(total).length), '0');

/**
 * Label of a collapsed run of owned steps, with both ends: "04–19 Reliant Sen → 600i Explorer · 16 owned upgrades".
 * first/last are 1-based step numbers; fromName/toName the ships at the two ends.
 */
export const ownedRunText = loc('ownedRunText', ({ first, last, total, fromName, toName, count }) =>
  `${stepNumber(first, total)}–${stepNumber(last, total)} ${fromName} → ${toName} · ${plural(count, 'owned upgrade', 'owned upgrades')}`);

/**
 * What a screen reader says for one chain step: "Step 2 of 19. Upgrade Syulen to Spartan. Upgrade owned."
 * `state` is the chip state shown ('own' | 'now' | 'norush' | 'optional' | 'wait'); a price lock says so.
 */
function stepPhraseEn({ index, total, fromName, toName, state, lock = false }) {
  const label = state === 'own' ? 'Upgrade owned' : lock && state === 'now' ? LOCK_LABEL : (STATE_LABEL[state] ?? '');
  return `Step ${index} of ${total}. Upgrade ${fromName} to ${toName}.${label ? ` ${label}.` : ''}`;
}
export const stepPhrase = loc('stepPhrase', stepPhraseEn);

/** Said once above the chain when it holds upgrades you own. */
export const CHAIN_ORDER_NOTE = N_('You own these upgrades. Apply them in the order shown to build the ship.');


// ----- Goals page -----

/** Plain choices per goal: mode (watch/finish), lock of the last step (auto/on/off), objective (cash/allin). */
export const MODE_CHOICE = { watch: N_('Wait for sales when it saves money'), finish: N_('Get it as soon as possible') };
export const LOCK_CHOICE = { auto: N_('auto'), on: N_('always'), off: N_('never') };
export const OBJECTIVE_CHOICE = { cash: N_('Count only new money'), allin: N_('Count what you already paid too') };
export const PRIORITY_CHOICE = { high: N_('High'), normal: N_('Normal'), low: N_('Low') };

export const otherWaysTitle = loc('otherWaysTitle', (n) => `Other ways (${n})`);
export const wouldHelpLine = loc('wouldHelpLine', (cashText) => `A Warbond below ${cashText} would make this cheaper`);

// ----- Shared plan: what sharing costs a goal -----

const joinList = (parts) => (parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** One thing a goal holds that another goal's alone route would use: "your A → B CCU", "your Pulse LTI token", "$5 of your store credit". */
function blockerItemTextEn(item, { name, arrow = '→' }) {
  if (item.kind === 'copy') return `your ${name(item.from)} ${arrow} ${name(item.to)} CCU`;
  if (item.kind === 'token') return `your ${name(item.from)} (starting ship)`;
  return `${usd(item.amount)} of your store credit`;
}
export const blockerItemText = loc('blockerItemText', blockerItemTextEn);

/** Items named per blocker before the rest is summed up ("and 4 more"). */
export const BLOCKER_ITEMS_SHOWN = 3;

/** "Liberator uses your M2 Hercules → Liberator CCU and your Pulse LTI token" for one blocker of sharedEffect; long lists end in "and N more". */
function blockerTextEn(b, opts) {
  const texts = b.items.map((i) => blockerItemText(i, opts));
  const shown = texts.length > BLOCKER_ITEMS_SHOWN ? [...texts.slice(0, BLOCKER_ITEMS_SHOWN), `${texts.length - BLOCKER_ITEMS_SHOWN} more`] : texts;
  return `${b.goalName} uses ${joinList(shown)}`;
}
export const blockerText = loc('blockerText', blockerTextEn);

/** One line for a goal that costs more in the shared plan than alone, or null: "$35 more than on its own: Liberator uses ...; Ironclad uses ...". */
export function sharedEffectLine(effect, opts) {
  if (!(effect?.extra > 0)) return null;
  const why = effect.blockers.length ? `: ${effect.blockers.map((b) => blockerText(b, opts)).join('; ')}` : '';
  return `${usd(effect.extra)} more than on its own${why}.`;
}

/** One short line instead of the wall of text: how much the goal pays because other goals hold CCUs it would use alone. */
function sharedEffectShortEn(effect) {
  return effect?.extra > 0 ? `+${usd(effect.extra)} because other goals hold CCUs this goal would use on its own.` : null;
}
export const sharedEffectShort = loc('sharedEffectShort', sharedEffectShortEn);
/** The detail lines behind sharedEffectShort: what each other goal holds. */
export const sharedEffectParts = loc('sharedEffectParts', (effect, opts) => (effect?.blockers ?? []).map((b) => `${blockerText(b, opts)}.`));

/** The note on a buy step the goal only needs because other goals hold what its alone route uses (neededBecause). */
export const neededBecauseText = loc('neededBecauseText', (blockers, opts) => `Needed because ${joinList(blockers.map((b) => blockerText(b, opts)))}`);

/** The cost on a goal card: "$265 · alone $230" (alone only when it is cheaper), or null without a route. */
export function goalCostText(cash, aloneCash) {
  if (cash == null) return null;
  return aloneCash != null && aloneCash < cash ? `${usd(cash)} · alone ${usd(aloneCash)}` : usd(cash);
}

/**
 * The cost of a goal on its card, in two labelled lines: "With other goals · $160" and, when it would cost less on its own,
 * "If planned alone · $15". Without that difference there is one plain price. Money only, no progress.
 */
function goalCostLinesEn(cash, aloneCash) {
  if (cash == null) return null;
  if (aloneCash != null && aloneCash < cash) return { main: `With other goals · ${usd(cash)}`, alone: `If planned alone · ${usd(aloneCash)}` };
  return { main: usd(cash), alone: null };
}
export const goalCostLines = loc('goalCostLines', goalCostLinesEn);

/** Why the plan total is not the sum of today's prices: reserved goals count at their reserved price. drift: [{ name, accepted, now }]. */
function acceptedDriftNoteEn(drift) {
  if (!drift.length) return null;
  return `Reserved chains count at the price you reserved them at: ${drift.map((d) => `${d.name} ${usd(d.accepted)} reserved, ${usd(d.now)} now`).join('; ')}.`;
}
export const acceptedDriftNote = loc('acceptedDriftNote', acceptedDriftNoteEn);

// ----- Planning order, accepting -----

/** Heading and one-line meaning of each priority level on the Goals page. */
export const LEVEL_TEXT = {
  accepted: { title: N_('Reserved'), help: N_('Reserved: these hold their CCUs before any other goal is planned.') },
  high: { title: N_('High priority'), help: N_('Planned first: these goals get first pick of your CCUs, starting ships and credit.') },
  normal: { title: N_('Normal priority'), help: N_('Planned second: these goals get what the high priority goals leave.') },
  low: { title: N_('Low priority'), help: N_('Planned last: these goals only get what everything above leaves.') },
};

/** Under the Hangar's "Don't use this copy in plans". */
export const EXCLUDE_COPY_HELP = N_('For a CCU you want to keep, melt or gift: no goal will use this copy, and plans find another way. Excluding it releases a reserved chain that holds it.');

/** Where reserving is offered (the list's "Reserve all chains" and the goal's "Reserve this chain"). */
export const ACCEPT_HELP = N_('Optional, and nothing is bought. Reserving keeps this exact chain: it holds the CCUs, starting ship and store credit it uses so other goals cannot take them, and the planner stops switching it to a cheaper route (it tells you if a price changes). Leave it off to always get the cheapest plan. You can release it any time.');
export const ACCEPT_THIS_HELP = ACCEPT_HELP;

/** Release is explained by listing what it frees (see reservation.mjs); this is the one-line fallback. */
export const RELEASE_HELP = 'Releasing gives the held CCUs back to the other goals.';

/** What the status of an accepted route means: ok | repriced | blocked (evaluateAccepted). */
export const acceptedStatusText = loc('acceptedStatusText', (status) => ({
  ok: 'Still valid: everything it holds is still there at the same price.',
  repriced: 'Still possible, but a price changed.',
  blocked: 'No longer possible: something it needs is gone.',
}[status] ?? ''));

/**
 * The status of an accepted route in plain words, with the numbers. Two different things can make today's price differ:
 * the accepted route's own steps changed price (status 'repriced', `nowCash` is what that same route costs now), or a different
 * route is cheaper now (status 'ok', `bestCash` is that route's cost). Less cash is only said when the numbers really differ.
 * @returns {{ text: string, better: { cash: number } | null }} better: a different route needing less new cash exists (offer to switch).
 */
function acceptedStatusLineEn({ status, acceptedCash, nowCash, bestCash = null, differs = false }) {
  const better = differs && bestCash != null && acceptedCash != null && bestCash < acceptedCash ? { cash: bestCash } : null;
  let text = acceptedStatusText(status);
  if (status === 'repriced' && nowCash != null && acceptedCash != null && nowCash !== acceptedCash) {
    text = nowCash < acceptedCash
      ? `Still possible. Its steps now cost ${usd(nowCash)} instead of the ${usd(acceptedCash)} you reserved it at.`
      : `Still possible, but its steps now cost ${usd(nowCash)} instead of the ${usd(acceptedCash)} you reserved it at.`;
  }
  return { text, better };
}
export const acceptedStatusLine = loc('acceptedStatusLine', acceptedStatusLineEn);

// ----- Since the last sync -----

/** "+$90" / "-$30" / "$0" for a change in cents. */
export const signedUsd = (c) => (c > 0 ? `+${usd(c)}` : c < 0 ? `-${usd(-c)}` : usd(0));

/** "18 Nov 20:34" in local time (24 h), or null for a missing/invalid iso. */
function shortWhenEn(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const shortWhen = loc('shortWhen', shortWhenEn);

/** One cause of a goal's change (changesSinceSync). `name` maps a ship id to its name. */
function changeCauseTextEn(c, { name, arrow = '→' }) {
  const pair = () => `${name(c.from)} ${arrow} ${name(c.to)}`;
  switch (c.kind) {
    case 'msrp': return `${name(c.shipId)} went from ${usd(c.was)} to ${usd(c.now)}`;
    case 'step-gone': return c.step === 'warbond' ? `Warbond ${pair()} is no longer offered` : `${pair()} is no longer sold`;
    case 'step-repriced': return `${c.step === 'warbond' ? 'Warbond ' : ''}${pair()} went from ${usd(c.was)} to ${usd(c.now)}`;
    case 'new-warbond': return `now uses Warbond ${pair()} for ${usd(c.cash)}`;
    case 'in-store': return `${name(c.shipId)} is in the store again, so a route through it is possible today`;
    case 'copy-gone': return `your ${pair()} CCU is no longer in your hangar`;
    case 'copy-new': return `now uses your new ${pair()} CCU`;
    case 'taken': return c.by ? `${c.by} took your ${pair()} CCU` : 'another goal took a shared CCU';
    case 'order': return 'Planning order changed';
    case 'shared': return 'follows from changes to other goals. The shared plan reassigned your CCUs or store credit';
    default: return 'No cause found';
  }
}
export const changeCauseText = loc('changeCauseText', changeCauseTextEn);

// More than this many causes of one kind are counted instead of listed, so a goal stays one line.
const LIST_AT_MOST = 2;
const COUNTED = {
  msrp: (n) => `${n} ship prices changed`,
  'step-gone': (n) => `${n} steps are no longer offered`,
  'step-repriced': (n) => `${n} steps changed price`,
  'new-warbond': (n) => `now uses ${n} new Warbonds`,
  'in-store': (n) => `${n} ships are back in the store and open up routes today`,
  'copy-gone': (n) => `${n} of your CCUs left your hangar`,
  'copy-new': (n) => `now uses ${n} new CCUs of yours`,
};

/**
 * One goal's line: "Orion +$90: Prospector went from $155 to $175; Prospector → SRV is no longer sold". One line however much changed:
 * CCUs other goals took are one phrase grouped by goal ("its CCUs now go to Endeavor (12), Carrack (2)"), and more than two causes of
 * another kind are counted ("now uses 5 new Warbonds").
 */
function goalChangeLineEn(g, opts) {
  const head = g.delta != null ? `${g.name} ${signedUsd(g.delta)}` : g.now == null ? `${g.name} has no route now` : `${g.name} has a route now (${usd(g.now)})`;
  const byKind = new Map();
  for (const c of g.causes) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const parts = [];
  for (const [kind, list] of byKind) {
    if (kind === 'taken') continue;
    if (list.length > LIST_AT_MOST && COUNTED[kind]) parts.push(COUNTED[kind](list.length));
    else parts.push(...list.map((c) => changeCauseText(c, opts)));
  }
  const taken = byKind.get('taken') ?? [];
  if (taken.length === 1) parts.push(changeCauseText(taken[0], opts));
  else if (taken.length > 1) {
    const to = new Map();
    for (const c of taken) to.set(c.by ?? 'other goals', (to.get(c.by ?? 'other goals') ?? 0) + 1);
    parts.push(`its CCUs now go to ${[...to].sort((a, b) => b[1] - a[1]).map(([by, n]) => `${by} (${n})`).join(', ')}`);
  }
  return `${head}: ${parts.join('; ')}`;
}
export const goalChangeLine = loc('goalChangeLine', goalChangeLineEn);

/** "+$215 since 18 Nov 20:34" or "unchanged since ...": the total's change, as a tail of a sentence. */
function changesDeltaTextEn(c) {
  const when = shortWhen(c.since);
  return `${c.totalDelta === 0 ? 'unchanged' : signedUsd(c.totalDelta)} since ${when ?? 'the last sync'}`;
}
export const changesDeltaText = loc('changesDeltaText', changesDeltaTextEn);

/** The headline: "Total +$215 since 18 Nov 20:34", or "Total unchanged since ..." (goals that were already there). */
export const changesHeadline = loc('changesHeadline', (c) => `Total ${changesDeltaText(c)}`);

/** One line per goal added or removed since then (not part of the total): "Goal added: Carrack, $160 today". */
function changesGoalLinesEn(c) {
  const cash = (v) => (v == null ? 'no route' : usd(v));
  return [
    ...c.added.map((g) => `Goal added: ${g.name}, ${cash(g.cash)} today`),
    ...c.removed.map((g) => `Goal removed: ${g.name}, was ${cash(g.cash)}`),
  ];
}
export const changesGoalLines = loc('changesGoalLines', changesGoalLinesEn);

// ----- Today page -----

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayKey = (d) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

/** "today, 12:13" | "yesterday, 12:13" | "18 Nov, 12:13" in local time (24 h), or null for a missing/invalid iso. */
function ageWhen(iso, now) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return `today, ${hm}`;
  if (dayKey(d) === dayKey(yesterday)) return `yesterday, ${hm}`;
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}, ${hm}`;
}

/** One date-and-time format for the whole app: "today, 12:13", "yesterday, 12:13", "18 Nov, 12:13" (24 h, English). */
export const whenText = loc('whenText', (iso, now = new Date()) => ageWhen(iso, now));

/** How old the store data is, e.g. "Store data from today, 12:13". */
export const storeDataAge = (iso, now = new Date()) => {
  const w = ageWhen(iso, now);
  return w ? `Store data from ${w}` : 'No store data yet';
};

/** How old the hangar data is, e.g. "Hangar from yesterday, 12:13". */
export const hangarDataAge = (iso, now = new Date()) => {
  const w = ageWhen(iso, now);
  return w ? `Hangar from ${w}` : 'No hangar data yet';
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Hero headline when there is something to buy today (only the "Buy now" group counts). */
export const heroBuyTitle = loc('heroBuyTitle', (n, cashText) => `Today: buy ${plural(n, 'upgrade', 'upgrades')} · ${cashText}`);

/** The first-visit hint on Today: the colours are explained next to the groups they belong to, not here. */
export const TODAY_HINT = 'The banner says what to buy today. Under it, each group says how urgent its upgrades are.';

/** Hero headline when the "Buy now" group is empty. */
export const NOTHING_TODAY = 'Nothing to buy today';

/** The same headline, but never absolute while the cards below still offer something: "Nothing urgent today". */
export const NOTHING_URGENT = 'Nothing must be bought today';

/** Banner sub line when only optional / no-rush offers remain: "2 upgrades are on sale if you want them (about $60)." */
export const onlyOptionalText = loc('onlyOptionalText', (n, cashText) => `${n === 1 ? '1 upgrade is' : `${n} upgrades are`} on sale if you want ${n === 1 ? 'it' : 'them'} (about ${cashText}).`);
export const todayNothingHeadline = loc('todayNothingHeadline', (nothingWhy) => (nothingWhy === 'no-rush' ? NOTHING_URGENT : NOTHING_TODAY));

// ----- the buy list on Today: grouped by pair, in three urgency groups -----

/** The three groups of the buy list, in order. */
export const BUY_GROUPS = {
  today: { title: N_('Buy now'), help: N_('These offers may end soon, or you want the goal as soon as possible.') },
  norush: { title: N_('On sale'), help: N_('On offer at the last sync, with no sign that it ends soon.') },
  optional: { title: N_('Optional'), help: N_('Bets, not deadlines: you can also wait.') },
};

/** Sub line under the headline for the groups that are not "Buy now": "Also: On sale: 2 · Optional: 1". */
function otherGroupsLineEn({ norush = 0, optional = 0 }) {
  const parts = [];
  if (norush) parts.push(`On sale: ${norush}`);
  if (optional) parts.push(`Optional: ${optional}`);
  return parts.length ? `Also: ${parts.join(' · ')}` : null;
}
export const otherGroupsLine = loc('otherGroupsLine', otherGroupsLineEn);

/** The sentence that ends the buy list. */
function buyListEndEn(todayCount, otherCount = 0) {
  if (todayCount > 0) return "That's all for today.";
  return otherCount > 0 ? "That's everything on offer. None of it has to be bought today." : 'No goal needs a purchase today.';
}
export const buyListEnd = loc('buyListEnd', buyListEndEn);

/** How many copies of a pair to buy. */
export const buyCountText = loc('buyCountText', (n) => `buy ${n}`);
/** "for Orion" / "for Orion, Liberator". */
export const forGoalsText = loc('forGoalsText', (names) => `for ${names.join(', ')}`);

/** The tooltip on a step's kind chip: one place that explains Warbond and Standard. */
export const KIND_HELP = {
  warbond: N_('Warbond upgrades require new cash and are usually discounted, but they mostly appear during sales and can vanish.'),
  standard: N_('Standard upgrades use the regular price and can use store credit when offered.'),
  virtual: N_('A virtual CCU you added: an upgrade you expect to get outside the RSI store (from a friend, a trade or a coming sale). Plans count its price as new cash; store credit cannot pay it.'),
};

/** Under the goal's "Route through this ship" field. */
export const VIA_HELP = N_('Plans for this goal only use routes that pass through this ship, for example a ship you want to fly on the way. A reserved chain that skips it is released.');

/** The chip of a virtual step you can get now (it is not a store sale). */
export const VIRTUAL_CHIP = N_('Get it');

/** The kind of a step or row as shown: Virtual, Warbond, Standard or Owned. */
export const stepKindLabel = loc('stepKindLabel', (s) => (s?.virtual || s?.kind === 'virtual' ? 'Virtual' : { warbond: 'Warbond', standard: 'Standard', owned: 'Owned' }[s?.kind] ?? 'Standard'));

/** The detail line of a virtual step. */
export const virtualStepText = loc('virtualStepText', (s) => `A virtual CCU you added: get it outside the RSI store${s?.note ? ` (${s.note})` : ''}. It counts as ${s?.cash != null ? 'new cash' : 'cash'}; store credit cannot pay it.`);

/** How a step is paid: Warbonds and virtual CCUs are cash only, Standard upgrades can use store credit. */
export const paymentText = loc('paymentText', (kind) => (kind === 'warbond' || kind === 'virtual' ? 'cash only' : 'store credit works'));

/** Said once above the buy list when you have store credit. */
export const creditLineText = loc('creditLineText', (cents) => `You have ${usd(cents)} store credit for Standard upgrades`);

/** Shown once on Today when the limited-time mark of an offer kind is ignored (see urgency.mjs LIMITED_SATURATED). */
export const LIMITED_IGNORED_NOTE = N_('RSI marks nearly every offer as limited, so that mark is ignored here.');

/** The Standard price of the same upgrade, shown next to a Warbond. */
export const standardPriceText = loc('standardPriceText', (cents) => `Standard is ${usd(cents)}`);

/** Why a purchase is in "Buy now" (a reason of urgency.mjs classifyPurchase). */
function urgencyReasonTextEn(r) {
  switch (r.code) {
    case 'limited': return 'limited-time offer';
    case 'new': return 'new during the sale';
    case 'event-ends': return `RSI's banner says ${r.event.name} ends ${shortDay(r.event.to)}`;
    case 'price': return 'waiting costs money';
    case 'note-soon': return 'you marked it as ending soon';
    case 'note-ends': return `you marked it as ending ${shortDay(r.until)}`;
    case 'finish': return 'you want this goal as soon as possible';
    default: return '';
  }
}
export const urgencyReasonText = loc('urgencyReasonText', urgencyReasonTextEn);

/**
 * Where an offer stands in "On sale". Dates come from the RSI event banner or an offer note.
 * Standard offers can also have an offer note.
 */
function onSaleTextEn({ kind = 'warbond', since = null, until = null, untilBy = null }) {
  const parts = [];
  if (kind === 'standard') parts.push('Available now, no rush');
  else if (since) parts.push(`on sale since ${shortDay(since)}`);
  if (until) parts.push(untilBy === 'note' ? `runs until ${shortDay(until)} (your note)` : untilBy === 'event' ? `RSI's banner: event ends ${shortDay(until)}` : `runs until ${shortDay(until)}`);
  return parts.join(' · ');
}
export const onSaleText = loc('onSaleText', onSaleTextEn);

/**
 * The purchases of one goal's route as CLI lines, one per non-empty group (routeAdvice.buys): "buy now $15: A -> B $15 Warbond (limited-time offer)".
 * `name` maps a ship id to its name.
 */
export function buyGroupLines(buys, { name, arrow = '->' }) {
  const lines = [];
  for (const g of ['today', 'norush', 'optional']) {
    const list = buys.filter((b) => b.bucket === g);
    if (!list.length) continue;
    const items = list.map((b) => {
      const why = g === 'today' ? b.reasons.map(urgencyReasonText).join(', ') : g === 'norush' ? onSaleText(b) : 'locks the price';
      return `${name(b.step.from)} ${arrow} ${name(b.step.to)} ${usd(b.step.cash)} ${b.step.kind === 'warbond' ? 'Warbond' : 'Standard'}${why ? ` (${why})` : ''}`;
    });
    lines.push(`${BUY_GROUPS[g].title.toLowerCase()} ${usd(list.reduce((n, b) => n + b.step.cash, 0))}: ${items.join('; ')}`);
  }
  return lines;
}

/** Labels of the "runs until" control on a buy row. */
export const OFFER_NOTE = { until: N_('Runs until…'), soon: N_('Ends soon'), clear: N_('Clear my note') };

/** Label of the one-click lock switch on a lock row. */
export const DONT_LOCK_LABEL = N_("Don't lock this goal");

/**
 * The trade of a price lock, in one line: what it costs now and what waiting risks. `code` is the lockReason
 * ('on' | 'expected' | 'concept'); `extraCash` is the most a covering route of yours would add (null: no cover).
 */
function lockTradeTextEn({ targetName, cash, code, extraCash = null }) {
  const cond = {
    concept: `If ${targetName}'s price rises before release,`,
    expected: `If ${targetName}'s price rises as you expect,`,
    on: `If ${targetName}'s price rises,`,
  }[code] ?? `If ${targetName}'s price rises,`;
  const tail = extraCash != null ? `your other routes limit the extra cost to at most ${usd(extraCash)}.` : 'none of your other routes caps it.';
  return `Optional: buy now for ${usd(cash)} to keep this price. ${cond} waiting costs the rise; ${tail}`;
}
export const lockTradeText = loc('lockTradeText', lockTradeTextEn);

/** The figure shown instead of "no sale prices seen yet", from your own Warbond history: the typical discount, with the middle half as a range. */
/** An estimate no sale has confirmed, in whole dollars: "Estimated new cash if discounts return · about $39". */
export const estimateText = loc('estimateText', (typical) => `Estimated new cash if discounts return · ≈ ${usd(Math.round(typical / 100) * 100)}`);
/** The basis of that estimate, for the "How this estimate works" fold. `n` is the number of Warbond discounts in your history. */
export const estimateHowText = loc('estimateHowText', (typical, low, high, n = null) => [
  `Range ${usd(low)}–${usd(high)}, typically ${usd(typical)}.`,
  `Calculated by taking the usual Warbond discount${n ? ` from ${plural(n, 'sale', 'sales')} in your own history` : ' from your own history'} off every waiting Standard step.`,
  'No sale price for these steps has been seen yet, so this is inferred, not observed. A sale may come back smaller, larger or not at all.',
]);

/** A step chosen over an equal-cost route whose Warbond comes from a concept ship (planner tie-break). */
export const conceptTieText = loc('conceptTieText', (altFromName, toName) => `Chosen over ${altFromName} → ${toName} (same price): the ${altFromName} is a concept ship and may rise.`);

/** Hero subline naming the goals touched. */
export const heroGoalsLine = loc('heroGoalsLine', (names) => (names.length === 1 ? `For your goal ${names[0]}` : `For your goals ${names.join(', ')}`));

/**
 * Hero subline when nothing is to be bought. `why` is todayView's nothingWhy; 'waiting' only says
 * everything waits when a step actually waits.
 */
function nothingWhyTextEn(why, { waitCount = 0, anyNoRoute = false, anyNoToken = false } = {}) {
  if (why === 'no-route') return 'None of your goals has a route right now.';
  if (why === 'no-token') return 'None of your goals has a starting ship right now.';
  if (why === 'no-rush') return 'Nothing is urgent: what is left to buy has no deadline.';
  if (why === 'waiting' && waitCount > 0) return 'Everything left waits for a sale.';
  if (why === 'waiting' && anyNoRoute) return 'None of your goals has a route right now.';
  if (why === 'waiting' && anyNoToken) return 'Some of your goals still need a starting ship.';
  return 'All your goals are done.';
}
export const nothingWhyText = loc('nothingWhyText', nothingWhyTextEn);

/** Waiting panel headline. */
export const waitingHeadline = loc('waitingHeadline', (steps, goals) => `Waiting for sales · ${plural(goals, 'goal', 'goals')} · ${plural(steps, 'upgrade', 'upgrades')}`);


/** An alert text (routeAdvice) without its own "From → To" pair, for lines that already show the ships. */
export function alertDetailText(text, fromName, toName) {
  const path = `${fromName} → ${toName}`;
  let t = text.startsWith(`${path} `) ? text.slice(path.length + 1).replace(/^\S+: /, '') : text.replace(`${path} `, '');
  t = t.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Melt tip sentence. */
export const meltTipText = loc('meltTipText', (n, creditText) => `${plural(n, 'CCU', 'CCUs')} you don't need: melt for ${creditText} store credit`);

export const NO_TOKEN_TEXT = N_('Needs a starting ship');
export const NO_TOKEN_TITLE = N_('No starting ship found yet');
/** Why a goal has no starting ship, from what the hangar and the settings really say. ctx: { ltiCount, poolCount, limitCents }. */
function noTokenReasonEn({ ltiCount = null, poolCount = null, limitCents = null } = {}) {
  if (ltiCount === 0) return 'You have no ship with lifetime insurance (LTI) in your hangar, so there is nothing cheap to start from.';
  if (poolCount === 0) return `Your LTI ships all cost more than the starting ship price limit${limitCents != null ? ` of ${usd(limitCents)}` : ''}, or you marked them "never use".`;
  return 'All of your cheap LTI ships are already used by other goals.';
}
export const noTokenReason = loc('noTokenReason', noTokenReasonEn);
export const NO_TOKEN_HELP = `To keep lifetime insurance (LTI), a goal starts from a cheap LTI ship you own. ${noTokenReason()} Choose a starting ship for this goal.`;
export const NO_TOKEN_OTHER = N_('Other ways: raise the starting ship price limit below, or mark another ship you own as a starting ship in the Hangar ("Use as starting ship").');
export const NO_PLEDGE_HELP = 'The starting ship you picked for this goal isn\'t available: it is gone from your hangar, no longer counts as a starting ship, or another goal holds it. Choose another starting ship.';
/** Help for a goal without a token: a goal that pins one pledge gets its own wording. */
export const noTokenHelp = loc('noTokenHelp', (start, ctx = null) => (start?.pledgeId != null ? NO_PLEDGE_HELP
  : ctx ? `To keep lifetime insurance (LTI), a goal starts from a cheap LTI ship you own. ${noTokenReason(ctx)} Choose a starting ship for this goal.` : NO_TOKEN_HELP));
export const TOKEN_HELP = N_('Starting ships are cheap ships you own that have Lifetime Insurance. A goal upgrades one of them; the upgraded ship keeps LTI.');

/** Shown when the chosen fixed start ship is the goal's target. */
export const START_TARGET_SAME = N_('Start and target must differ.');

/** The small line under a goal's target: where the goal starts. `token` is { pledgeId, ship } or null. */
function startLineTextEn(start, token, shipName) {
  if (start?.kind === 'ship') return `from ${shipName} (fixed)`;
  if (token) return `from your ${shipName} \u00b7 LTI`;
  return 'needs a starting ship';
}
export const startLineText = loc('startLineText', startLineTextEn);

/**
 * Labels for a list of pool ships so no two rows read the same: identical ones get "copy 2 of 3".
 * @param {{ pledgeId: string, name: string, paidCents: number|null }[]} pool
 * @returns {Map<string, string>} pledgeId -> label
 */
function tokenOptionLabelsEn(pool) {
  const base = (t) => tokenLabelText(t.name, t.paidCents);
  const groups = new Map();
  for (const t of pool) groups.set(base(t), [...(groups.get(base(t)) ?? []), t]);
  const out = new Map();
  for (const [label, list] of groups) list.forEach((t, i) => out.set(t.pledgeId, list.length > 1 ? `${label} · copy ${i + 1} of ${list.length}` : label));
  return out;
}
export const tokenOptionLabels = loc('tokenOptionLabels', tokenOptionLabelsEn);

/** "Pulse · LTI · paid $25 ×3, Cutter Rambler · LTI · paid $50 ×4": identical ships once, with a count. */
function tokenSummaryTextEn(pool) {
  const counts = new Map();
  for (const t of pool) counts.set(tokenLabelText(t.name, t.paidCents), (counts.get(tokenLabelText(t.name, t.paidCents)) ?? 0) + 1);
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ');
}
export const tokenSummaryText = loc('tokenSummaryText', tokenSummaryTextEn);

/** The note on a journey's first step when it upgrades an LTI token. */
export const tokenStepText = (shipName) => `Your ${shipName} (starting ship)`;

/** A pool token in a list: "Pulse · LTI · paid $25". */
export const tokenLabelText = (name, paidCents) => `${name} \u00b7 LTI${paidCents == null ? '' : ` \u00b7 paid ${usd(paidCents)}`}`;

/**
 * The one thing to do next, in Today's words: "Next: buy" only for a step Today puts under "Buy now"; a no-rush or optional step
 * is "Optional: ... (no rush)"; else the first step waiting for a sale; else null.
 */
function goalNextTextEn(steps, name) {
  const pair = (s) => `${name(s.step.from)} → ${name(s.step.to)}`;
  const now = steps.filter((s) => s.state === 'now');
  const urgent = now.find((s) => !s.urgency || s.urgency === 'today');
  if (urgent) return `Next: ${urgent.step.virtual ? 'get' : 'buy'} ${pair(urgent)} for ${usd(urgent.step.cash)}${urgent.step.virtual ? ' (your virtual CCU)' : urgent.step.kind === 'warbond' ? ' (Warbond, on sale)' : ''}.`;
  const wait = steps.find((s) => s.state === 'wait');
  const calm = now[0];
  if (calm) {
    const tail = wait ? ` Then wait for a sale on ${pair(wait)}.` : '';
    return `Nothing must be bought today. Optional: ${pair(calm)} ${calm.step.virtual ? 'is your virtual CCU' : 'is on sale'} for ${usd(calm.step.cash)} (no rush).${tail}`;
  }
  if (wait) return `Next: wait for a sale on ${pair(wait)} (it costs ${usd(wait.step.cash)} today).`;
  return null;
}
export const goalNextText = loc('goalNextText', goalNextTextEn);

/** Goal card status chip text. */
function goalStatusTextEn(g) {
  if (g.status === 'no-token') return NO_TOKEN_TEXT;
  if (g.status === 'no-route') return 'No route';
  if (g.status === 'done') return 'All upgrades owned';
  const parts = [];
  if (g.buyCount) parts.push(`Buy ${g.buyCount} today`);
  if (g.noRushCount) parts.push(`${g.noRushCount} on sale`);
  if (g.optionalCount) parts.push(`${g.optionalCount} optional`);
  if (g.waitCount) parts.push(`${g.waitCount} wait`);
  return parts.join(' · ');
}
export const goalStatusText = loc('goalStatusText', goalStatusTextEn);

/**
 * Plain-language reason a CCU is kept rather than melted (display only; the CLI keeps the KEEP strings).
 * `keep` is a KEEP value, possibly with the suffix melt.mjs appends (a name, an amount, extras).
 */
function meltReasonPlainEn(keep) {
  const s = String(keep ?? '');
  const tail = (prefix) => s.slice(prefix.length).trim();
  if (s.startsWith('reserved by')) return `A goal uses it (${tail('reserved by')}), so it stays.`;
  if (s === 'protected') return 'You marked it as one to keep.';
  if (s === 'not meltable') return 'RSI does not let you melt this one.';
  if (s === 'paid value unknown') return "We don't know what you paid, so we can't tell if melting is worth it.";
  if (s.startsWith('no Standard offer')) return 'Kept: no Standard offer for this upgrade at the last sync.';
  if (s.startsWith('cheaper than the store today')) return `It costs less than buying it now${/\(.+\)/.exec(s) ? ` (saves ${/\((.+)\)/.exec(s)[1]})` : ''}, so keep it.`;
  if (s.startsWith('will save after an expected price change')) return `It will cost less than the store once the expected price change lands${/\(.+\)/.exec(s) ? ` (saves ${/\((.+)\)/.exec(s)[1]})` : ''}.`;
  if (s.startsWith('into a concept ship')) return "It leads to a concept ship, whose price rises before release.";
  if (s.startsWith('carries extras')) return `It carries extras that would be lost${tail('carries extras').replace(/^:\s*/, '') ? `: ${tail('carries extras').replace(/^:\s*/, '')}` : ''}.`;
  return s ? `Kept: ${s}.` : 'Kept.';
}
export const meltReasonPlain = loc('meltReasonPlain', meltReasonPlainEn);

/** Plain reason shown on every melt candidate (display only). */
export const MELT_CANDIDATE_PLAIN = N_('No goal needs it, a Standard offer was listed at the last sync, and the target was seen in the store on two syncs clear of any sale, or you confirmed it.');

/** App variant of the no-events notice: sale events are added in the Store section. */
export const NO_EVENTS_NOTICE_APP = 'No sale events recorded. All sync days count as outside sale events. Add the current sale in Store.';
/** Same notice for the panel inside Store itself, where the sale is added right there. */
export const NO_EVENTS_NOTICE_STORE = NO_EVENTS_NOTICE_APP.replace('Add the current sale in Store.', 'Add the current sale in the form below.');
export const noEventsNoticeStore = loc('noEventsNoticeStore', (saleEvents) => (saleEvents?.events?.length ? null : NO_EVENTS_NOTICE_STORE));
export const noEventsNoticeApp = loc('noEventsNoticeApp', (saleEvents) => (saleEvents?.events?.length ? null : NO_EVENTS_NOTICE_APP));

/** Plain headline for the Worth melting panel. */
export const meltHeadlinePlain = loc('meltHeadlinePlain', ({ count, credit }) => (count ? `${meltTipText(count, usd(credit))}.` : 'Nothing worth melting right now.'));

/** Import of goals from a CCU Game saved-chains file. */
export const IMPORT_BUTTON = N_('Import from CCU Game');
export const IMPORT_HELP = N_('Choose the saved file you downloaded from CCU Game. Nothing is added until you confirm.');
export const IMPORT_GROUPS = { new: N_('New'), exists: N_('Already a goal'), 'needs-ship': N_('Needs a ship') };
export const IMPORT_NEEDS_SHIP_HELP = N_('We could not match this ship name. Pick the ship to add the goal.');
export const importConfirmLabel = loc('importConfirmLabel', (n) => `Add ${n} ${n === 1 ? 'goal' : 'goals'}`);

/** Shown under a quick search that hides every row. */
export const NO_MATCHES = 'Nothing matches "<query>".';
export const noMatchesText = loc('noMatchesText', (query) => NO_MATCHES.replace('<query>', String(query ?? '').trim()));

/**
 * The lines of "How this adds up" under a chain's new cash (journey.cashBreakdown): what you already hold, what is left to buy,
 * the store credit applied and the cash left. A line is only there when its number is known.
 */
function breakdownLinesEn(b) {
  const lines = [];
  if (b.owned.count) {
    const paid = b.owned.paidKnown === 0 ? '' : b.owned.paidKnown === b.owned.count ? ` · you paid ${usd(b.owned.paid)} for them` : ` · you paid ${usd(b.owned.paid)} for the ${b.owned.paidKnown} with a known price`;
    lines.push(`${plural(b.owned.count, 'upgrade', 'upgrades')} you own already${paid}. That money is spent, not part of the cash still needed.`);
  }
  lines.push(b.purchases.count ? `${plural(b.purchases.count, 'upgrade', 'upgrades')} still to buy · ${usd(b.purchases.cash)} at today's prices` : 'No upgrade left to buy.');
  if (b.credit > 0) lines.push(`Store credit applied: ${usd(b.credit)}`);
  lines.push(`New cash still needed: ${usd(b.cash)}`);
  return lines;
}
export const breakdownLines = loc('breakdownLines', breakdownLinesEn);

/**
 * The plan total of the Goals page, honest about which goals it counts: "Planned total · $20 for 1 of 2 goals. Beta needs a
 * starting ship." `goals`: [{ name, status }] with todayView's statuses; 'no-token' and 'no-route' goals add nothing to the total.
 */
function plannedTotalTextEn(totalCents, goals) {
  const missing = goals.filter((g) => g.status === 'no-token' || g.status === 'no-route');
  if (!missing.length) return `Planned total · ${usd(totalCents)}`;
  const why = (g) => `${g.name} ${g.status === 'no-token' ? 'needs a starting ship' : 'has no route'}.`;
  return `Planned total · ${usd(totalCents)} for ${goals.length - missing.length} of ${goals.length} goals. ${missing.map(why).join(' ')}`;
}
export const plannedTotalText = loc('plannedTotalText', plannedTotalTextEn);

/** Which price each goal contributes to that total, said once when a goal is reserved (accepted). */
export const PLANNED_TOTAL_BASIS = N_('Reserved goals count at the price they were reserved at, the others at today\'s plan.');

/**
 * The goal's settings on one line: "From your Pulse · LTI · Wait for sales when it saves money · Normal priority · Price lock auto".
 * `startLine` is the goal's start text (todayView), or null.
 */
function settingsSummaryEn(chain, startLine) {
  const parts = [startLine ? startLine.replace(/^from /, 'Starts from ') : 'Starting ship not chosen yet', MODE_CHOICE[chain.mode ?? 'watch'], `${PRIORITY_CHOICE[chain.priority ?? 'normal']} priority`, `price lock ${LOCK_CHOICE[chain.lock ?? 'auto']}`];
  return parts.join(' · ');
}
export const settingsSummary = loc('settingsSummary', settingsSummaryEn);

// ---- New goal form: the starting ship ----
export const NO_STARTER_TEXT = N_('No eligible LTI ship in this hangar. Choose a starting ship, or save this goal for later.');
export const NO_HANGAR_TEXT = N_('Your hangar is not synced yet, so the planner cannot see your LTI ships. Sync the hangar, or choose a starting ship.');
export const NO_STARTER_NOTE = N_('Without a starting ship the goal shows "needs a starting ship" until you choose one.');
export const SAMPLE_EXAMPLE_LABEL = N_('Try Alpha → Beta using an upgrade you already own');

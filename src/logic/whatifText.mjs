// Plain sentences for whatif.mjs results (the Add goal preview, "Without this goal", "If I buy this"). Pure.
import { loc } from './i18n.mjs';
import { usd } from './format.mjs';

/** +$125 / -$30 / $0 for a cents change. */
export const signed = (c) => (c == null ? '?' : c > 0 ? `+${usd(c)}` : c < 0 ? `-${usd(-c)}` : usd(0));

const parts = (deltas) => deltas.map((d) => `${d.name} ${signed(d.delta)}`).join(', ');
// Goals that lost or gained their route have no delta; they are named apart.
const lostRoute = (r) => r.deltas.filter((d) => d.now == null && d.was != null);
const gainedRoute = (r) => r.deltas.filter((d) => d.was == null && d.now != null);
const withDelta = (r) => r.deltas.filter((d) => d.delta != null);
const routeNotes = (r) => [
  lostRoute(r).length ? `${lostRoute(r).map((d) => d.name).join(', ')} would lose ${lostRoute(r).length > 1 ? 'their routes' : 'its route'}` : null,
  gainedRoute(r).length ? `${gainedRoute(r).map((d) => d.name).join(', ')} would get a route` : null,
].filter(Boolean);

/** Other goals' line: "Other goals: +$125 (Orion +$90, Carrack +$35)." or "Other goals: no change." */
function otherGoalsTextEn(r) {
  const moved = withDelta(r);
  const notes = routeNotes(r);
  const base = moved.length ? `Other goals: ${signed(moved.reduce((n, d) => n + d.delta, 0))} (${parts(moved)})` : 'Other goals: no change';
  return `${[base, ...notes].join('; ')}.`;
}
export const otherGoalsText = loc('otherGoalsText', otherGoalsTextEn);

/** The Add goal preview: "Liberator: $90. Other goals: +$125 (Orion +$90, Carrack +$35). Total +$215." */
function addGoalTextEn(r) {
  const goal = r.added[0];
  if (!goal) return null;
  if (goal.cash == null) return `${goal.name}: no route found, so there is nothing to buy. ${otherGoalsText(r)}`;
  const own = `${goal.name}: ${usd(goal.cash)}`;
  return `${own}. ${otherGoalsText(r)} Total ${signed(r.grand.delta)}.`;
}
export const addGoalText = loc('addGoalText', addGoalTextEn);

/** "Without this goal": "Without Liberator: other goals -$125 (Orion -$90, Carrack -$35). Total -$215 with its own $90." */
function removeGoalTextEn(r) {
  const goal = r.removed[0];
  if (!goal) return null;
  const moved = withDelta(r);
  const others = moved.length ? `other goals ${signed(moved.reduce((n, d) => n + d.delta, 0))} (${parts(moved)})` : 'other goals stay the same';
  const notes = routeNotes(r);
  const own = goal.cash != null ? ` Total ${signed(r.grand.delta)} with its own ${usd(goal.cash)}.` : '';
  return `Without ${goal.name}: ${[others, ...notes].join('; ')}.${own}`;
}
export const removeGoalText = loc('removeGoalText', removeGoalTextEn);

const planOf = (deltas) => {
  const names = deltas.filter((d) => d.delta != null && d.delta < 0).map((d) => d.name); // only goals whose cost went down
  return names.length === 1 ? `${names[0]}'s plan` : `the plans of ${names.join(', ')}`;
};

/**
 * One row of buyEffect. "Cheaper" is only said when the total really goes down once the price is paid:
 * - you come out ahead: "1 copy ($50): goals get $75 cheaper (Liberator -$75); you come out $45 ahead."
 * - the same money: "1 copy ($50): buying it now pays $50 of Odyssey's plan early; the total stays the same."
 * - you pay more: "1 copy ($50): saves $30 on Odyssey's plan but costs $50 now: $20 more overall."
 */
function buyRowTextEn(row) {
  const copies = `${row.copies} cop${row.copies === 1 ? 'y' : 'ies'} (${usd(row.spent)})`;
  if (row.usedCopies === 0 && row.plannedBy?.length) {
    const who = row.plannedBy.length === 1 ? `${row.plannedBy[0]}'s plan` : `the plans of ${row.plannedBy.join(' and ')}`;
    const itself = row.plannedBy.length === 1 ? 'that plan' : 'those plans';
    return `${copies}: this is already a step of ${who}, and ${itself} would still buy ${row.plannedBy.length === 1 ? 'it' : 'them'} anyway. An extra copy would be a second purchase: ${usd(row.spent)} more.`;
  }
  if (row.usedCopies === 0 || row.saved <= 0) return `${copies}: no goal would use ${row.copies === 1 ? 'it' : 'them'}; nothing gets cheaper.`;
  if (row.net === 0) return `${copies}: buying ${row.copies === 1 ? 'it' : 'them'} now pays ${usd(row.saved)} of ${planOf(row.deltas)} early; the total stays the same.`;
  if (row.net > 0) return `${copies}: saves ${usd(row.saved)} on ${planOf(row.deltas)} but costs ${usd(row.spent)} now: ${usd(row.net)} more overall.`;
  const who = parts(row.deltas.filter((d) => d.delta != null && d.delta < 0)); // only goals whose cost went down, like planOf
  return `${copies}: goals get ${usd(row.saved)} cheaper${who ? ` (${who})` : ''}; you come out ${usd(-row.net)} ahead.`;
}
export const buyRowText = loc('buyRowText', buyRowTextEn);

/**
 * The outcome sentence of a Today buy card, worked out from the plan alone (no search): the step is in the plan of the goals it
 * is listed for, so one copy bought now pays that step early and the total stays the same. The full what-if ("If I buy this")
 * stays behind "Why?" for the rare case where a copy would be shared differently.
 * @param {{ cash: number, goals: string[], lock?: boolean, outside?: string[] }} row goal names are the card's "for" goals; `outside`: those whose reserved chain does not have this step (the total is then not the same, so nothing is promised)
 */
function plannedBuyTextEn({ cash, goals, lock = false, outside = [] }) {
  const names = [...new Set(goals)];
  if (!names.length) return null;
  // A step the goal's reserved chain does not have is only part of its proposed chain: buying it does not pay the reserved plan.
  const away = [...new Set(outside)].filter((n) => names.includes(n));
  if (away.length) return `This step is in ${away.length === 1 ? `${away[0]}'s` : `the`} proposed chain${away.length === 1 ? '' : ` of ${away.slice(0, -1).join(', ')} and ${away[away.length - 1]}`}, not in ${away.length === 1 ? 'its' : 'their'} reserved chain. See Why? before you buy.`;
  const plan = names.length === 1 ? `${names[0]}'s plan` : `the plans of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return lock
    ? `Buying now locks ${usd(cash)} of ${plan} at today's price. Your total at today's prices stays the same.`
    : `Buying now pays ${usd(cash)} of ${plan} early. Your total stays the same.`;
}
export const plannedBuyText = loc('plannedBuyText', plannedBuyTextEn);

/** The sentence under the copy picker: what an extra copy adds. */
function buyVerdictTextEn(effect) {
  const [one, two] = effect.rows;
  if (!one) return null;
  if (one.saved <= 0) return null; // the row above already says so
  if (two && two.extraSaved <= 0) return 'A 2nd copy saves nothing.';
  if (two) return `A 2nd copy saves another ${usd(two.extraSaved)}.`;
  return null;
}
export const buyVerdictText = loc('buyVerdictText', buyVerdictTextEn);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The lines of an offer-check card (checkOffer result), without the verdict: what the store sells, what you own and who uses it,
 * which goals' routes have the pair, and what buying one copy at the offer's price does.
 * @param {object} r checkOffer result
 * @param {(id: number) => string} shipName
 */
function offerCheckLinesEn(r, shipName, { effect = true } = {}) {
  const lines = [];
  const kindWord = (k) => (k === 'warbond' ? 'Warbond' : 'Standard');
  lines.push(r.store.length ? `The store sells ${shipName(r.offer.from)} → ${shipName(r.offer.to)} today as ${r.store.map((s) => `${kindWord(s.kind)} ${usd(s.cash)}`).join(' and ')}.` : `The store does not sell ${shipName(r.offer.from)} → ${shipName(r.offer.to)} today.`);
  if (r.copies.length) {
    const used = r.copies.filter((c) => c.usedBy);
    const free = r.copies.length - used.length;
    const parts = [...used.map((c) => `used by ${c.usedBy.goalName}`), ...(free ? [`${plural(free, 'copy is', 'copies are')} unused`] : [])];
    lines.push(`You own ${plural(r.copies.length, 'copy', 'copies')} of this CCU: ${parts.join(', ')}.`);
  } else lines.push('You own no copy of this CCU.');
  lines.push(r.onRoutes.length ? `On the route of: ${[...new Set(r.onRoutes.map((x) => x.goalName))].join(', ')}.` : 'No goal\'s route has this pair.');
  if (!effect) return lines;
  const e = r.effect;
  lines.push(buyRowText({ copies: 1, spent: e.purchase.spent, saved: 0 - e.totalDelta, net: e.net, usedCopies: e.usedCopies, deltas: e.deltas }));
  return lines;
}
export const offerCheckLines = loc('offerCheckLines', offerCheckLinesEn);

/**
 * The verdict tile of an offer check: one tone, one headline, one sentence. `net` is what you pay overall (the price minus
 * what your goals no longer need to buy); only a negative net is a saving.
 * @param {object} r checkOffer result
 * @returns {{ tone: 'good'|'neutral'|'bad', head: string, text: string }}
 */
function offerTileEn(r) {
  const e = r.effect;
  const spent = e.purchase.spent;
  const saved = 0 - e.totalDelta;
  const helped = e.deltas.filter((d) => d.delta != null && d.delta < 0);
  if (e.net < 0) {
    const goal = helped.length === 1 ? helped[0].name : null;
    const replaces = goal != null && r.onRoutes.some((x) => x.goalName === goal && x.kind !== 'owned');
    const text = replaces
      ? `Save ${usd(-e.net)} overall. This ${usd(spent)} purchase replaces a planned ${usd(saved)} purchase for ${goal}.`
      : `Save ${usd(-e.net)} overall. ${helped.length === 1 ? goal : 'Your goals'} would need ${usd(saved)} less for ${usd(spent)} now.`;
    return { tone: 'good', head: `Worth it · saves ${usd(-e.net)}`, text };
  }
  if (e.net > 0 && saved > 0) return { tone: 'bad', head: `Skip · costs ${usd(e.net)} more`, text: `This ${usd(spent)} purchase would only save ${usd(saved)} on your goals.` };
  if (e.net === 0 && saved > 0) return { tone: 'neutral', head: 'No saving', text: `Pays ${usd(saved)} of ${planOf(e.deltas)} early. Your total stays the same.` };
  return { tone: 'neutral', head: 'Not needed', text: r.verdict };
}
export const offerTile = loc('offerTile', offerTileEn);

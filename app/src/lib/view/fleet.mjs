// The Hangar's Ships view: one card per ship you own, plus optional cards for your goal ships. Pure.
import { goalRow } from './goalTable.mjs';
import { matchesQuery, searchText } from '../../../../src/logic/search.mjs';
import { t, tn, N_ } from '../../../../src/logic/i18n.mjs';

const monthsOf = (title) => (!title ? 0 : /lifetime|\bLTI\b/i.test(title) ? Infinity : Number(/(\d+)\s*month/i.exec(title)?.[1] ?? 0));

/** 'lti' | '120' | 'less' | null for an insurance title ("less" = a known term under 120 months). */
export function insuranceKind(title) {
  const m = monthsOf(title);
  return m === Infinity ? 'lti' : m >= 120 ? '120' : m > 0 ? 'less' : null;
}
/** "LTI", "120 months", or the title as RSI writes it. */
export function insuranceLabel(title) {
  const kind = insuranceKind(title);
  if (kind === 'lti') return 'LTI';
  const months = /(\d+)\s*month/i.exec(title ?? '')?.[1];
  return months ? t('{n} months', { n: months }) : (title ?? null);
}

const PREFIX = /^(?:Standalone Ships?|Package|Upgrade|Warbond(?: Edition)?)\s*[-–:]\s*/i;
const STANDALONE = /^Standalone Ships?\s*[-–:]\s*/i;
/**
 * Where the ship came from, in the pledge's own words: its title. A plain standalone pledge drops the "Standalone Ship -" prefix
 * (a pledge named after the ship alone reads "Standalone ship"); an upgraded pledge reads "Start → Now".
 */
export function originLine(pledge, shipName) {
  if (!pledge) return null;
  const name = String(pledge.name ?? '');
  if (pledge.upgraded) return `${name.replace(PREFIX, '')} → ${shipName}`;
  if (!STANDALONE.test(name)) return name || null;
  const rest = name.replace(STANDALONE, '');
  return rest.trim().toLowerCase() === String(shipName).trim().toLowerCase() ? t('Standalone ship') : rest;
}

/**
 * Cards for the owned ships. `fleet` is ownedFleet(), `pledges` the hangar pledges, `poolIds` the ids of the pledges that can start a goal.
 * Card: { kind: 'owned', key, shipId, name, manufacturer, count, pledgeId, line, upgraded, insurance, insuranceKind, lti, stage, starting, giftable }.
 */
export function ownedCards(fleet, pledges, ships, poolIds = new Set()) {
  const byId = new Map(pledges.map((p) => [String(p.pledgeId), p]));
  return fleet.map((e) => {
    const ps = e.pledgeIds.map((id) => byId.get(String(id))).filter(Boolean);
    const first = ps[0] ?? null;
    const ship = e.shipId != null ? ships.get(e.shipId) : null;
    const many = ps.length > 1;
    // What a card says about one pledge must hold for the pledge it describes. With several pledges the origin is only shown when
    // they agree, and a badge or tag that holds for some of them says "on 1 of 2".
    const lines = [...new Set(ps.map((p) => originLine(p, e.name)))];
    const kind = insuranceKind(e.insurance);
    const withKind = ps.filter((p) => insuranceKind(p.insurance ?? null) === kind).length;
    const startingN = e.pledgeIds.filter((id) => poolIds.has(String(id))).length;
    const giftN = ps.filter((p) => p.giftable).length;
    const some = (n, label) => (n === 0 ? null : many && n < ps.length ? t('{label} on {n} of {total}', { label, n, total: ps.length }) : label);
    return {
      kind: 'owned', key: `o:${e.key}`, shipId: e.shipId, name: e.name, manufacturer: e.manufacturer, count: e.count ?? 1, pledges: ps.length,
      pledgeId: e.pledgeIds[0], line: many && lines.length > 1 ? t('{n} pledges', { n: ps.length }) : (lines[0] ?? null), upgraded: !!first?.upgraded,
      insurance: e.insurance ? (some(withKind, insuranceLabel(e.insurance)) ?? insuranceLabel(e.insurance)) : null, insuranceKind: kind, lti: !!e.lti,
      stage: ship ? (ship.concept ? 'concept' : 'flight') : null,
      starting: startingN > 0, startingText: some(startingN, t('Starting ship')),
      giftable: giftN > 0, giftableText: some(giftN, t('Giftable')),
    };
  });
}

/**
 * Cards for the goals' ships, from todayView goals. The tag says where the chain stands: "Goal · chain ready" when every upgrade is owned,
 * else how many steps are still to buy; a goal without a route or starting ship says that instead.
 */
export function goalCards(goals, ships) {
  return goals.map((g) => {
    const r = goalRow(g);
    const open = Math.max(0, r.total - r.own);
    const ready = g.status !== 'no-token' && g.status !== 'no-route' && (g.status === 'done' || (r.total > 0 && open === 0));
    const tag = g.status === 'no-token' ? t('Goal · needs a starting ship')
      : g.status === 'no-route' ? t('Goal · no route')
      : ready ? t('Goal · chain ready')
      : r.total > 0 ? tn(open, 'Goal · {n} upgrade to buy', 'Goal · {n} upgrades to buy')
      : t('Goal');
    const ship = ships.get(g.targetId);
    return {
      kind: 'goal', key: `g:${g.goalId}`, goalId: g.goalId, shipId: g.targetId ?? null, name: g.targetName ?? g.name, manufacturer: null, count: 1,
      line: g.startLine ?? t('Your goal'), tag, ready, stage: ship ? (ship.concept ? 'concept' : 'flight') : null,
      insurance: null, insuranceKind: null, starting: false, giftable: false,
    };
  });
}

/** Owned cards first, then goal cards; a search keeps the cards whose name, maker or origin line has every word. */
export function fleetItems(owned, goals, query = '') {
  return [...owned, ...goals].filter((c) => matchesQuery(searchText(c.name, c.manufacturer, c.line), query));
}

/** The filter groups of the Ships view. "Show" is strict: what is unticked is hidden. */
// Labels are marked with N_ and translated where the filter is drawn.
export const FLEET_GROUPS = [
  { id: 'show', label: N_('Show'), strict: true, defaults: ['owned', 'goal'], options: [
    { id: 'owned', label: N_('Owned ships'), offLabel: N_('Owned ships hidden'), test: (c) => c.kind === 'owned' },
    { id: 'goal', label: N_('Goal ships'), offLabel: N_('Goal ships hidden'), test: (c) => c.kind === 'goal' },
  ] },
  { id: 'insurance', label: N_('Insurance'), options: [
    { id: 'lti', label: N_('LTI'), test: (c) => c.insuranceKind === 'lti' },
    { id: '120', label: N_('120 months'), test: (c) => c.insuranceKind === '120' },
    { id: 'less', label: N_('Under 120 months'), test: (c) => c.insuranceKind === 'less' },
  ] },
  { id: 'stage', label: N_('Stage'), options: [
    { id: 'flight', label: N_('Flight ready'), test: (c) => c.stage === 'flight' },
    { id: 'concept', label: N_('Concept'), test: (c) => c.stage === 'concept' },
  ] },
  { id: 'start', label: N_('Starting ship'), term: 'lti', help: N_('A starting ship is a cheap ship in your hangar with lifetime insurance. A goal can start from it, and the upgrades you buy then carry the insurance on to the goal ship.'), options: [{ id: 'start', label: N_('Starting ship only'), test: (c) => c.starting }] },
  { id: 'gift', label: N_('Giftable'), options: [{ id: 'gift', label: N_('Giftable'), test: (c) => c.giftable }] },
];

/**
 * The one result line of the Ships view: "Showing 10 owned ships (15 pledges) · 10 goal ships" when nothing is filtered out,
 * else "Showing 5 of 20 · 3 owned, 2 goal". `pledges` is how many ship pledges the hangar holds (one ship can come from several).
 */
export function fleetCountText(shown, total, pledges) {
  const n = (list, kind) => list.filter((c) => c.kind === kind).length;
  const ships = (k) => tn(k, '{n} ship', '{n} ships');
  if (shown.length !== total.length) return t('Showing {shown} of {total} · {owned} owned, {goal} goal', { shown: shown.length, total: total.length, owned: n(shown, 'owned'), goal: n(shown, 'goal') });
  const o = n(total, 'owned');
  const g = n(total, 'goal');
  const parts = [];
  if (o) parts.push(`${tn(o, '{n} owned ship', '{n} owned ships')}${pledges != null && pledges !== o ? ` (${tn(pledges, '{n} pledge', '{n} pledges')})` : ''}`);
  if (g) parts.push(tn(g, '{n} goal ship', '{n} goal ships'));
  return parts.length ? t('Showing {parts}', { parts: parts.join(' · ') }) : ships(0);
}

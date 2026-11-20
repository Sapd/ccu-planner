// The Today and Goals views speak German under withLocale('de', …) and are unchanged in English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../app/src/lib/i18n/de/index.js';
import { withLocale, t } from '../../src/logic/i18n.mjs';
import { setup } from '../support/ladder.mjs';
import { todayView } from '../../app/src/lib/view/today.mjs';
import { goalRow, progressText, tableSummary } from '../../app/src/lib/view/goalTable.mjs';
import { chainStrip } from '../../app/src/lib/view/chainStrip.mjs';
import { endpointsText } from '../../app/src/lib/view/addGoal.mjs';
import { fleetCountText, goalCards, FLEET_GROUPS } from '../../app/src/lib/view/fleet.mjs';
import { heroBuyTitle, waitingHeadline } from '../../src/logic/describe.mjs';

// Two goals, one limited Warbond into the first: a "buy now" row, goal start lines and a waiting step.
const world = () => setup({
  goals: [{ name: 'G1', base: 1, target: 3, priority: 'normal', mode: 'watch' }, { name: 'G2', base: 1, target: 5, priority: 'normal', mode: 'watch' }],
  offers: [{ from: 1, to: 3, kind: 'warbond', cash: 4000, skuId: 1, limited: true }],
});

/** The texts the Today page renders from the view (hero, buy row, goal lines), as one list. */
function texts(app) {
  const v = todayView(app);
  const row = v.buyList.today[0];
  return [heroBuyTitle(v.hero.buyCount, '$80'), waitingHeadline(v.waiting.count, v.waiting.goals.length), row.detail, row.countText, ...row.reasonTexts, row.standardText, ...v.goals.map((g) => g.startLine)];
}

test('Today: buy row, hero and goal lines are German under withLocale(de) and English again afterwards', () => {
  const { app } = world();
  const en = texts(app);
  const de = withLocale('de', () => texts(app));
  assert.equal(de.length, en.length);
  en.forEach((text, i) => assert.notEqual(de[i], text, `"${text}" stays English`));
  const joined = de.join(' | ');
  for (const word of ['kaufen', 'Upgrades', 'für', 'Standard kostet', 'Pulse']) assert.ok(joined.includes(word), `German text lacks "${word}": ${joined}`);
  assert.match(joined, /Ziel|Warten/);
  assert.deepEqual(texts(app), en, 'English is unchanged after the German run');
  assert.ok(en[2].startsWith('cash only'), en[2]);
});

test('Today: the view keeps a result per language (no stale English in German)', () => {
  const { app } = world();
  const english = todayView(app);
  const german = withLocale('de', () => todayView(app));
  assert.notEqual(english, german);
  assert.equal(todayView(app), english);
  assert.equal(withLocale('de', () => todayView(app)), german);
});

test('Goals list helpers: progress, summary, flags, strip and goal cards in German', () => {
  const { app } = world();
  const goal = todayView(app).goals[0];
  assert.equal(progressText({ own: 1, total: 3 }), '1 of 3 upgrades owned');
  assert.equal(withLocale('de', () => progressText({ own: 1, total: 3 })), '1 von 3 Upgrades im Besitz');
  assert.equal(tableSummary(2, 0), '2 goals · nothing to buy today');
  assert.equal(withLocale('de', () => tableSummary(2, 1)), '2 Ziele · 1 heute zu kaufen');
  assert.equal(withLocale('de', () => goalRow({ ...goal, status: 'no-route' }).flag.text), 'Keine Route');
  assert.equal(goalRow({ ...goal, status: 'no-route' }).flag.text, 'No route');
  // "ab Pulse (fest)" loses its prefix like "from Pulse (fixed)" does.
  assert.equal(withLocale('de', () => goalRow(todayView(app).goals[0]).from), 'Pulse (fest)');
  assert.equal(goalRow(goal).from, 'Pulse (fixed)');

  const steps = [{ state: 'own', step: { from: 1, to: 2, cash: 0 } }, { state: 'own', step: { from: 2, to: 3, cash: 0 } }, { state: 'wait', step: { from: 3, to: 4, cash: 4000 } }];
  const labels = (locale) => withLocale(locale, () => chainStrip(steps).segments.map((s) => [s.label, s.sub]));
  assert.deepEqual(labels('en'), [['2 owned', null], ['$40', 'Wait']]);
  assert.deepEqual(labels('de'), [['2 im Besitz', null], ['$40', 'Warten']]);

  assert.equal(withLocale('de', () => endpointsText({ state: 'none', targetName: 'Carrack' })), 'Noch kein Startschiff → Ziel Carrack');
  assert.equal(endpointsText({ state: 'none', targetName: 'Carrack' }), 'No starting ship yet → goal Carrack');

  const cards = (locale) => withLocale(locale, () => goalCards([{ ...goal, status: 'no-route' }], app.data.ships)[0].tag);
  assert.equal(cards('en'), 'Goal · no route');
  assert.equal(cards('de'), 'Ziel · keine Route');
  const owned = [{ kind: 'owned' }, { kind: 'owned' }];
  assert.equal(fleetCountText(owned, owned, 3), 'Showing 2 owned ships (3 pledges)');
  assert.equal(withLocale('de', () => fleetCountText(owned, owned, 3)), 'Angezeigt: 2 eigene Schiffe (3 Pledges)');
  // Filter labels stay English in the module and are translated where the filter column draws them.
  assert.equal(FLEET_GROUPS[0].label, 'Show');
  assert.equal(withLocale('de', () => t(FLEET_GROUPS[0].label)), 'Anzeigen');
});

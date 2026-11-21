import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeDataAge, hangarDataAge } from '../src/logic/describe.mjs';

// The helpers format in local time; build the inputs from local parts so the test is zone-independent.
const iso = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 10, 18, 15, 30);

test('storeDataAge: today, yesterday, older, missing and invalid', () => {
  assert.equal(storeDataAge(iso(2026, 11, 18, 12, 13), now), 'Store data from today, 12:13');
  assert.equal(storeDataAge(iso(2026, 11, 17, 23, 5), now), 'Store data from yesterday, 23:05');
  assert.equal(storeDataAge(iso(2026, 11, 8, 9, 0), now), 'Store data from 8 Nov, 09:00');
  assert.equal(storeDataAge(iso(2026, 10, 31, 0, 0), now), 'Store data from 31 Oct, 00:00');
  assert.equal(storeDataAge(null, now), 'No store data yet');
  assert.equal(storeDataAge(undefined, now), 'No store data yet');
  assert.equal(storeDataAge('not a date', now), 'No store data yet');
});

test('hangarDataAge: same formats with the Hangar wording', () => {
  assert.equal(hangarDataAge(iso(2026, 11, 18, 12, 13), now), 'Hangar from today, 12:13');
  assert.equal(hangarDataAge(iso(2026, 11, 17, 12, 13), now), 'Hangar from yesterday, 12:13');
  assert.equal(hangarDataAge(iso(2026, 11, 8, 12, 13), now), 'Hangar from 8 Nov, 12:13');
  assert.equal(hangarDataAge(null, now), 'No hangar data yet');
  assert.equal(hangarDataAge('garbage', now), 'No hangar data yet');
});

test('yesterday works across a month boundary', () => {
  assert.equal(storeDataAge(iso(2026, 10, 31, 8, 0), new Date(2026, 10, 1, 10, 0)), 'Store data from yesterday, 08:00');
});

import { heroBuyTitle, nothingWhyText, waitingHeadline, meltTipText, goalStatusText } from '../src/logic/describe.mjs';

test('Today wording helpers', () => {
  assert.equal(heroBuyTitle(2, '$40'), 'Today: buy 2 upgrades · $40');
  assert.equal(heroBuyTitle(1, '$40'), 'Today: buy 1 upgrade · $40');
  assert.equal(waitingHeadline(3, 2), 'Waiting for sales · 2 goals · 3 upgrades');
  assert.equal(waitingHeadline(1, 1), 'Waiting for sales · 1 goal · 1 upgrade');
  assert.equal(meltTipText(2, '$55'), "2 CCUs you don't need: melt for $55 store credit");
  assert.equal(goalStatusText({ status: 'no-route' }), 'No route');
  assert.equal(goalStatusText({ status: 'done' }), 'All upgrades owned');
  assert.equal(goalStatusText({ status: 'no-token' }), 'Needs a starting ship');
  assert.equal(goalStatusText({ status: 'buy', buyCount: 1, waitCount: 2 }), 'Buy 1 today · 2 wait');
  assert.equal(goalStatusText({ status: 'wait', buyCount: 0, waitCount: 2 }), '2 wait');
});

test('nothingWhyText covers the mixed done/no-route case without claiming a wait', () => {
  assert.equal(nothingWhyText('all-owned'), 'All your goals are done.');
  assert.equal(nothingWhyText('no-route'), 'None of your goals has a route right now.');
  assert.equal(nothingWhyText('waiting', { waitCount: 2 }), 'Everything left waits for a sale.');
  assert.equal(nothingWhyText('waiting', { waitCount: 0, anyNoRoute: true }), 'None of your goals has a route right now.');
  assert.equal(nothingWhyText('waiting', { waitCount: 0, anyNoRoute: false }), 'All your goals are done.');
});

import { meltReasonPlain } from '../src/logic/describe.mjs';
import { KEEP } from '../src/logic/melt.mjs';

test('meltReasonPlain gives a plain sentence for every KEEP reason', () => {
  for (const v of Object.values(KEEP)) {
    const out = meltReasonPlain(v);
    assert.ok(typeof out === 'string' && out.length > 0, v);
    assert.notEqual(out, v);
  }
  // dynamic reasons as melt.mjs builds them
  assert.match(meltReasonPlain(`${KEEP.RESERVED} Idris goal`), /Idris goal/);
  assert.match(meltReasonPlain(`${KEEP.SAVES} ($40)`), /\$40/);
  assert.match(meltReasonPlain(`${KEEP.EXTRAS}: Paint`), /Paint/);
  assert.equal(meltReasonPlain(KEEP.NO_OUTSIDE_OBSERVATION), 'Kept: not yet seen in the store on two syncs clear of any sale.');
});

import { meltHeadlinePlain, noEventsNoticeApp, noEventsNotice } from '../src/logic/describe.mjs';

test('meltHeadlinePlain and the app no-events notice', () => {
  assert.equal(meltHeadlinePlain({ count: 0, credit: 0 }), 'Nothing worth melting right now.');
  assert.equal(meltHeadlinePlain({ count: 1, credit: 5500 }), "1 CCU you don't need: melt for $55 store credit.");
  assert.equal(meltHeadlinePlain({ count: 2, credit: 5500 }), "2 CCUs you don't need: melt for $55 store credit.");
  assert.match(noEventsNoticeApp({ events: [] }), /Add the current sale in Store\./);
  assert.equal(noEventsNoticeApp({ events: [{}] }), null);
  assert.match(noEventsNotice({ events: [] }), /chain event add/);
});

import { noEventsNoticeStore } from '../src/logic/describe.mjs';
test('the Store variant of the no-events notice points to the panel below', () => {
  assert.match(noEventsNoticeStore({ events: [] }), /Add the current sale in the form below\.$/);
  assert.equal(noEventsNoticeStore({ events: [{}] }), null);
});

import { alertDetailText } from '../src/logic/describe.mjs';
test('alertDetailText drops the ship pair from an alert', () => {
  assert.equal(alertDetailText('Buy before the price changes: Pulse → Syulen $40 now, $50 after', 'Pulse', 'Syulen'), 'Buy before the price changes: $40 now, $50 after');
});

import { MELT_IDLE_APP, MELT_IDLE, meltPlanLinesApp, BEST_DIFFERS_PLAIN } from '../src/logic/describe.mjs';

test('app-only wording says goal, never chain, and names goals instead of ids', () => {
  assert.doesNotMatch(MELT_IDLE_APP, /chain/i);
  assert.match(MELT_IDLE, /chain/);
  const name = (id) => ({ 1: 'A', 2: 'B' })[id] ?? `#${id}`;
  const goalName = (id) => ({ c1: 'Idris goal', c2: 'Carrack goal', c3: 'Polaris goal' })[id];
  const p = { finishChains: ['c1', 'c2'], locks: [{ chainId: 'c3', step: { from: 1, to: 2, cash: 5000 } }], warbond: 2500, standard: 11000, pool: 1000, newMoneyBefore: 12500, newMoneyAfter: 2500, melt: [], meltCredit: 0, creditLeftAfter: 0 };
  const lines = meltPlanLinesApp(p, name, goalName);
  assert.equal(lines[0], 'Lock the price for Polaris goal: A -> B $50 Standard now (counted below)');
  assert.equal(lines[1], 'Goals in finish mode: Idris goal, Carrack goal: Warbond $25 (always new money) + Standard $110 - credit pool $10 = $125 new money');
  assert.equal(meltPlanLinesApp({ ...p, locks: [], finishChains: [] }, name, goalName)[0].startsWith('Locks only:'), true);
  assert.ok(lines.every((l) => !/chain|\bc\d\b/i.test(l)));
  assert.doesNotMatch(BEST_DIFFERS_PLAIN, /accept/i, 'one word for holding a chain: reserve');
  assert.match(BEST_DIFFERS_PLAIN, /reserved chain/);
});

import { startLineText, NO_TOKEN_HELP, TOKEN_HELP, NO_TOKEN_TEXT, tokenLabelText } from '../src/logic/describe.mjs';

test('startLineText: token, fixed ship and no free token', () => {
  assert.equal(startLineText({ kind: 'token' }, { pledgeId: '7', ship: 1 }, 'Pulse'), 'from your Pulse \u00b7 LTI');
  assert.equal(startLineText({ kind: 'ship', ship: 1 }, null, 'Carrack'), 'from Carrack (fixed)');
  assert.equal(startLineText({ kind: 'token' }, null, null), 'needs a starting ship');
});

test('token help texts and pool label', () => {
  assert.equal(NO_TOKEN_TEXT, 'Needs a starting ship');
  assert.match(NO_TOKEN_HELP, /^To keep lifetime insurance \(LTI\), a goal starts from a cheap LTI ship you own\./);
  assert.doesNotMatch(NO_TOKEN_HELP, /token/i, 'no jargon in the main sentence');
  assert.equal(TOKEN_HELP, 'Starting ships are cheap ships you own that have Lifetime Insurance. A goal upgrades one of them; the upgraded ship keeps LTI.');
  assert.equal(tokenLabelText('Pulse', 2500), 'Pulse \u00b7 LTI \u00b7 paid $25');
  assert.equal(tokenLabelText('Pulse', null), 'Pulse \u00b7 LTI');
});

import { START_TARGET_SAME } from '../src/logic/describe.mjs';
test('START_TARGET_SAME wording', () => assert.equal(START_TARGET_SAME, 'Start and target must differ.'));

import { noTokenHelp, NO_PLEDGE_HELP } from '../src/logic/describe.mjs';
test('no-token wording: any-token goals and goals pinning a pledge get their own help; hero lines', () => {
  assert.equal(noTokenHelp({ kind: 'token' }), NO_TOKEN_HELP);
  assert.equal(noTokenHelp({ kind: 'token', pledgeId: '7' }), NO_PLEDGE_HELP);
  assert.doesNotMatch(NO_PLEDGE_HELP, /already used/);
  assert.equal(nothingWhyText('no-token'), 'None of your goals has a starting ship right now.');
  assert.match(nothingWhyText('waiting', { anyNoToken: true }), /still need a starting ship/);
});

test('the Today headline is never absolute while the cards below still offer something', async () => {
  const { todayNothingHeadline, NOTHING_TODAY, NOTHING_URGENT, TODAY_HINT } = await import('../src/logic/describe.mjs');
  assert.equal(todayNothingHeadline('no-rush'), NOTHING_URGENT);
  for (const why of ['waiting', 'all-owned', 'no-route', 'no-token', null]) assert.equal(todayNothingHeadline(why), NOTHING_TODAY);
  assert.doesNotMatch(TODAY_HINT, /Green|blue|purple|grey/);
});

test('goal progress and next-step lines', async () => {
  const { goalNextText, sharedEffectShort, onlyOptionalText } = await import('../src/logic/describe.mjs');
  const name = (id) => ({ 1: 'Pulse', 2: 'Hercules', 3: 'Carrack' })[id];
  const st = (state, from, to, cash = 100) => ({ state, step: { from, to, cash, kind: 'standard' } });
  assert.equal(goalNextText([st('own', 1, 2), st('wait', 2, 3, 4000)], name), 'Next: wait for a sale on Hercules → Carrack (it costs $40 today).');
  assert.equal(goalNextText([st('wait', 1, 2), st('now', 2, 3, 1000)], name), 'Next: buy Hercules → Carrack for $10.');
  assert.equal(goalNextText([st('own', 1, 2)], name), null);
  assert.equal(sharedEffectShort({ extra: 7000, blockers: [] }), '+$70 because other goals hold CCUs this goal would use on its own.');
  assert.equal(sharedEffectShort({ extra: 0 }), null);
  assert.equal(onlyOptionalText(2, '$60'), '2 upgrades are on sale if you want them (about $60).');
  assert.equal(onlyOptionalText(1, '$10'), '1 upgrade is on sale if you want it (about $10).');
});

test('goalNextText follows Today: "Next: buy" only for urgent steps, optional ones say so', async () => {
  const { goalNextText } = await import('../src/logic/describe.mjs');
  const name = (id) => ({ 1: 'Pulse', 2: 'Hercules', 3: 'Carrack' })[id];
  const st = (state, from, to, cash, urgency = null) => ({ state, urgency, step: { from, to, cash, kind: 'standard' } });
  assert.equal(goalNextText([st('now', 1, 2, 2000, 'norush'), st('wait', 2, 3, 4000)], name), 'Nothing must be bought today. Optional: Pulse → Hercules is on sale for $20 (no rush). Then wait for a sale on Hercules → Carrack.');
  assert.equal(goalNextText([st('now', 1, 2, 2000, 'optional')], name), 'Nothing must be bought today. Optional: Pulse → Hercules is on sale for $20 (no rush).');
  assert.equal(goalNextText([st('now', 1, 2, 2000, 'norush'), st('now', 2, 3, 1000, 'today')], name), 'Next: buy Hercules → Carrack for $10.');
  assert.doesNotMatch(goalNextText([st('now', 1, 2, 2000, 'norush')], name), /^Next: buy/);
});

test('noTokenReason names the real cause', async () => {
  const { noTokenReason, noTokenHelp } = await import('../src/logic/describe.mjs');
  assert.match(noTokenReason({ ltiCount: 0, poolCount: 0, limitCents: 8000 }), /no ship with lifetime insurance/);
  assert.match(noTokenReason({ ltiCount: 3, poolCount: 0, limitCents: 8000 }), /all cost more than the starting ship price limit of \$80/);
  assert.match(noTokenReason({ ltiCount: 3, poolCount: 2, limitCents: 8000 }), /already used by other goals/);
  assert.match(noTokenHelp({ kind: 'token' }, { ltiCount: 0, poolCount: 0, limitCents: 8000 }), /no ship with lifetime insurance/);
  assert.doesNotMatch(noTokenHelp({ kind: 'token' }, { ltiCount: 3, poolCount: 0, limitCents: 8000 }), /already used by other goals/);
});

test('starting-ship options are distinguishable: identical ones are numbered, the summary counts them', async () => {
  const { tokenOptionLabels, tokenSummaryText } = await import('../src/logic/describe.mjs');
  const pool = [
    { pledgeId: '1', name: 'Pulse', paidCents: 2500 }, { pledgeId: '2', name: 'Pulse', paidCents: 2500 },
    { pledgeId: '3', name: 'Pulse', paidCents: 2500 }, { pledgeId: '4', name: 'Cutter Rambler', paidCents: 5000 },
  ];
  const labels = tokenOptionLabels(pool);
  assert.equal(labels.get('1'), 'Pulse · LTI · paid $25 · copy 1 of 3');
  assert.equal(labels.get('3'), 'Pulse · LTI · paid $25 · copy 3 of 3');
  assert.equal(labels.get('4'), 'Cutter Rambler · LTI · paid $50');
  assert.equal(new Set(labels.values()).size, 4, 'no two options read the same');
  assert.equal(tokenSummaryText(pool), 'Pulse · LTI · paid $25 ×3, Cutter Rambler · LTI · paid $50');
});

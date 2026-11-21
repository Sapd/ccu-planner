import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { decisionGraph, decisionMemo, versusText } from '../src/logic/decision.mjs';
import { noRouteMessage } from '../src/logic/describe.mjs';

const TODAY = '2026-11-20';
const ships = (concepts = []) => new Map([[1, 5000], [2, 7500], [3, 10000], [4, 15000]].map(([id, msrp]) => [id, { id, name: 'ABCD'[id - 1], msrp, concept: concepts.includes(id) }]));
function build({ offers = [], owned = [], concepts = [], base = 1, target = 4, saleEvents, saleHistory, availability = {} } = {}) {
  const sh = ships(concepts);
  const plans = newState();
  addChain(plans, { base, target });
  return { data: { ships: sh, offers, owned, saleHistory }, graph: buildGraph({ offers, owned }), plans, overrides: { ships: availability }, expected: offers, saleEvents };
}
const std = (from, to) => ({ from, to, kind: 'standard', cash: ships().get(to).msrp - ships().get(from).msrp });
const run = (app, opts = {}) => decisionGraph(app, 'c1', { wanted: null, today: TODAY, ...opts });

test('routes sharing their first step merge into one edge; alternatives carry their delta', () => {
  const app = build({
    offers: [std(1, 2), std(2, 4), { from: 2, to: 4, kind: 'warbond', cash: 4000, skuId: 9 }],
    owned: [{ from: 1, to: 2, copyId: 'c-77', paid: { cents: 500 } }],
  });
  const g = run(app);
  const first = g.edges.filter((e) => e.from === 1 && e.to === 2 && e.kind === 'owned');
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].routes, [0, 2], 'route 1 avoids the owned copy');
  assert.equal(first[0].best, true);
  assert.equal(first[0].delta, 0);
  const alt = g.edges.find((e) => e.kind === 'standard' && e.from === 2 && e.to === 4);
  assert.deepEqual(alt.routes, [2]);
  assert.equal(alt.best, false);
  assert.equal(alt.delta, 3500);
  assert.deepEqual(g.steps.map((s) => [s.from, s.to, s.chosen.kind]), [[1, 2, 'owned'], [2, 4, 'warbond']]);
  assert.equal(g.steps[0].decision, 'Use your owned CCU (paid $5): free now.');
  assert.match(g.steps[1].decision, /^Buy Warbond \$40 now: \$35 less than Standard\.$/);
  assert.deepEqual(g.nodes.filter((n) => n.onBest).map((n) => [n.id, n.layer]), [[1, 0], [2, 1], [4, 2]]);
});

test('an alternative-only ship sits between its best-route neighbours', () => {
  const app = build({
    offers: [{ from: 1, to: 4, kind: 'warbond', cash: 3000, skuId: 1 }, { from: 1, to: 3, kind: 'warbond', cash: 1000, skuId: 2 }, std(3, 4), { from: 1, to: 4, kind: 'standard', cash: 10000 }],
  });
  const g = run(app);
  const c = g.nodes.find((n) => n.id === 3);
  assert.ok(c.layer > 0 && c.layer < 1, `layer ${c.layer}`);
  assert.equal(c.onBest, false);
});

test('an owned copy reserved by another chain is unavailable and the Standard offer is chosen', () => {
  const app = build({ offers: [std(1, 2)], owned: [{ from: 1, to: 2, copyId: 'x1', paid: { cents: 100 } }], target: 2 });
  addChain(app.plans, { base: 1, target: 2 });
  app.plans.chains.c2.accepted = { steps: [{ kind: 'owned', from: 1, to: 2, cash: 0, copyId: 'x1' }], creditUsed: 0 };
  const [step] = run(app).steps;
  assert.equal(step.chosen.kind, 'standard');
  const owned = step.options.find((o) => o.kind === 'owned');
  assert.equal(owned.available, false);
  assert.equal(owned.why, 'reserved by B', 'the goal is named by its target ship, not its id');
  assert.equal(step.options.find((o) => o.chosen).kind, 'standard');
});

test('a cheaper Warbond makes the Standard option cost more; a missing Standard offer is not on sale', () => {
  const app = build({ offers: [std(1, 2), { from: 1, to: 2, kind: 'warbond', cash: 1500, skuId: 3 }], target: 2 });
  const [step] = run(app).steps;
  assert.equal(step.chosen.kind, 'warbond');
  assert.equal(step.options.find((o) => o.kind === 'standard').why, 'costs $10 more');
  const wbOnly = build({ offers: [{ from: 1, to: 2, kind: 'warbond', cash: 1500, skuId: 3 }], target: 2 });
  const o = run(wbOnly).steps[0].options.find((x) => x.kind === 'standard');
  assert.deepEqual([o.available, o.why], [false, 'not on sale']);
});

test('a concept target with lock auto locks the last step', () => {
  const app = build({ offers: [std(1, 2)], concepts: [2], target: 2 });
  const [step] = run(app).steps;
  assert.match(step.decision, /lock now/);
  assert.equal(step.options.find((o) => o.chosen).why, 'concept: lock now');
});

test('a Standard step describes the store observations before and after the event', () => {
  const app = build({
    offers: [std(1, 2)], target: 2,
    saleEvents: { events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }] },
    saleHistory: { ships: { 1: { onSaleDays: ['2026-11-20'] }, 2: { onSaleDays: ['2026-11-21'] } } },
  });
  for (const today of ['2026-11-26', '2026-11-28']) {
    const [step] = run(app, { today }).steps;
    assert.match(step.decision, /^Buy Standard .* later\. Store credit works\./);
    assert.match(step.decision, /In the store since Nov 21; not there at the Nov 20 sync/);
    assert.equal(step.options.find((o) => o.chosen).why, 'chosen');
  }
});

test('no route: verdict carries the no-route wording and the graph is empty', () => {
  const g = run(build({ offers: [std(1, 2)], target: 3 }));
  assert.deepEqual([g.nodes, g.edges, g.steps], [[], [], []]);
  assert.equal(g.verdict.text, noRouteMessage('C', 0));
});

test('the verdict names why the best route wins and which Warbond would switch the plan', () => {
  const app = build({ offers: [std(1, 2), std(2, 4), { from: 2, to: 4, kind: 'warbond', cash: 4000, skuId: 9 }], owned: [{ from: 1, to: 2, copyId: 'k', paid: { cents: 1 } }] });
  const wanted = { wanted: [{ from: 1, to: 2, below: 6000, standard: 2500 }, { from: 8, to: 9, below: 1, standard: 2 }, { from: 2, to: 3, createsRoute: true, below: 5 }] };
  const v = run(app, { wanted }).verdict;
  assert.equal(v.versus, '$25 less new money than the next route');
  assert.deepEqual(v.helps, ['a Warbond A → B below $60 would switch the plan']);
  assert.match(v.text, /^Least new money: \$40 cash/);
});

test('versusText follows the tie-break order', () => {
  const r = (o) => ({ cash: 100, allIn: 100, creditUsed: 0, ownedUsed: 1, steps: [1, 2], ...o });
  assert.equal(versusText(r(), r({ ownedUsed: 3 })), 'same cash, keeps 2 more owned CCUs free');
  assert.equal(versusText(r({ ownedUsed: 3 }), r()), 'same cash, reuses 2 more owned CCUs');
  assert.equal(versusText(r({ allIn: 50 }), r(), 'allin'), '$0.50 lower all-in than the next route');
});

test('parallel edges of different kinds between the same ships stay distinct edges', () => {
  const app = build({ offers: [std(1, 2), std(2, 4), { from: 2, to: 4, kind: 'warbond', cash: 4000, skuId: 9 }], owned: [{ from: 1, to: 2, copyId: 'k', paid: { cents: 1 } }] });
  const pair = run(app).edges.filter((e) => e.from === 2 && e.to === 4);
  assert.deepEqual(pair.map((e) => [e.kind, e.best]), [['warbond', true], ['standard', false]]);
});

test('all-in objective: a free owned copy that lost says its paid basis made it dearer', () => {
  const app = build({ offers: [std(1, 2)], owned: [{ from: 1, to: 2, copyId: 'p', paid: { cents: 5000 } }], target: 2 });
  app.plans.chains.c1.objective = 'allin';
  const [step] = run(app).steps;
  assert.equal(step.chosen.kind, 'standard');
  assert.equal(step.options.find((o) => o.kind === 'owned').why, 'higher all-in (paid $50)');
  app.plans.chains.c1.objective = 'cash';
  app.plans.rev = 1; // a changed document has a new rev, so it gets a new planning session
  assert.equal(run(app).steps[0].chosen.kind, 'owned');
});

test('a manual melt confirmation does not change the Standard decision', () => {
  const app = build({ offers: [std(1, 2), std(2, 3)], target: 3 });
  const before = run(app).steps[0].decision;
  assert.equal(before, 'Buy Standard $25 later. Store credit works.');
  app.overrides = { ships: { 2: { availability: 'regular' } } };
  assert.equal(run(app).steps[0].decision, before);
});

test('the memo key follows plans, overrides and sale-event revisions and the graph', () => {
  const app = build({ offers: [std(1, 2)], target: 2 });
  app.plans.rev = 1;
  const a = decisionMemo(app, 'c1', 5, TODAY);
  assert.equal(decisionMemo(app, 'c1', 5, TODAY), a);
  app.plans.rev = 2;
  assert.notEqual(decisionMemo(app, 'c1', 5, TODAY), a);
  const b = decisionMemo(app, 'c1', 5, TODAY);
  app.overrides = { rev: 1, ships: {} };
  assert.notEqual(decisionMemo(app, 'c1', 5, TODAY), b);
  const c = decisionMemo(app, 'c1', 5, TODAY);
  app.saleEvents = { rev: 3, events: [] };
  assert.notEqual(decisionMemo(app, 'c1', 5, TODAY), c);
  assert.notEqual(decisionMemo({ ...app, graph: buildGraph({ offers: [std(1, 2)] }) }, 'c1', 5, TODAY), decisionMemo(app, 'c1', 5, TODAY));
});

test('the verdict says so when the accepted route differs from the current best plan', () => {
  const app = build({ offers: [std(1, 2), std(2, 4), { from: 1, to: 4, kind: 'warbond', cash: 8000, skuId: 3 }] });
  assert.equal(run(app).verdict.differsFromAccepted, false);
  assert.doesNotMatch(run(app).verdict.text, /differs/);
  app.plans.chains.c1.accepted = { rev: 1, cash: 9999, creditUsed: 0, steps: [std(1, 2), std(2, 4)] };
  const v = run(app).verdict;
  assert.equal(v.differsFromAccepted, true);
  assert.ok(v.text.startsWith('current best plan (differs from your reserved chain): '));
});

import { NO_TOKEN_TEXT } from '../src/logic/describe.mjs';

test('a token goal without a free token says so instead of the no-route message', () => {
  const app = build({ offers: [std(1, 4)] });
  app.plans.chains.c1.start = { kind: 'token' };
  const g = run(app);
  assert.deepEqual(g.nodes, []);
  assert.equal(g.verdict.text, NO_TOKEN_TEXT);
});

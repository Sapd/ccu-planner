// Compares a CCU Game "Saved Chains" export with your goals: what CCU Game says each chain costs against what the planner
// says for the matching goal, and the goals and chains only one side has. Pure: reads the app's shared plan, saves nothing.
import { parseSavedChains, NOT_SAVED_CHAINS } from './ccugame.mjs';
import { aliasShipId, findShipExact } from './hangar.mjs';
import { sessionFor } from './session.mjs';
import { goalLabel } from './ships.mjs';
import { usd } from './format.mjs';


const matchShip = (ships, aliases, name) => {
  const id = aliasShipId(aliases, name) ?? findShipExact(ships, name)?.id ?? null;
  return id != null && ships.has(id) ? id : null;
};

/** The figures of the export's chains: parseSavedChains' names plus CCU Game's own cost ("missing", cents) and its start. */
export function parseChainFigures(text) {
  const base = parseSavedChains(text); // throws NOT_SAVED_CHAINS for a file of another kind
  const chains = JSON.parse(text).chains;
  return base.map((b, i) => {
    const c = chains[i];
    const first = Array.isArray(c.chain) ? c.chain[0] : null;
    return {
      ...b,
      ccugameCash: Number.isFinite(c.missing) ? c.missing : null,
      fromType: c.options?.fromType ?? null,
      startOrigin: first?.origin ?? null,
      // What the chain's own start costs (a store ship it begins with), in cents.
      startCost: first?.origin && first.origin !== 'hangar' ? (first.requiredCredits ?? 0) : 0,
    };
  });
}

/**
 * @param {object} app planner app ({ plans, graph, data, ... })
 * @param {string} savedChainsJson text of the saved-chains file
 * @param {{ aliases?: object|null }} [opts]
 * @returns {{
 *   rows: Array<{ name: string, target: string, targetId: number|null, ccugameStart: string, ccugameCash: number|null, startCost: number, ccugameCashNoStart: number|null, goalId: string|null, goalName: string|null,
 *                 ourStart: string|null, ourCash: number|null, ourAlone: number|null, diff: number|null, notes: string[] }>,
 *   onlyOurs: Array<{ goalId: string, name: string, note: string }>,
 *   totals: { matched: number, ccugame: number, startCosts: number, ours: number, diff: number },
 *   notes: string[],
 * }}
 * A chain is matched to a goal with the same target ship, preferring the goal that starts from the chain's start ship (or any
 * LTI token when the chain's start is a token pledge); each goal matches one chain. ccugameCash is CCU Game's "missing" figure; a chain
 * that starts from a store ship (origin not 'hangar') includes that ship's price in it, startCost, which a goal starting from your LTI
 * ship does not pay, so ccugameCashNoStart = ccugameCash - startCost is what diff = ours - ccugameCashNoStart uses (negative: ours is
 * cheaper); totals.ccugame adds the same figure, totals.startCosts the start ships. ourAlone = the goal's route with nothing taken by other goals. totals add up the matched rows that have both figures.
 */
export function compareCcuGame(app, savedChainsJson, { aliases = null } = {}) {
  const session = sessionFor(app);
  const { plans, data } = session;
  const ships = data?.ships ?? new Map();
  const shipName = (id) => ships.get(id)?.name ?? 'unknown ship';
  const figures = parseChainFigures(savedChainsJson);
  const goals = Object.values(plans.chains);
  const used = new Set();
  const rows = [];
  for (const f of figures) {
    const fromId = matchShip(ships, aliases, f.fromName);
    const toId = matchShip(ships, aliases, f.toName);
    const notes = [];
    const noStart = f.ccugameCash == null ? null : f.ccugameCash - f.startCost;
    const row = { name: f.name, target: f.toName, targetId: toId, ccugameStart: f.fromName, ccugameCash: f.ccugameCash, startCost: f.startCost, ccugameCashNoStart: noStart, goalId: null, goalName: null, ourStart: null, ourCash: null, ourAlone: null, diff: null, notes };
    if (toId == null) notes.push(`${f.toName} is not in the ship catalog`);
    const candidates = goals.filter((g) => g.target === toId && !used.has(g.id));
    const goal = candidates.find((g) => g.start?.kind === 'ship' && g.start.ship === fromId) ?? candidates.find((g) => g.start?.kind === 'token') ?? candidates[0] ?? null;
    // Only a chain that starts from something other than a hangar ship buys its start from the store.
    if (f.startOrigin && f.startOrigin !== 'hangar') {
      const cost = f.startCost ? ` (its figure includes ${usd(f.startCost)} for the ship, left out of the difference)` : '';
      notes.push(`CCU Game starts from a store ${f.fromName} without LTI${cost}`);
    }
    if (!goal) {
      if (toId != null) notes.push(`Not in your goals: ${f.toName}`);
      rows.push(row);
      continue;
    }
    used.add(goal.id);
    const entry = session.shared.get(goal.id);
    const alone = session.alone(goal.id);
    row.goalId = goal.id;
    row.goalName = goalLabel(goal, ships);
    row.ourCash = entry?.route?.cash ?? null;
    row.ourAlone = alone?.cash ?? null;
    const startId = entry?.route?.start?.ship ?? (goal.start?.kind === 'ship' ? goal.start.ship : null);
    row.ourStart = startId != null ? shipName(startId) : null;
    if (row.ourCash != null && noStart != null) row.diff = row.ourCash - noStart;
    if (row.ourCash == null) notes.push('The planner has no route for this goal today');
    if (row.ourStart && fromId != null && startId !== fromId) notes.push(`Ours starts from ${row.ourStart}, CCU Game from ${f.fromName}`);
    if (row.ourAlone != null && row.ourCash != null && row.ourAlone !== row.ourCash) {
      notes.push(`CCU Game plans each chain separately; ours share your CCUs (on its own this goal costs ${usd(row.ourAlone)} here, ${usd(row.ourCash)} shared)`);
    }
    rows.push(row);
  }
  const onlyOurs = goals.filter((g) => !used.has(g.id)).map((g) => {
    const name = goalLabel(g, ships);
    return { goalId: g.id, name, note: `Not in CCU Game: ${name}` };
  });
  const both = rows.filter((r) => r.goalId && r.diff != null);
  const totals = {
    matched: both.length,
    ccugame: both.reduce((n, r) => n + r.ccugameCashNoStart, 0),
    startCosts: both.reduce((n, r) => n + r.startCost, 0),
    ours: both.reduce((n, r) => n + r.ourCash, 0),
    diff: both.reduce((n, r) => n + r.diff, 0),
  };
  const notes = [];
  if (rows.filter((r) => r.goalId).length > 1) notes.push('CCU Game plans each chain separately; the planner shares your CCUs between goals, so its total can be lower.');
  return { rows, onlyOurs, totals, notes };
}

export { NOT_SAVED_CHAINS };

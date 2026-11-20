// What the Store page says about an offer, taken from the same journeys Today shows (so the two pages agree). Pure.

/**
 * The planner's verdict for each ship that has a Warbond offer, and for each exact source -> target pair.
 * - 'plan': a goal's chain has a Warbond step into the ship that Today lists to buy (buy now, no rush or optional).
 * - 'helps': a goal still has to buy a step into the ship (waiting, or another kind), so an offer may matter.
 * - none: no goal needs an upgrade into it. It has no chip: the card sits under "Other offers", which already says so.
 * @param {Array<{goalId:string, name:string, journey:{steps:Array<{state:string, step:{from:number,to:number,kind:string}}>}|null}>} goals todayView(app).goals
 * @returns {{ ships: Map<number,{verdict:'plan'|'helps', goals:Array<{goalId:string,name:string}>}>, pairs: Map<string,{verdict:'plan'|'helps', goals:Array<{goalId:string,name:string}>}> }}
 */
export function storeVerdicts(goals) {
  const shipsOut = new Map();
  const pairs = new Map();
  const add = (map, key, verdict, goal) => {
    const cur = map.get(key) ?? { verdict: 'helps', goals: [] };
    if (verdict === 'plan') cur.verdict = 'plan';
    if (!cur.goals.some((g) => g.goalId === goal.goalId)) cur.goals.push({ goalId: goal.goalId, name: goal.targetName ?? goal.name });
    map.set(key, cur);
  };
  for (const g of goals) {
    for (const x of g.journey?.steps ?? []) {
      if (x.state === 'own') continue;
      const verdict = x.state === 'now' && x.step.kind === 'warbond' ? 'plan' : 'helps';
      add(shipsOut, x.step.to, verdict, g);
      if (x.step.kind === 'warbond') add(pairs, `${x.step.from}-${x.step.to}`, verdict, g);
    }
  }
  return { ships: shipsOut, pairs };
}

export const VERDICT_LABEL = { plan: 'In your plan', helps: 'Helps a goal' };
export const VERDICT_HELP = {
  plan: 'A goal buys this upgrade now, as Today lists it.',
  helps: 'A goal still needs an upgrade into this ship, so an offer here may matter.',
};

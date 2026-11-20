// Where a step of a goal's chain is drawn, so a link from another page can open it. Pure.

/**
 * @param {Array<{kind:'step', index:number}|{kind:'run', from:number, to:number, count:number}>} groups journey.groups
 * @param {Array<{step:{from:number,to:number}}>} steps journey.steps
 * @returns {{ index:number, run:{from:number,to:number}|null }|null} the step's index, and the collapsed run it sits in (if any)
 */
export function locateStep(groups, steps, from, to) {
  const index = steps.findIndex((x) => x.step.from === from && x.step.to === to);
  if (index < 0) return null;
  const run = groups.find((g) => g.kind !== 'step' && index >= g.from && index <= g.to) ?? null;
  return { index, run: run ? { from: run.from, to: run.to } : null };
}

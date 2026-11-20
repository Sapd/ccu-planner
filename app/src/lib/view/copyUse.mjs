// Which goals use which owned CCU copy, for the "+N more copies" line of an owned step. Pure.

/**
 * copyId → names of the goals whose chain uses that copy (the proposed chain and the chain that counts, e.g. a reserved one).
 * @param {Array<{ goalId: string, name: string, journey?: object, counted?: object }>} goals todayView(app).goals
 */
export function copyUsers(goals) {
  const out = new Map();
  for (const g of goals ?? []) {
    for (const j of [g.journey, g.counted]) {
      for (const x of j?.steps ?? []) {
        const id = x.step?.copyId;
        if (id == null) continue;
        const list = out.get(String(id)) ?? [];
        if (!list.some((u) => u.goalId === g.goalId)) list.push({ goalId: g.goalId, name: g.name });
        out.set(String(id), list);
      }
    }
  }
  return out;
}

/**
 * The other copies of the same From → To upgrade as an owned step, each with the goals that use it.
 * @param {Array<{ copyId: string, from: number, to: number }>} owned app.data.owned
 * @param {{ from: number, to: number, copyId: string }} step the owned step
 * @param {Map<string, Array<{ goalId: string, name: string }>>} users copyUsers()
 * @returns {Array<{ copyId: string, goals: Array<{ goalId: string, name: string }> }>}
 */
export function otherCopies(owned, step, users) {
  return (owned ?? [])
    .filter((o) => o.from === step.from && o.to === step.to && String(o.copyId) !== String(step.copyId))
    .map((o) => ({ copyId: String(o.copyId), goals: users.get(String(o.copyId)) ?? [] }));
}

// LTI tokens: hangar pledges that are one catalog ship with Lifetime Insurance. Pure: no file or network access.
// A token is a cheap pledge the planner may start a goal from; the user limits the pool with
// profile.tokens = { limitCents, use: [pledgeId], never: [pledgeId] }.

import { classifyPledge, aliasShipId, findShipExact, isUsd } from './hangar.mjs';

export const DEFAULT_TOKENS = { limitCents: 8000, use: [], never: [] };

export const tokenCopyId = (pledgeId) => 'token:' + pledgeId;

const LIFETIME = /lifetime/i;
const byId = (a, b) => a.pledgeId.localeCompare(b.pledgeId, undefined, { numeric: true });

// Paid cents ascending, pledges without a USD value last, then pledge ID.
const byPaid = (a, b) => {
  if (a.paidCents == null || b.paidCents == null) {
    if (a.paidCents == null && b.paidCents == null) return byId(a, b);
    return a.paidCents == null ? 1 : -1;
  }
  return a.paidCents - b.paidCents || byId(a, b);
};

/**
 * Hangar pledges that are exactly one resolved catalog ship with a Lifetime Insurance item.
 * @param {object} hangarRaw hangar.json: { entries: { [key]: { data: pledge, goneSince? } } }
 * @param {Map<number,{id:number,name:string,msrp?:number}>} ships catalog ships
 * @param {object|null} aliases parsed aliases.json
 * @returns {Array<{pledgeId:string, ship:number, name:string, paidCents:number|null, msrpCents:number|null}>}
 */
export function ltiShips(hangarRaw, ships, aliases = null) {
  const out = [];
  for (const e of Object.values(hangarRaw?.entries ?? {})) {
    const p = e?.data;
    if (!p || e.goneSince) continue;
    if (classifyPledge(p) !== 'ship') continue;
    const items = p.items ?? [];
    const shipItems = items.filter((it) => it.kind === 'Ship');
    if (shipItems.length !== 1) continue;
    if (!items.some((it) => it.kind === 'Insurance' && LIFETIME.test(it.title ?? ''))) continue;
    const shipId = aliasShipId(aliases, shipItems[0].title) ?? findShipExact(ships, shipItems[0].title)?.id ?? null;
    const ship = shipId != null ? ships.get(shipId) : null;
    if (!ship) continue;
    out.push({
      pledgeId: String(p.pledgeId),
      ship: shipId,
      name: ship.name,
      paidCents: isUsd(p.value) ? p.value.cents : null,
      msrpCents: ship.msrp ?? null,
    });
  }
  return out;
}

/** plans.profile.tokens over the defaults. */
export function tokenSettings(plans) {
  const t = { ...DEFAULT_TOKENS, ...plans?.profile?.tokens };
  return { ...t, use: [...(t.use ?? [])], never: [...(t.never ?? [])] };
}

/**
 * The usable token pool: `use` pledges are admitted even above the limit, `never` pledges are
 * always dropped (never wins over use), and the rest must have an msrp at or under limitCents.
 * @param {ReturnType<typeof ltiShips>} lti
 * @param {{limitCents:number, use?:string[], never?:string[]}} settings
 */
export function tokenPool(lti, settings) {
  const use = new Set((settings.use ?? []).map(String));
  const never = new Set((settings.never ?? []).map(String));
  const limit = settings.limitCents;
  return lti
    .filter((t) => !never.has(t.pledgeId) && (use.has(t.pledgeId) || (t.msrpCents != null && t.msrpCents <= limit)))
    .sort(byPaid);
}

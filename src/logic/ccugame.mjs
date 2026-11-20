// Import of the CCU Game browser extension's "Saved Chains" file into planner goals. Pure.
import { N_, t } from './i18n.mjs';
import { aliasShipId, findShipExact } from './hangar.mjs';
import { tokenPool, tokenSettings } from './tokens.mjs';
import { startOf } from './chains.mjs';

export const NOT_SAVED_CHAINS = N_('This is not a CCU Game saved-chains file');

/** @returns {Array<{name:string, fromName:string, toName:string, longTerm:boolean}>} */
export function parseSavedChains(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error(t(NOT_SAVED_CHAINS)); }
  const chains = doc?.chains;
  if (!Array.isArray(chains) || !chains.every((c) => typeof c?.fromShipName === 'string' && typeof c?.toShipName === 'string')) {
    throw new Error(t(NOT_SAVED_CHAINS));
  }
  return chains.map((c) => ({
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `${c.fromShipName} -> ${c.toShipName}`,
    fromName: c.fromShipName,
    toName: c.toShipName,
    longTerm: c.options?.optimizationTarget === 'longTerm',
  }));
}

const matchShip = (name, { ships, aliases }) => {
  const id = aliasShipId(aliases, name) ?? findShipExact(ships, name)?.id ?? null;
  return id != null && ships.has(id) ? id : null;
};
const sameStart = (a, b) => a.kind === b.kind && (a.kind === 'token' || a.ship === b.ship);

/**
 * Sets start and status of rows whose `from`/`to` ids are known. Used by importRows and again
 * after the user fixes a ship on a needs-ship row.
 */
export function restatus(rows, { ships, plans, lti }) {
  const pool = tokenPool(lti ?? [], tokenSettings(plans));
  const seen = [...Object.values(plans?.chains ?? {})].map((c) => ({ target: c.target, start: startOf(c) }));
  return rows.map((r) => {
    const isToken = r.from != null && pool.some((t) => t.ship === r.from);
    const start = r.from == null && !isToken ? null : isToken ? { kind: 'token' } : { kind: 'ship', ship: r.from };
    if (r.to == null || start == null || (start.kind === 'ship' && (!ships.has(r.from) || r.from === r.to))) return { ...r, start, status: 'needs-ship' };
    if (seen.some((s) => s.target === r.to && sameStart(s.start, start))) return { ...r, start, status: 'exists' };
    seen.push({ target: r.to, start });
    return { ...r, start, status: 'new' };
  });
}

/** @returns {Array<{name,fromName,toName,from:number|null,to:number|null,start,mode:'watch'|'finish',status:'new'|'exists'|'needs-ship'}>} */
export function importRows(parsed, ctx) {
  const rows = parsed.map((p) => ({
    name: p.name,
    fromName: p.fromName,
    toName: p.toName,
    from: matchShip(p.fromName, ctx),
    to: matchShip(p.toName, ctx),
    mode: p.longTerm ? 'watch' : 'finish',
  }));
  return restatus(rows, ctx);
}

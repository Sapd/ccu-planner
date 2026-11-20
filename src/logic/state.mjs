// State actions shared by the CLI and the app. applyAction is pure: it works on
// deep copies of the plans and overrides documents and returns new ones. It
// never touches a document's rev; the store bumps rev when it saves.
// Three documents: plans, overrides (price + availability) and saleEvents.

import { addSaleEvent, removeSaleEvent, emptySaleEvents, AVAILABILITY, isDay } from './availability.mjs';
import { pairKey } from './urgency.mjs';
import { tokenSettings } from './tokens.mjs';
import { addChain, acceptRoute, releaseChain, setMode, setObjective, setLock, PRIORITY } from './chains.mjs';

/**
 * @param {{ plans: object, overrides: object, saleEvents?: object }} doc  documents as loaded
 * @param {object} action  one of the action types below
 * @param {{ ships?: Map, meta?: object }} [ctx]  ships checks ship ids when given;
 *   meta (catalogAt, hangarAt) is stored with accepted routes
 * @returns {{ plans: object, overrides: object, saleEvents: object, changed: 'plans'|'overrides'|'saleEvents', result?: any }}
 *
 * Action types:
 *   addChain { start, target, name?, priority?, mode? }  start: { kind:'token' } | { kind:'token', pledgeId } | { kind:'ship', ship }; result: the chain
 *   importGoals { rows }                                  adds each row with status 'new' in one save; result: the new chain ids
 *   setStart { chainId, start }                          also releases the accepted route
 *   setTokenSettings { tokens: { limitCents?, use?, never? } }
 *   markToken { pledgeId, mark: 'use'|'never'|null }
 *   accept { chainId, route }                            result: the accepted record; throws ConflictError
 *   release | remove { chainId }
 *   setMode | setObjective | setLock | setPriority { chainId, value }
 *   setCredit { cents }
 *   setPrice { shipId, cents, note? }                    result: the override
 *   clearPrice { shipId }
 *   setAvailability { shipId, value: 'regular'|'event-only', note? }   result: the override
 *   clearAvailability { shipId }
 *   setOfferEnd { from, to, until?: 'YYYY-MM-DD', soon?: true }      your note on one upgrade pair's offer ("runs until" or "ends soon"; stored in overrides.pairs); result: the note
 *   clearOfferEnd { from, to }
 *   setSaleEvent { name, from, to }                      result: the event (changed: 'saleEvents')
 *   removeSaleEvent { id }
 *   acceptFleet { plans: [{ chainId, route }] }          accepts the route of every goal that has none yet (accepted goals stay untouched)
 */
function checkStart(start) {
  if (!['token', 'ship'].includes(start?.kind)) throw new Error('start must be a token or a ship');
  if (start.kind === 'token' && start.pledgeId !== undefined && typeof start.pledgeId !== 'string') throw new Error('token pledgeId must be a string');
}

export function applyAction(doc, action, ctx = {}) {
  const plans = structuredClone(doc.plans);
  const overrides = structuredClone(doc.overrides);
  const saleEvents = structuredClone(doc.saleEvents ?? emptySaleEvents());
  const out = { plans, overrides, saleEvents, changed: 'plans' };
  const chain = (id) => {
    if (!Object.hasOwn(plans.chains, id)) throw new Error(`unknown chain ${id}`);
    return plans.chains[id];
  };

  switch (action.type) {
    case 'addChain': {
      if (action.start == null && action.base != null) action = { ...action, start: { kind: 'ship', ship: action.base } };
      if (action.start == null || action.target == null) throw new Error('addChain needs a start and a target ship');
      checkStart(action.start);
      action = { ...action, start: { ...action.start } };
      const fixed = action.start.kind === 'ship';
      if (fixed && action.start.ship === action.target) throw new Error('start and target must differ');
      for (const sid of fixed ? [action.start.ship, action.target] : [action.target]) {
        if (ctx.ships && !ctx.ships.has(sid)) throw new Error(`unknown ship ${sid}`);
      }
      const name = action.name ?? ctx.ships?.get(action.target)?.name;
      out.result = addChain(plans, { name, start: action.start, target: action.target, priority: action.priority, mode: action.mode });
      break;
    }
    case 'importGoals': {
      out.result = [];
      for (const r of action.rows ?? []) {
        if (r.status !== 'new') continue;
        checkStart(r.start);
        if (r.start.kind === 'ship' && r.start.ship === r.to) throw new Error('start and target must differ');
        for (const sid of r.start.kind === 'ship' ? [r.start.ship, r.to] : [r.to]) {
          if (ctx.ships && !ctx.ships.has(sid)) throw new Error(`unknown ship ${sid}`);
        }
        out.result.push(addChain(plans, { name: typeof r.name === 'string' && r.name ? r.name : ctx.ships?.get(r.to)?.name, start: { ...r.start }, target: r.to, mode: r.mode }).id);
      }
      break;
    }
    case 'setStart': {
      const c = chain(action.chainId);
      checkStart(action.start);
      if (action.start.kind === 'ship' && action.start.ship === c.target) throw new Error('start and target must differ');
      if (ctx.ships && action.start?.kind === 'ship' && !ctx.ships.has(action.start.ship)) throw new Error(`unknown ship ${action.start.ship}`);
      releaseChain(plans, action.chainId);
      c.start = { ...action.start };
      break;
    }
    case 'setTokenSettings': {
      const t = action.tokens ?? {};
      if (t.limitCents !== undefined && (!Number.isInteger(t.limitCents) || t.limitCents < 0)) throw new Error('token limit must be a whole number of cents');
      for (const k of ['use', 'never']) {
        if (t[k] !== undefined && !(Array.isArray(t[k]) && t[k].every((x) => typeof x === 'string'))) throw new Error(`${k} must be an array of strings`);
      }
      const cur = tokenSettings(plans);
      plans.profile.tokens = {
        limitCents: t.limitCents ?? cur.limitCents,
        use: t.use ? [...t.use] : cur.use,
        never: t.never ? [...t.never] : cur.never,
      };
      break;
    }
    case 'markToken': {
      if (![ 'use', 'never', null ].includes(action.mark)) throw new Error('mark must be use, never or null');
      const cur = tokenSettings(plans);
      const id = String(action.pledgeId);
      const t = { ...cur, use: cur.use.filter((x) => x !== id), never: cur.never.filter((x) => x !== id) };
      if (action.mark) t[action.mark].push(id);
      plans.profile.tokens = t;
      break;
    }
    case 'accept':
      chain(action.chainId);
      out.result = acceptRoute(plans, action.chainId, action.route, ctx.meta ?? {}, { graph: ctx.graph });
      break;
    case 'release':
      chain(action.chainId);
      releaseChain(plans, action.chainId);
      break;
    case 'remove':
      chain(action.chainId);
      delete plans.chains[action.chainId];
      break;
    case 'setMode':
      chain(action.chainId);
      setMode(plans, action.chainId, action.value);
      break;
    case 'setObjective':
      chain(action.chainId);
      setObjective(plans, action.chainId, action.value);
      break;
    case 'setLock':
      chain(action.chainId);
      setLock(plans, action.chainId, action.value);
      break;
    case 'setPriority':
      chain(action.chainId);
      if (!Object.hasOwn(PRIORITY, action.value)) throw new Error(`priority must be one of ${Object.keys(PRIORITY).join(', ')}`);
      plans.chains[action.chainId].priority = action.value;
      break;
    case 'setCredit':
      if (!Number.isInteger(action.cents) || action.cents < 0) throw new Error('credit must be zero or more whole cents');
      plans.profile.credit = action.cents;
      break;
    case 'setPrice':
      if (!Number.isInteger(action.cents) || action.cents <= 0) throw new Error('price must be a whole number of cents above zero');
      overrides.ships[action.shipId] = { ...overrides.ships[action.shipId], msrp: action.cents, note: action.note ?? null, setAt: new Date().toISOString() };
      out.result = overrides.ships[action.shipId];
      out.changed = 'overrides';
      break;
    case 'clearPrice': {
      const { msrp, note, setAt, ...rest } = overrides.ships[action.shipId] ?? {};
      if (Object.keys(rest).length) overrides.ships[action.shipId] = rest; // keeps an availability mark
      else delete overrides.ships[action.shipId];
      out.changed = 'overrides';
      break;
    }
    case 'setAvailability': {
      if (!AVAILABILITY.includes(action.value)) throw new Error(`availability must be one of ${AVAILABILITY.join(', ')}`);
      if (ctx.ships && !ctx.ships.has(action.shipId)) throw new Error(`unknown ship ${action.shipId}`);
      const { availabilityNote, ...rest } = overrides.ships[action.shipId] ?? {};
      overrides.ships[action.shipId] = { ...rest, availability: action.value, ...(action.note ? { availabilityNote: action.note } : {}) };
      out.result = overrides.ships[action.shipId];
      out.changed = 'overrides';
      break;
    }
    case 'clearAvailability': {
      const { availability, availabilityNote, ...rest } = overrides.ships[action.shipId] ?? {};
      if (Object.keys(rest).length) overrides.ships[action.shipId] = rest; // keeps an expected price
      else delete overrides.ships[action.shipId];
      out.changed = 'overrides';
      break;
    }
    case 'setOfferEnd': {
      if (action.soon !== true && !isDay(action.until)) throw new Error('an offer note needs a day (YYYY-MM-DD) or soon: true');
      if (ctx.ships && (!ctx.ships.has(action.from) || !ctx.ships.has(action.to))) throw new Error(`unknown ship in ${action.from}-${action.to}`);
      const note = action.soon === true ? { soon: true } : { until: action.until };
      overrides.pairs = { ...(overrides.pairs ?? {}), [pairKey(action.from, action.to)]: { ...note, setAt: new Date().toISOString() } };
      out.result = overrides.pairs[pairKey(action.from, action.to)];
      out.changed = 'overrides';
      break;
    }
    case 'clearOfferEnd': {
      const rest = { ...(overrides.pairs ?? {}) };
      delete rest[pairKey(action.from, action.to)];
      if (Object.keys(rest).length) overrides.pairs = rest; else delete overrides.pairs;
      out.changed = 'overrides';
      break;
    }
    case 'setSaleEvent': {
      const r = addSaleEvent(saleEvents, action);
      out.saleEvents = r.doc;
      out.result = r.event;
      out.changed = 'saleEvents';
      break;
    }
    case 'removeSaleEvent':
      out.saleEvents = removeSaleEvent(saleEvents, action.id);
      out.changed = 'saleEvents';
      break;
    case 'acceptFleet':
      // Already accepted goals stay as they are; only goals without an accepted route and with a route are accepted.
      for (const p of action.plans) if (p.route && plans.chains[p.chainId] && !plans.chains[p.chainId].accepted) acceptRoute(plans, p.chainId, p.route, ctx.meta ?? {}, { graph: ctx.graph });
      break;
    default:
      throw new Error(`unknown action ${action.type}`);
  }
  return out;
}

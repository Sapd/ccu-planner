// A CCU Game "Saved Chains" file chosen on the welcome screen before the store has been synced: the ship list is not
// there yet, so the file is parsed and kept (pending-import.json), and imported as goals after the sync. Pure.
import { parseSavedChains, importRows } from '../../../../src/logic/ccugame.mjs';
import { t, tn, N_ } from '../../../../src/logic/i18n.mjs';

export const PENDING_FILE = 'pending-import.json';
export const NO_CHAINS = N_('This CCU Game file has no saved chains');

/** The file's text -> the pending document. Throws the parser's message for a file that is not a saved-chains file. */
export function makePending(text, now = new Date()) {
  const chains = parseSavedChains(text);
  if (!chains.length) throw new Error(t(NO_CHAINS));
  return { version: 1, savedAt: now.toISOString(), chains };
}

const isChain = (c) => c && typeof c.name === 'string' && typeof c.fromName === 'string' && typeof c.toName === 'string' && typeof c.longTerm === 'boolean';

/** A stored document -> the pending import, or null for nothing or anything that is not one (a damaged file never blocks the app). */
export function readPending(doc) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.chains) || !doc.chains.length || !doc.chains.every(isChain)) return null;
  return { version: 1, savedAt: typeof doc.savedAt === 'string' ? doc.savedAt : null, chains: doc.chains.map((c) => ({ name: c.name, fromName: c.fromName, toName: c.toName, longTerm: c.longTerm })) };
}

export const pendingText = (n) => (n === 1 ? t('{n} saved chain ready — added as goals after the sync', { n }) : t('{n} saved chains ready — added as goals after the sync', { n }));

/** The import runs once the store (the ship list) and the hangar (the LTI tokens that goals can start from) are both synced. */
export const pendingReady = (app) => !!app?.data?.meta?.catalogAt && !!app?.data?.meta?.hangarAt;

/** Why a row was left out. Ships are never guessed: an unknown name is named here. */
export function skipReason(r, status = r.status) {
  if (status === 'exists') return t('This goal already exists.');
  const bits = [];
  if (r.to == null) bits.push(t('“{name}” is not a ship in the store list', { name: r.toName }));
  if (r.from == null) bits.push(t('“{name}” is not a ship in the store list', { name: r.fromName }));
  if (!bits.length && r.from === r.to) bits.push(t('it starts from the ship it upgrades to'));
  return bits.length ? `${bits.join('; ')}.` : t('A ship could not be matched.');
}

/**
 * The rows to import with the app's data, plus the summary the Goals import shows afterwards.
 * @param {{chains: object[]}} pending
 * @param {{ ships: Map, aliases: object, plans: object, lti: object[] }} ctx
 */
export function planPending(pending, ctx) {
  const rows = importRows(pending.chains, ctx);
  return { rows, count: rows.filter((r) => r.status === 'new').length };
}

/** @returns {{ added: number, skipped: { status: string, name: string, fromName: string, toName: string, reason: string }[] }} */
export function summarize(rows, added) {
  const skipped = rows.filter((r) => r.status !== 'new').map((r) => ({ status: r.status, name: r.name, fromName: r.fromName, toName: r.toName, reason: skipReason(r) }));
  return { added, skipped };
}

export const addedText = (n) => (n === 0 ? t('No new goals were added from your CCU Game file.') : tn(n, 'Added {n} goal from your CCU Game file.', 'Added {n} goals from your CCU Game file.'));

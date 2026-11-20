// The slow, on-demand questions as named jobs: one registry for the app's worker, the CLI and the MCP tools. Pure.
//
//   runJob(app, op, args, { onProgress, aliases })   -> the result (plain data)
//   jobKey(app, op, args)                            -> a cache key: (data stamps, document revisions, op, args)
//
// Ops: wanted { chainId, slack? } · whatIf { change } · buyEffect { from, to, kind, cash, maxCopies? } · checkOffer { from, to, kind, cash }
//      · compareCcuGame { text } · ownedInto { shipId, goalId? }
// whatIf, buyEffect and checkOffer take an optional `before`: summarize(session) of the app, so the first answer does not plan it again.
import { t } from './i18n.mjs';
import { sessionOf, sessionFor } from './session.mjs';
import { snapshotKey } from './changes.mjs';
import { whatIf, buyEffect } from './whatif.mjs';
import { checkOffer } from './offerCheck.mjs';
import { compareCcuGame } from './ccugameCompare.mjs';
import { ownedInto } from './ownedInto.mjs';

const OPS = {
  wanted: (app, { chainId, slack = 1000 }, { onProgress }) => sessionOf(app).wanted(chainId, slack, { onProgress }),
  whatIf: (app, { change, before = null }) => whatIf(app, change, { before }),
  buyEffect: (app, args) => buyEffect(app, args),
  checkOffer: (app, args) => checkOffer(app, args),
  compareCcuGame: (app, { text }, { aliases }) => compareCcuGame(app, text, { aliases }),
  ownedInto: (app, { shipId, goalId = null }) => ownedInto(app, shipId, { goalId }),
};

export const JOB_OPS = Object.keys(OPS);

/** Runs one job. `onProgress({ done, total })` is called by the jobs that can report it (wanted). */
export function runJob(app, op, args = {}, { onProgress = null, aliases = null } = {}) {
  const run = OPS[op];
  if (!run) throw new Error(t('unknown job {op}', { op: String(op) }));
  return run(app, args, { onProgress, aliases });
}

/**
 * Cache key of a job on this app: the sync stamps of its data (store, hangar, offers), the revisions of its documents, the op and
 * its arguments. The same key means the same answer, so a caller may keep the result until a document or the data changes.
 */
export function jobKey(app, op, args = {}) {
  const session = sessionFor(app);
  const { before, ...question } = args; // `before` is a copy of the current plan handed over for speed, not part of the question
  return JSON.stringify([snapshotKey(session), op, question]);
}

/**
 * The part of `data` the jobs read, small enough to copy to a worker: the history, pledges, buy-back list and plan snapshots
 * (big, only for display) are left out.
 */
export function jobData(data) {
  const { history, pledges, buyback, planSnapshots, review, ...rest } = data;
  return rest;
}

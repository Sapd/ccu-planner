// Runs the slow jobs of src/logic/jobs.mjs off the UI thread. No framework code and no Worker global: the worker and the
// transport are injected, so the message protocol is unit-tested with a fake worker (test/view/jobs.test.mjs).
//
// Messages (structured-clone safe):
//   main -> worker   { type: 'data', dataId, data }                          the planner data (jobData), sent once per data object
//                    { type: 'run', id, dataId, locale, docs: { plans, overrides, saleEvents }, op, args }   (locale: the language of the job's texts; the worker has its own module copy of it)
//   worker -> main   { type: 'progress', id, done, total } · { type: 'result', id, value } · { type: 'error', id, message }
// The client sends one job at a time. Cancelling the running job terminates the worker (the search is a tight loop that
// cannot listen for a message) and starts a fresh one for the next job; cancelling a queued job just drops it.
import { runJob, jobKey, jobData } from '../../../../src/logic/jobs.mjs';
import { buildGraph } from '../../../../src/logic/planner.mjs';
import { withDocs } from './derive.mjs';
import { getLocale, withLocale } from '../../../../src/logic/i18n.mjs';

export class JobCancelled extends Error {
  constructor() { super('cancelled'); this.name = 'JobCancelled'; }
}

const revsOf = (docs) => `${docs.plans?.rev ?? 0}|${docs.overrides?.rev ?? 0}|${docs.saleEvents?.rev ?? 0}${docs.saleEvents?.feedAt ? `|${docs.saleEvents.feedAt}` : ''}`;

/** The app object a job runs on, rebuilt in the worker from the copied data and documents (the graph is derived from the data, as deriveAppState does). */
export function workerApp(data, docs) {
  return withDocs({ data, graph: buildGraph(data) }, docs.plans, docs.overrides, docs.saleEvents);
}

/**
 * The worker's side. `post(message)` sends to the main thread. The app (and with it the planning session) of the latest data and
 * document revisions is kept, so a what-if and the search after it share one shared plan.
 */
export function createJobHost({ post, makeApp = workerApp, run = runJob, aliases = null }) {
  let data = null;
  let dataId = null;
  let cached = { key: null, app: null };
  return {
    handle(msg) {
      if (msg.type === 'data') {
        data = msg.data;
        dataId = msg.dataId;
        cached = { key: null, app: null };
        return;
      }
      if (msg.type !== 'run') return;
      const { id, op, args, docs } = msg;
      try {
        if (data == null || msg.dataId !== dataId) throw new Error('the worker has no data for this job');
        const key = `${dataId}|${revsOf(docs)}`;
        if (cached.key !== key) cached = { key, app: makeApp(data, docs) };
        const value = withLocale(msg.locale, () => run(cached.app, op, args, { aliases, onProgress: (p) => post({ type: 'progress', id, done: p.done, total: p.total }) }));
        post({ type: 'result', id, value });
      } catch (e) {
        post({ type: 'error', id, message: e?.message ?? String(e) });
      }
    },
  };
}

/**
 * The main thread's side.
 * @param {{ spawn: () => { postMessage(m: object): void, terminate(): void, onmessage: ((e: { data: object }) => void)|null, onerror: ((e: object) => void)|null }, cacheMax?: number }} opts
 * @returns {{ run(app, op, args, opts?: { onProgress?: (p: { done: number, total: number }) => void }): { key: string, cached: boolean, promise: Promise<any>, cancel(): void }, clear(): void }}
 * Results are cached by jobKey (data stamps, document revisions, op, arguments) and the generation of the loaded data, newest `cacheMax` kept, so asking the same
 * question again on unchanged data answers at once (`cached: true`). A rejected promise is a JobCancelled or an Error.
 */
// Each loaded data object is its own generation: two data sets (the real data and the sample) can carry equal stamps and
// revisions yet answer differently, so the cache key includes which load the answer was computed on.
const generations = new WeakMap();
let nextGeneration = 1;
const generationOf = (data) => {
  if (!data || typeof data !== 'object') return 0;
  if (!generations.has(data)) generations.set(data, nextGeneration++);
  return generations.get(data);
};

export function createJobClient({ spawn, cacheMax = 64 }) {
  let worker = null;
  let sentData = null; // the data object the live worker has
  let dataSeq = 0;
  let dataId = 0;
  let nextId = 1;
  let current = null;
  const queue = [];
  const live = new Map(); // key -> the queued or running job (one job answers every identical question)
  const cache = new Map();

  const drop = () => {
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
    worker = null;
    sentData = null;
  };
  const finish = (job, error, value) => {
    if (current === job) current = null;
    if (live.get(job.key) === job) live.delete(job.key);
    for (const w of job.waiters.splice(0)) (error ? w.reject(error) : w.resolve(value));
    pump();
  };
  const onMessage = (e) => {
    const m = e.data;
    if (!current || m?.id !== current.id) return;
    const job = current;
    if (m.type === 'progress') { job.last = { done: m.done, total: m.total }; for (const w of job.waiters) w.onProgress?.(job.last); }
    else if (m.type === 'result') {
      cache.set(job.key, m.value);
      if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
      finish(job, null, m.value);
    } else if (m.type === 'error') finish(job, new Error(m.message));
  };
  const onError = (e) => {
    const job = current;
    drop();
    if (job) finish(job, new Error(e?.message ?? 'the worker failed'));
  };
  function pump() {
    if (current || !queue.length) return;
    // The newest question first: the panel the user opened last is the one they are looking at. A job that has been passed over by
    // two newer ones runs next, so none waits behind more than two (an old panel is not starved by a stream of new questions).
    const starved = queue.findIndex((j) => j.passed >= 2);
    if (starved >= 0) current = queue.splice(starved, 1)[0];
    else { current = queue.pop(); for (const j of queue) j.passed++; }
    const job = current;
    try {
      if (!worker) {
        worker = spawn();
        worker.onmessage = onMessage;
        worker.onerror = onError;
      }
      if (sentData !== job.app.data) {
        dataId = ++dataSeq;
        sentData = job.app.data;
        worker.postMessage({ type: 'data', dataId, data: jobData(job.app.data) });
      }
      const { plans, overrides, saleEvents } = job.app;
      worker.postMessage({ type: 'run', id: job.id, dataId, locale: job.locale, docs: { plans, overrides, saleEvents }, op: job.op, args: job.args });
    } catch (e) {
      drop();
      finish(job, e);
    }
  }

  return {
    run(app, op, args = {}, { onProgress = null } = {}) {
      const locale = getLocale();
      const key = `${locale}:${generationOf(app.data)}:${jobKey(app, op, args)}`; // the texts of an answer are in one language
      if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return { key, cached: true, promise: Promise.resolve(value), cancel() {} };
      }
      let job = live.get(key);
      if (!job) {
        job = { id: nextId++, key, locale, app, op, args, waiters: [], last: null, passed: 0 };
        live.set(key, job);
        queue.push(job);
      } else { const at = queue.indexOf(job); if (at >= 0) { queue.splice(at, 1); queue.push(job); } } // asked again: it is the newest question now
      const waiter = { onProgress };
      const promise = new Promise((resolve, reject) => { waiter.resolve = resolve; waiter.reject = reject; });
      promise.catch(() => {}); // a caller that only cancels must not leave an unhandled rejection
      job.waiters.push(waiter);
      if (job.last) onProgress?.(job.last);
      const mine = job;
      pump();
      return {
        key, cached: false, promise,
        // Takes this caller off the job; the job itself stops when nobody waits for it any more.
        cancel() {
          const at = mine.waiters.indexOf(waiter);
          if (at < 0) return;
          mine.waiters.splice(at, 1);
          waiter.reject(new JobCancelled());
          if (mine.waiters.length) return;
          const queued = queue.indexOf(mine);
          if (queued >= 0) { queue.splice(queued, 1); live.delete(key); return; }
          if (current === mine) { drop(); finish(mine, new JobCancelled()); }
        },
      };
    },
    clear() { cache.clear(); },
  };
}

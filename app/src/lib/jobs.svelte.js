import { createJobClient, JobCancelled } from './view/jobs.mjs';
import { backendError } from './view/backendErrors.mjs';
import { sessionOf } from '../../../src/logic/session.mjs';
import { summarize } from '../../../src/logic/whatif.mjs';

// These jobs compare with the plan now, which the main thread already has: hand it over so the worker plans only the edited state.
const BEFORE_OPS = new Set(['whatIf', 'buyEffect', 'checkOffer']);

// One worker for the whole app; it is created on the first job.
const client = createJobClient({ spawn: () => new Worker(new URL('./worker/jobs.worker.js', import.meta.url), { type: 'module' }) });

/** Forgets every cached answer (the data set was swapped, e.g. sample data on or off). */
export const clearJobCache = () => client.clear();

/**
 * A reactive handle on one job at a time: start() replaces the previous run (which is cancelled), cancel() stops it.
 * status: 'idle' | 'running' | 'done' | 'error' | 'cancelled'. progress: { done, total } or null. value: the result.
 */
export class Job {
  status = $state('idle');
  progress = $state(null);
  value = $state.raw(null);
  error = $state(null);
  #run = null;

  start(app, op, args) {
    const full = BEFORE_OPS.has(op) ? { ...args, before: summarize(sessionOf(app)) } : args;
    const previous = this.#run;
    // Ask first, then let go of the old run: an identical question joins the job that is already running instead of restarting it.
    const run = client.run(app, op, full, { onProgress: (p) => { if (this.#run === run) this.progress = p; } });
    this.#run = run;
    previous?.cancel();
    this.status = 'running';
    this.progress = null;
    this.error = null;
    run.promise.then((value) => {
      if (this.#run !== run) return;
      this.value = value;
      this.status = 'done';
    }, (e) => {
      if (this.#run !== run) return;
      if (e instanceof JobCancelled) this.status = 'cancelled';
      else { this.status = 'error'; this.error = backendError(e); }
    });
    return run.promise;
  }

  cancel() {
    this.#run?.cancel();
  }

  reset() {
    this.#run?.cancel();
    this.#run = null;
    this.status = 'idle';
    this.value = null;
    this.progress = null;
    this.error = null;
  }
}

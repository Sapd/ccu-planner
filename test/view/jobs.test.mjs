import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobClient, createJobHost, JobCancelled, workerApp } from '../../app/src/lib/view/jobs.mjs';
import { setup } from '../support/ladder.mjs';

// A fake worker wired to a real host: messages cross by structured clone, asynchronously, like a Worker.
function fakeWorkers({ run, makeApp = workerApp } = {}) {
  const spawned = [];
  const spawn = () => {
    const w = { sent: [], terminated: false, onmessage: null, onerror: null };
    const hostOpts = { post: (m) => queueMicrotask(() => !w.terminated && w.onmessage?.({ data: structuredClone(m) })), makeApp };
    if (run) hostOpts.run = run;
    const host = createJobHost(hostOpts);
    w.postMessage = (m) => { w.sent.push(structuredClone(m)); queueMicrotask(() => !w.terminated && host.handle(structuredClone(m))); };
    w.terminate = () => { w.terminated = true; };
    spawned.push(w);
    return w;
  };
  return { spawn, spawned };
}
const types = (w) => w.sent.map((m) => m.type);
const demo = () => setup({ goals: [{ base: 1, target: 3 }] }).app;

test('a job answers with the result; data goes first, without the display-only parts', async () => {
  const { spawn, spawned } = fakeWorkers({ run: (app, op, args) => ({ op, args, goals: Object.keys(app.plans.chains).length }) });
  const client = createJobClient({ spawn });
  const app = demo();
  app.data = { ...app.data, history: [{ big: 1 }], pledges: [1], buyback: [1], planSnapshots: [1], review: [1] };
  const job = client.run(app, 'wanted', { chainId: 'c1' });
  assert.equal(job.cached, false);
  assert.deepEqual(await job.promise, { op: 'wanted', args: { chainId: 'c1' }, goals: 1 });
  assert.deepEqual(types(spawned[0]), ['data', 'run']);
  const { data } = spawned[0].sent[0];
  assert.ok(data.ships instanceof Map);
  for (const k of ['history', 'pledges', 'buyback', 'planSnapshots', 'review']) assert.equal(k in data, false, k);
});

test('progress reaches the caller, in order', async () => {
  const { spawn } = fakeWorkers({ run: (app, op, args, { onProgress }) => { onProgress({ done: 0, total: 3 }); onProgress({ done: 2, total: 3 }); onProgress({ done: 3, total: 3 }); return 'ok'; } });
  const client = createJobClient({ spawn });
  const seen = [];
  const job = client.run(demo(), 'wanted', { chainId: 'c1' }, { onProgress: (p) => seen.push(p) });
  assert.equal(await job.promise, 'ok');
  assert.deepEqual(seen, [{ done: 0, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
});

test('the same question on the same data and documents is answered from the cache', async () => {
  let runs = 0;
  const { spawn, spawned } = fakeWorkers({ run: () => ({ n: ++runs }) });
  const client = createJobClient({ spawn });
  const app = demo();
  const a = client.run(app, 'wanted', { chainId: 'c1', slack: 1000 });
  assert.deepEqual(await a.promise, { n: 1 });
  const b = client.run(app, 'wanted', { chainId: 'c1', slack: 1000 });
  assert.equal(b.cached, true);
  assert.deepEqual(await b.promise, { n: 1 });
  assert.equal(spawned[0].sent.filter((m) => m.type === 'run').length, 1);
  // another argument, or a new plans revision, is a new question
  assert.deepEqual(await client.run(app, 'wanted', { chainId: 'c1', slack: 2000 }).promise, { n: 2 });
  const edited = { ...app, plans: { ...app.plans, rev: 7 }, session: undefined };
  assert.equal(client.run(edited, 'wanted', { chainId: 'c1', slack: 1000 }).cached, false);
});

test('the cache keeps the newest entries only', async () => {
  const { spawn } = fakeWorkers({ run: (app, op, args) => args.n });
  const client = createJobClient({ spawn, cacheMax: 2 });
  const app = demo();
  for (const n of [1, 2, 3]) await client.run(app, 'x', { n }).promise;
  assert.equal(client.run(app, 'x', { n: 3 }).cached, true);
  assert.equal(client.run(app, 'x', { n: 1 }).cached, false);
});

test('an error in the job rejects with its message and the worker keeps working', async () => {
  const { spawn, spawned } = fakeWorkers({ run: (app, op) => { if (op === 'bad') throw new Error('boom'); return 'fine'; } });
  const client = createJobClient({ spawn });
  const app = demo();
  await assert.rejects(client.run(app, 'bad').promise, /boom/);
  assert.equal(await client.run(app, 'good').promise, 'fine');
  assert.equal(spawned.length, 1);
});

test('cancelling the running job ends the worker, rejects it and runs the next job on a fresh worker', async () => {
  let first = true;
  const { spawn, spawned } = fakeWorkers({ run: () => 'second' });
  // the first worker never answers
  const client = createJobClient({ spawn: () => { const w = spawn(); if (first) { first = false; w.postMessage = (m) => { w.sent.push(m); }; } return w; } });
  const app = demo();
  const a = client.run(app, 'slow', { n: 1 });
  const b = client.run(app, 'quick', { n: 2 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(types(spawned[0]), ['data', 'run'], 'only the running job was sent');
  a.cancel();
  await assert.rejects(a.promise, JobCancelled);
  assert.equal(spawned[0].terminated, true);
  assert.equal(await b.promise, 'second');
  assert.equal(spawned.length, 2);
  assert.deepEqual(types(spawned[1]), ['data', 'run'], 'the fresh worker gets the data again');
});

test('cancelling a queued job drops it without touching the worker', async () => {
  const { spawn, spawned } = fakeWorkers({ run: (app, op) => op });
  const client = createJobClient({ spawn });
  const app = demo();
  const a = client.run(app, 'first', { n: 1 });
  const b = client.run(app, 'second', { n: 2 });
  b.cancel();
  await assert.rejects(b.promise, JobCancelled);
  assert.equal(await a.promise, 'first');
  assert.equal(spawned[0].sent.filter((m) => m.type === 'run').length, 1);
  assert.equal(spawned[0].terminated, false);
});

test('a worker that fails rejects the running job and is replaced', async () => {
  const { spawn, spawned } = fakeWorkers({ run: () => 'ok' });
  let n = 0;
  const client = createJobClient({ spawn: () => { const w = spawn(); if (n++ === 0) w.postMessage = (m) => { w.sent.push(m); queueMicrotask(() => w.onerror?.({ message: 'crashed' })); }; return w; } });
  const app = demo();
  await assert.rejects(client.run(app, 'x', { n: 1 }).promise, /crashed/);
  assert.equal(await client.run(app, 'y', { n: 2 }).promise, 'ok');
  assert.equal(spawned.length, 2);
});

test('the host keeps one app (and its planning session) per data and document revisions', async () => {
  let made = 0;
  const { spawn } = fakeWorkers({ makeApp: (data, docs) => { made++; return workerApp(data, docs); }, run: () => 'ok' });
  const client = createJobClient({ spawn });
  const app = demo();
  await client.run(app, 'a', {}).promise;
  await client.run(app, 'b', {}).promise;
  assert.equal(made, 1);
  await client.run({ ...app, plans: { ...app.plans, rev: 1 }, session: undefined }, 'c', {}).promise;
  assert.equal(made, 2);
  // new data: sent again, app rebuilt
  await client.run({ ...app, data: { ...app.data }, session: undefined }, 'd', {}).promise;
  assert.equal(made, 3);
});

test('the real jobs through the protocol: what-ifs, the offer check and the wanted search on a worker-built app', async () => {
  const { spawn } = fakeWorkers();
  const client = createJobClient({ spawn });
  const { app, ids: [a] } = setup({ goals: [{ base: 2, target: 4 }] });
  const r = await client.run(app, 'buyEffect', { from: 2, to: 4, kind: 'warbond', cash: 3000 }).promise;
  assert.deepEqual(r.rows.map((x) => [x.copies, x.saved, x.extraSaved]), [[1, 7500, 7500], [2, 7500, 0]]);
  const seen = [];
  const w = await client.run(app, 'wanted', { chainId: a }, { onProgress: (p) => seen.push(p) }).promise;
  assert.equal(w.chainId, a);
  assert.ok(seen.length > 0 && seen.at(-1).done === seen.at(-1).total);
  const c = await client.run(app, 'checkOffer', { from: 2, to: 4, kind: 'warbond', cash: 3000 }).promise;
  assert.equal(c.verdict, 'Liberator gets $45 cheaper.');
  await assert.rejects(client.run(app, 'nope').promise, /unknown job/);
});

test('identical questions share one job; it stops only when every asker has cancelled', async () => {
  const { spawn, spawned } = fakeWorkers({ run: (app, op, args, { onProgress }) => { onProgress({ done: 1, total: 2 }); return 'shared'; } });
  const client = createJobClient({ spawn });
  const app = demo();
  const seenA = [];
  const seenB = [];
  const a = client.run(app, 'wanted', { chainId: 'c1' }, { onProgress: (p) => seenA.push(p) });
  const b = client.run(app, 'wanted', { chainId: 'c1' }, { onProgress: (p) => seenB.push(p) });
  assert.deepEqual([await a.promise, await b.promise], ['shared', 'shared']);
  assert.equal(spawned[0].sent.filter((m) => m.type === 'run').length, 1);
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 1);
});

test('one asker cancelling leaves the shared job running for the other', async () => {
  let first = true;
  const { spawn, spawned } = fakeWorkers({ run: () => 'late' });
  const client = createJobClient({ spawn: () => { const w = spawn(); if (first) { first = false; const real = w.postMessage; w.postMessage = (m) => { w.sent.push(m); if (m.type !== 'run') real(m); }; } return w; } });
  const app = demo();
  const a = client.run(app, 'wanted', { chainId: 'c1' });
  const b = client.run(app, 'wanted', { chainId: 'c1' });
  a.cancel();
  await assert.rejects(a.promise, JobCancelled);
  assert.equal(spawned[0].terminated, false, 'b still waits');
  b.cancel();
  await assert.rejects(b.promise, JobCancelled);
  assert.equal(spawned[0].terminated, true);
});

test('queued jobs run newest first, and asking a queued question again makes it the newest', async () => {
  const order = [];
  const { spawn } = fakeWorkers({ run: (app, op, args) => { order.push(args.n); return args.n; } });
  const client = createJobClient({ spawn });
  const app = demo();
  const first = client.run(app, 'x', { n: 1 }); // starts at once
  const p = [client.run(app, 'x', { n: 2 }), client.run(app, 'x', { n: 3 }), client.run(app, 'x', { n: 4 })];
  client.run(app, 'x', { n: 2 }); // asked again: now the newest
  await Promise.all([first.promise, ...p.map((j) => j.promise)]);
  assert.deepEqual(order, [1, 2, 4, 3]);
});

test('the before argument is not part of the cache key', async () => {
  const { jobKey } = await import('../../src/logic/jobs.mjs');
  const app = demo();
  assert.equal(jobKey(app, 'whatIf', { change: { a: 1 }, before: { total: 1 } }), jobKey(app, 'whatIf', { change: { a: 1 }, before: { total: 2 } }));
});

test('a queued job is never passed over by more than two newer ones', async () => {
  const order = [];
  const { spawn } = fakeWorkers({ run: (app, op, args) => { order.push(args.n); return args.n; } });
  const client = createJobClient({ spawn });
  const app = demo();
  const jobs = [1, 2, 3, 4, 5, 6].map((n) => client.run(app, 'x', { n })); // 1 starts at once; 2..6 queue
  await Promise.all(jobs.map((j) => j.promise));
  assert.deepEqual(order, [1, 6, 5, 2, 3, 4], 'newest first, but the ones passed over twice (2, 3, 4) then run oldest first');
});

test('two data sets with equal stamps and revisions (real vs sample) never share an answer, and clear() forgets', async () => {
  let runs = 0;
  const { spawn } = fakeWorkers({ run: () => ({ n: ++runs }) });
  const client = createJobClient({ spawn });
  const real = demo();
  const sample = { ...real, data: { ...real.data }, session: undefined }; // equal stamps and revisions, another load
  assert.deepEqual(await client.run(real, 'wanted', { chainId: 'c1' }).promise, { n: 1 });
  const other = client.run(sample, 'wanted', { chainId: 'c1' });
  assert.equal(other.cached, false);
  assert.deepEqual(await other.promise, { n: 2 });
  assert.equal(client.run(real, 'wanted', { chainId: 'c1' }).cached, true);
  client.clear();
  assert.equal(client.run(real, 'wanted', { chainId: 'c1' }).cached, false);
});

test('the language of a job reaches the host and the job runs in it; a language switch is a new question', async () => {
  const { getLocale, setLocale } = await import('../../src/logic/i18n.mjs');
  const { spawn, spawned } = fakeWorkers({ run: () => getLocale() });
  const client = createJobClient({ spawn });
  const app = demo();
  try {
    assert.equal(await client.run(app, 'wanted', { chainId: 'c1' }).promise, 'en');
    setLocale('de');
    const job = client.run(app, 'wanted', { chainId: 'c1' });
    assert.equal(job.cached, false);
    assert.equal(await job.promise, 'de');
    assert.deepEqual(spawned[0].sent.filter((m) => m.type === 'run').map((m) => m.locale), ['en', 'de']);
  } finally { setLocale('en'); }
  assert.equal(getLocale(), 'en');
});

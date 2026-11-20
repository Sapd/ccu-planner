<script>
  import ShipPicker from './ShipPicker.svelte';
  import { MODE_CHOICE, PRIORITY_CHOICE, NO_STARTER_TEXT, NO_HANGAR_TEXT, NO_STARTER_NOTE, SAMPLE_EXAMPLE_LABEL } from '$logic/describe.mjs';
  import { tokenPool, tokenSettings } from '$logic/tokens.mjs';
  import { starterState, sampleExample, endpointsText } from './view/addGoal.mjs';
  import { dispatch, ui, openGoal } from './state.svelte.js';
  import { sync } from './sync-actions.svelte.js';
  import { onDestroy, tick, untrack } from 'svelte';
  import { Job } from './jobs.svelte.js';
  import { addGoalText, signed } from '$logic/whatifText.mjs';
  import { usd } from '$logic/format.mjs';
  import JobStatus from './ui/JobStatus.svelte';

  let { app, ships, onclose } = $props();
  let fixed = $state(false);
  let base = $state(null);
  let target = $state(null);
  let name = $state('');
  let mode = $state('watch');
  let priority = $state('normal');
  let busy = $state(false);
  let touched = $state(false);
  let resets = $state(0); // the pickers keep their own text; a new key shows a value set from outside
  // Suggestions for the empty ship field: the ten dearest ships RSI sells as upgrades (the usual goals).
  const suggest = $derived([...ships.values()].filter((s) => s.msrp && !s.concept && s.standard !== false).sort((a, b) => b.msrp - a.msrp).slice(0, 10));

  // The usable LTI starting ships right now: the form says before saving whether the planner would find one.
  const pool = $derived(tokenPool(app.data.lti ?? [], tokenSettings(app.plans)));
  const starter = $derived(starterState({ fixed, poolCount: pool.length }));
  // Without a hangar sync the pool is empty because the planner has not seen the hangar, not because it has no LTI ship.
  const hangarSynced = $derived(!!app.data.meta?.hangarAt);
  const example = $derived(ui.sample ? sampleExample(ships) : null);
  const nameOf = (id) => (id == null ? null : ships.get(id)?.name ?? null);
  const endpoints = $derived(endpointsText({ state: starter, startName: nameOf(base), startPoolName: pool[0]?.name ?? null, targetName: nameOf(target) }));
  async function chooseShip() {
    fixed = true; touched = true;
    await tick();
    document.getElementById('add-from')?.focus();
  }
  function useExample() {
    if (!example) return;
    target = example.target; base = example.base; fixed = true; touched = true; resets += 1;
  }

  const problem = $derived(
    target == null ? 'Pick the ship you want.' : fixed && base == null ? 'Pick the starting ship, or switch back to Automatic.' : fixed && base === target ? 'Start and target must differ.' : null,
  );

  // The preview plans every goal again with this one added, in memory. Nothing is saved. A result is only shown for the
  // inputs it was made for; when they or the data change it runs again by itself.
  const job = new Job();
  onDestroy(() => job.cancel());
  const change = $derived({ addGoal: { target, start: fixed ? { kind: 'ship', ship: base } : { kind: 'token' }, priority, mode } });
  const sig = $derived(JSON.stringify(change));
  let previewSig = $state(null);
  let previewApp = $state.raw(null);
  const preview = $derived(job.status === 'done' && previewSig === sig && previewApp === app ? job.value : null);
  // The preview runs by itself once the goal can be planned, so the cost is on screen before "Add goal".
  $effect(() => {
    if (problem || starter === 'none') return;
    const current = sig; const a = app; // re-run when the inputs or the data change
    untrack(() => { previewSig = current; previewApp = a; job.start(a, 'whatIf', { change }); });
  });
  const goalCash = $derived(preview?.added[0]?.cash ?? null);

  async function submit(e) {
    e.preventDefault();
    if (problem || busy) return;
    busy = true;
    const chain = await dispatch({ type: 'addChain', start: fixed ? { kind: 'ship', ship: base } : { kind: 'token' }, target, name: name.trim() || undefined, mode, priority });
    busy = false;
    if (chain) { openGoal(chain.id); onclose(); }
  }
</script>

<form class="add" onsubmit={submit}>
  <h3>New goal</h3>
  {#if example}
    <p><button type="button" class="example" data-sample-example onclick={useExample}>{SAMPLE_EXAMPLE_LABEL}</button></p>
  {/if}
  {#key resets}<ShipPicker {ships} bind:value={target} label="Ship you want" id="add-to" {suggest} onpick={() => { touched = true; }} />{/key}
  <fieldset class="starts">
    <legend>Starts from</legend>
    <label class="check"><input type="radio" name="add-start" value={false} bind:group={fixed} onchange={() => { touched = true; }} /> Automatic: the cheapest LTI ship you own</label>
    <label class="check"><input type="radio" name="add-start" value={true} bind:group={fixed} onchange={() => { touched = true; }} /> A ship I choose</label>
  </fieldset>
  {#if fixed}
    {#key resets}<ShipPicker {ships} bind:value={base} label="Starting ship" id="add-from" />{/key}
  {:else if starter === 'none'}
    <div class="nostarter" role="status" data-no-starter>
      <p>{hangarSynced ? NO_STARTER_TEXT : NO_HANGAR_TEXT}</p>
      <p class="actions">
        {#if !hangarSynced}<button type="button" disabled={ui.syncBusy} onclick={() => sync('hangar')}>{ui.syncBusy ? 'Syncing…' : 'Sync hangar'}</button>{/if}
        <button type="button" onclick={chooseShip}>Choose a ship</button>
      </p>
    </div>
  {/if}
  {#if endpoints}
    <p class="endpoints" data-endpoints>{endpoints}{#if goalCash != null} · {goalCash === 0 ? 'no new cash needed' : `${usd(goalCash)} new cash`}{/if}</p>
  {/if}
  <label>Name <input bind:value={name} placeholder="optional" /></label>
  <div class="row">
    <label>How to buy <select bind:value={mode}>{#each Object.entries(MODE_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}</select><span class="fine">{mode === 'watch' ? 'Cheapest: waits for sales when that saves money.' : 'Fastest: buys what is available now.'}</span></label>
    <label>Priority <select bind:value={priority}>{#each Object.entries(PRIORITY_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}</select><span class="fine">Goals with higher priority get first pick of your CCUs and credit.</span></label>
  </div>
  {#if problem && touched}<p class="hint">{problem}</p>{/if}
  <div class="row">
    <button type="submit" disabled={!!problem || busy}>{starter === 'none' ? 'Add goal without a starter' : 'Add goal'}</button>
    <button type="button" onclick={onclose}>Cancel</button>
  </div>
  <JobStatus {job} what="Planning all goals again" />
  {#if starter === 'none' && !problem}<p class="help" data-no-starter-note>{NO_STARTER_NOTE}</p>{/if}
  {#if preview}
    <div class="preview" data-preview>
      <p>{addGoalText(preview)}</p>
      {#if preview.deltas.length}
        <ul>{#each preview.deltas as d (d.id)}<li>{d.name}: {d.was == null ? 'no route' : usd(d.was)} → {d.now == null ? 'no route' : usd(d.now)}{d.delta != null ? ` (${signed(d.delta)})` : ''}</li>{/each}</ul>
      {/if}
      <p class="help">Nothing is saved until you add the goal.</p>
    </div>
  {/if}
</form>

<style>
  .add { display: grid; gap: 10px; max-width: 520px; }
  h3 { margin: 0; font-size: 16px; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .row label { flex: 1 1 200px; }
  button[type='submit'] { background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 700; }
  .endpoints { margin: 0; font-weight: 600; }
  .nostarter { padding: 8px 12px; border-radius: 10px; border: 1px solid var(--warn); }
  .nostarter p { margin: 0 0 6px; color: var(--warn); font-size: 13px; }
  .nostarter p:last-child { margin: 0; }
  .nostarter .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .example { border-color: var(--accent); color: var(--accent); }
  .starts { display: grid; gap: 4px; margin: 0; padding: 0; border: 0; }
  .starts legend { padding: 0; margin-bottom: 4px; color: var(--muted); font-size: 12px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .help { margin: 0; color: var(--muted); font-size: 12px; }
  .fine { color: var(--muted); font-size: 12px; }
  .hint { margin: 0; color: var(--warn); font-size: 12px; }
  .preview { display: grid; gap: 6px; padding: 8px 12px; border-radius: 10px; background: rgba(76, 194, 255, 0.1); }
  .preview p { margin: 0; }
  .preview ul { margin: 0; padding-left: 18px; color: var(--muted); }
</style>

<script>
  import { t } from '$logic/i18n.mjs';
  import { onDestroy, untrack } from 'svelte';
  import { Job } from '../jobs.svelte.js';
  import { removeGoalText, signed } from '$logic/whatifText.mjs';
  import { usd } from '$logic/format.mjs';
  import JobStatus from '../ui/JobStatus.svelte';

  // "Without this goal": plans every other goal again as if this one did not exist. Nothing is saved.
  let { app, chain } = $props();
  const job = new Job();
  $effect(() => {
    const current = app; // read outside untrack: a changed plan or data runs it again
    const args = { change: { removeGoal: chain.id } };
    untrack(() => job.start(current, 'whatIf', args));
  });
  onDestroy(() => job.cancel());
  const r = $derived(job.status === 'done' ? job.value : null);
</script>

<div class="without">
  <JobStatus {job} what={t('Planning the other goals again')} />
  {#if r}
    <p data-without>{removeGoalText(r)}</p>
    {#if r.deltas.length}
      <ul>
        {#each r.deltas as d (d.id)}
          <li>{d.name}: {d.was == null ? t('no route') : usd(d.was)} → {d.now == null ? t('no route') : usd(d.now)} {#if d.delta != null}<span class="d">({signed(d.delta)})</span>{/if}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .without { display: flex; flex-direction: column; gap: 6px; }
  p { margin: 0; }
  ul { margin: 0; padding-left: 18px; color: var(--muted); }
  .d { font-variant-numeric: tabular-nums; }
</style>

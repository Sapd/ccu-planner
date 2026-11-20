<script>
  import { onDestroy, untrack } from 'svelte';
  import { Job } from './jobs.svelte.js';
  import { buyRowText, buyVerdictText } from '$logic/whatifText.mjs';
  import JobStatus from './ui/JobStatus.svelte';

  // "If I buy this": what owning 1 or 2 new copies of this CCU does to your goals (a what-if, nothing is saved or bought).
  let { app, from, to, kind, cash } = $props();
  const job = new Job();
  let open = $state(false);
  let copies = $state(1);
  const uid = $props.id();

  // Starts when opened and again when the documents change under it; the worker answers identical questions from its cache.
  $effect(() => {
    if (!open) return;
    const current = app; // read here, not inside untrack: a changed plan or data runs the job again
    const args = { from, to, kind, cash, maxCopies: 2 };
    untrack(() => job.start(current, 'buyEffect', args));
  });
  onDestroy(() => job.cancel());
  const row = $derived(job.status === 'done' ? job.value.rows[copies - 1] : null);
</script>

<span class="wi">
  <button type="button" class="toggle" aria-expanded={open} aria-controls="wi-{uid}" onclick={() => { open = !open; }}>If I buy this {open ? '▴' : '▾'}</button>
  {#if open}
    <span class="body" id="wi-{uid}">
      <span class="pick" role="group" aria-label="How many copies">
        <label><input type="radio" bind:group={copies} value={1} /> 1 copy</label>
        <label><input type="radio" bind:group={copies} value={2} /> 2 copies</label>
      </span>
      <JobStatus {job} what="Planning again" />
      {#if row}
        <span class="out" data-whatif>{buyRowText(row)}</span>
        {#if copies === 2 && buyVerdictText(job.value)}<span class="out" data-whatif-verdict>{buyVerdictText(job.value)}</span>{/if}
      {/if}
    </span>
  {/if}
</span>

<style>
  .wi { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .toggle { font-size: 12px; padding: 2px 10px; }
  .body { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px; border-radius: 8px; background: rgba(76, 194, 255, 0.1); font-size: 13px; }
  .pick { display: flex; gap: 14px; }
  .pick label { display: inline-flex; align-items: center; gap: 4px; }
  .out { color: var(--text); }
</style>

<script>
  import { onDestroy, untrack } from 'svelte';
  import { Job } from '../jobs.svelte.js';
  import JobStatus from '../ui/JobStatus.svelte';
  import OfferVerdict from './OfferVerdict.svelte';

  // "Check against my goals" on one offer row: the same check as the deal checker, with the row's pair, kind and price.
  let { app, from, to, kind, cash } = $props();
  const job = new Job();
  $effect(() => {
    const current = app; // read here: a changed plan or data checks again
    const offer = { from, to, kind, cash };
    untrack(() => job.start(current, 'checkOffer', offer));
  });
  onDestroy(() => job.cancel());
  const name = (id) => app.data.ships.get(id)?.name ?? 'unknown ship';
  const r = $derived(job.status === 'done' ? job.value : null);
</script>

<div class="inline" data-inline-check>
  <JobStatus {job} what="Checking" />
  {#if r}<OfferVerdict {r} {name} />{/if}
</div>

<style>
  .inline { display: grid; gap: 6px; max-width: 60ch; }
</style>

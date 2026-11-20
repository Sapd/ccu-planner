<script>
  // The state of a Job (jobs.svelte.js): a spinner with progress and a Cancel button while it runs, a note when it was cancelled or failed.
  let { job, what = 'Calculating', unit = 'pairs' } = $props();
</script>

{#if job.status === 'running'}
  <span class="job">
    <span role="status"><i class="spin" aria-hidden="true"></i>
    {what}{job.progress ? ` · checked ${job.progress.done} of ${job.progress.total} ${unit}` : '…'}</span>
    <button type="button" onclick={() => job.cancel()}>Cancel</button>
  </span>
{:else if job.status === 'cancelled'}
  <span class="note">Stopped waiting.</span>
{:else if job.status === 'error'}
  <span class="err" role="alert">{job.error}</span>
{/if}

<style>
  .job { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
  .job button { font-size: 12px; padding: 2px 10px; }
  .job [role='status'] { display: inline-flex; align-items: center; gap: 8px; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--glass-border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .note { color: var(--muted); font-size: 13px; }
  .err { color: var(--warn); font-size: 13px; }
</style>

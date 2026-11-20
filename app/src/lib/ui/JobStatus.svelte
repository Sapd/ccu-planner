<script>
  import { t } from '$logic/i18n.mjs';
  // The state of a Job (jobs.svelte.js): a spinner with progress and a Cancel button while it runs, a note when it was cancelled or failed.
  let { job, what = null, unit = null } = $props();
  // `what` and `unit` come from the caller already in the current language; the defaults are ours.
  const label = $derived(what ?? t('Calculating'));
  const unitLabel = $derived(unit ?? t('pairs'));
</script>

{#if job.status === 'running'}
  <span class="job">
    <span role="status"><i class="spin" aria-hidden="true"></i>
    {label}{job.progress ? ` · ${t('checked {done} of {total} {unit}', { done: job.progress.done, total: job.progress.total, unit: unitLabel })}` : '…'}</span>
    <button type="button" onclick={() => job.cancel()}>{t('Cancel')}</button>
  </span>
{:else if job.status === 'cancelled'}
  <span class="note">{t('Stopped waiting.')}</span>
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

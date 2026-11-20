<script>
  // "Coming from CCU Game?" on the first steps. With the store's ship list the file goes through the same preview and confirm
  // as on Goals; without it the file is checked and kept, and imported after the sync (pending-import.svelte.js).
  import ImportGoals from './goals/ImportGoals.svelte';
  import FilePick from './ui/FilePick.svelte';
  import { ui } from './state.svelte.js';
  import { stagePending, removePending } from './pending-import.svelte.js';
  import { pendingText } from './view/pendingImport.mjs';

  let { app = null } = $props();
  let error = $state(null);
  async function choose(file) {
    error = null;
    try { await stagePending(file); } catch (e) { error = e?.message ?? String(e); }
  }
  const lead = 'Coming from CCU Game?';
</script>

<div class="ccu" data-ccugame>
  {#if ui.pending}
    <div class="pick" role="status">
      <span class="lead">{lead}</span>
      <span class="ready">{pendingText(ui.pending.chains.length)}</span>
      <button type="button" class="quiet" onclick={removePending}>Remove</button>
    </div>
  {:else if app}
    <ImportGoals {app} embedded {lead} />
  {:else}
    <div class="pick">
      <span class="lead">{lead}</span>
      <FilePick label="Import CCU Game file" inputLabel="Saved Chains file from CCU Game" onfile={choose} />
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .lead { color: var(--muted); }
  .ready { color: var(--text); }
  .error { margin: 6px 0 0; color: var(--warn); font-size: 13px; }
  .quiet { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; }
</style>

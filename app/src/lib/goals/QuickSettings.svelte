<script>
  import { tick } from 'svelte';
  import { MODE_CHOICE, LOCK_CHOICE, PRIORITY_CHOICE, settingsSummary } from '$logic/describe.mjs';
  import { dispatch } from '../state.svelte.js';
  import GlassPanel from '../ui/GlassPanel.svelte';
  import StartControl from './StartControl.svelte';

  // The settings that re-plan the goal (start, how to buy, priority, lock): one summary line that opens into the editable controls.
  // chain: the saved goal; pool: the usable LTI tokens; ships: Map id -> ship; startLine: the goal's start text.
  let { chain, pool = [], ships, startLine = null } = $props();
  const uid = $props.id();
  let open = $state(false);
  let startCtl = $state(null);
  let editBtn = $state(null);
  export async function chooseFixedStart() { open = true; await tick(); startCtl?.chooseFixed(); }
  const onkeydown = (e) => { if (e.key === 'Escape' && open) { open = false; editBtn?.focus(); } };
  const set = (type, value) => dispatch({ type, chainId: chain.id, value });
</script>

<GlassPanel class="quick" aria-label="Settings for this goal" {onkeydown}>
  <div class="sumrow">
    <p class="summary" data-settings-summary>{settingsSummary(chain, startLine)}</p>
    <button type="button" bind:this={editBtn} aria-expanded={open} aria-controls="quick-{uid}" onclick={() => { open = !open; }}>{open ? 'Close settings' : 'Edit settings'}</button>
  </div>
  {#if open}
  <p class="caption">A change updates the prices and the chain.</p>
  <div class="row" id="quick-{uid}">
    <StartControl bind:this={startCtl} {chain} {pool} {ships} />
    <label>How to buy
      <select value={chain.mode ?? 'watch'} onchange={(e) => set('setMode', e.currentTarget.value)}>
        {#each Object.entries(MODE_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
    <label>Priority
      <select value={chain.priority ?? 'normal'} onchange={(e) => set('setPriority', e.currentTarget.value)}>
        {#each Object.entries(PRIORITY_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
    <label>Lock the price of the last step
      <select value={chain.lock ?? 'auto'} onchange={(e) => set('setLock', e.currentTarget.value)}>
        {#each Object.entries(LOCK_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
  </div>
  {/if}
</GlassPanel>

<style>
  .sumrow { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; }
  .summary { margin: 0; color: var(--muted); font-size: 13px; flex: 1 1 320px; min-width: 0; }
  .caption { margin: 10px 0 8px; color: var(--muted); font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: flex-start; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  select { max-width: 280px; }
</style>

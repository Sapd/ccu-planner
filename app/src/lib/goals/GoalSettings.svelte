<script>
  import { OBJECTIVE_CHOICE } from '$logic/describe.mjs';
  import { usd } from '$logic/format.mjs';
  import { dispatch } from '../state.svelte.js';
  import { goalLabel } from '$logic/ships.mjs';

  // chain: the saved goal; allIn: its all-in figure in cents (what you already paid counted too) or null.
  // ships: Map id -> ship (for the remove question). Start, how to buy, priority and lock are in QuickSettings.
  let { chain, allIn = null, ships } = $props();
  let confirmRemove = $state(false);
  const set = (type, value) => dispatch({ type, chainId: chain.id, value });
  const objective = $derived(chain.objective ?? 'cash');
</script>

<div class="settings">
  <div class="row">
    <label>What counts
      <select value={objective} onchange={(e) => set('setObjective', e.currentTarget.value)}>
        {#each Object.entries(OBJECTIVE_CHOICE) as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
    <p class="allin">All-in, including what you already paid: <b>{usd(allIn)}</b></p>
  </div>

  <div class="remove">
    {#if confirmRemove}
      <span>Remove {goalLabel(chain, ships)}?</span>
      <button type="button" class="danger" onclick={() => dispatch({ type: 'remove', chainId: chain.id })}>Yes, remove</button>
      <button type="button" onclick={() => { confirmRemove = false; }}>Cancel</button>
    {:else}
      <button type="button" class="danger" onclick={() => { confirmRemove = true; }}>Remove goal</button>
    {/if}
  </div>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: end; }
  .row label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .allin { margin: 0; }
  .remove { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .danger { border-color: var(--warn); color: var(--warn); }
</style>

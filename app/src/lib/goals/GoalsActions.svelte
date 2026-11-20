<script>
  import { sessionOf } from '$logic/session.mjs';
  import { IMPORT_BUTTON } from '$logic/describe.mjs';
  import { ui } from '../state.svelte.js';

  // The Goals page header: Import from CCU Game, Reserve all chains and + New goal sit together.
  let { app } = $props();
  const fleet = $derived(Object.keys(app.plans.chains).length >= 2 ? sessionOf(app).fleet() : null);
  // Reserve all only touches goals that have a route and no reserved chain yet; reserved goals stay as they are.
  const canReserveAll = $derived(!!fleet && fleet.plans.some((p) => p.route && !app.plans.chains[p.chainId]?.accepted));
</script>

<button type="button" data-import-goals onclick={() => { ui.importingGoals = true; }}>{IMPORT_BUTTON}</button>
{#if canReserveAll}
  <button type="button" data-reserve-all aria-expanded={ui.reserveAllOpen} onclick={() => { ui.reserveAllOpen = !ui.reserveAllOpen; }}>Reserve all chains…</button>
{/if}
<button type="button" class="primary" onclick={() => { ui.addingGoal = true; }}>+ New goal</button>

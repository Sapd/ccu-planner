<script>
  import { t } from '$logic/i18n.mjs';
  import { ui } from '../state.svelte.js';
  import { goalLabel } from '$logic/ships.mjs';

  // Pick the goal the Advanced graphs explain. "None" shows the whole network.
  let { app } = $props();
  const chains = $derived(Object.values(app.plans.chains));
</script>

<label class="pick">{t('Goal')}
  <select value={ui.selected ?? ''} onchange={(e) => { ui.selected = e.currentTarget.value || null; }}>
    <option value="">{t('None (whole network)')}</option>
    {#each chains as c (c.id)}<option value={c.id}>{goalLabel(c, app.data.ships)}</option>{/each}
  </select>
</label>

<style>
  .pick { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); margin-bottom: 12px; }
  select { min-width: 220px; }
</style>

<script>
  import { t, tn } from '$logic/i18n.mjs';
  import { usd } from '$logic/format.mjs';
  import { shortDay } from '$logic/availability.mjs';
  import { todayView } from '../view/today.mjs';
  import { virtualRows } from '../view/virtual.mjs';
  import { dispatch, openGoalFrom } from '../state.svelte.js';
  import VirtualCcuDialog from './VirtualCcuDialog.svelte';

  // The virtual CCUs on the Hangar's Upgrades view: a list with edit and delete, and the add dialog.
  let { app } = $props();
  const ships = $derived(app.data.ships);
  const routes = $derived(new Map(todayView(app).goals.map((g) => [g.goalId, { name: g.targetName ?? g.name, route: { steps: (g.journey?.steps ?? []).map((x) => x.step) } }])));
  const rows = $derived(virtualRows(app.plans, ships, routes));
  let editing = $state(undefined); // undefined: closed, null: new, else the record
  let busy = $state(false);
  const remove = async (r) => {
    if (!confirm(t('Delete the virtual CCU {from} → {to}? A chain you reserved with it keeps it.', { from: r.fromName, to: r.toName }))) return;
    busy = true;
    try { await dispatch({ type: 'removeVirtualCcu', id: r.id }); } finally { busy = false; }
  };
</script>

<section class="virtual" data-virtual-ccus aria-labelledby="virtual-h">
  <div class="head">
    <h4 id="virtual-h">{t('Virtual CCUs ({count})', { count: rows.length })}</h4>
    <button type="button" onclick={() => { editing = null; }} data-add-virtual>{t('Add virtual CCU')}</button>
  </div>
  {#if rows.length}
    <ul>
      {#each rows as r (r.id)}
        <li class:expired={r.expired} data-virtual={r.id}>
          <span class="pair"><b>{r.fromName} → {r.toName}</b>
            <span class="muted">{usd(r.cents)}{r.savings != null ? ` · ${t('saves {amount}', { amount: usd(r.savings) })}` : ''} · {tn(r.copies, '{n} copy', '{n} copies')}{r.expires ? ` · ${r.expired ? t('expired {date}', { date: shortDay(r.expires) }) : t('until {date}', { date: shortDay(r.expires) })}` : ''}</span>
            {#if r.note}<span class="note">{r.note}</span>{/if}
            {#if r.usedBy.length}<span class="used">{t('Used by')} {#each r.usedBy as g, i (g.goalId)}{i ? ', ' : ''}<button type="button" class="link" onclick={() => openGoalFrom(g.goalId, t('Back to Hangar'))}>{g.name}</button>{/each}</span>{:else if !r.expired}<span class="muted">{t('No goal uses it now.')}</span>{/if}
          </span>
          <span class="acts">
            <button type="button" disabled={busy} onclick={() => { editing = r; }}>{t('Edit')}</button>
            <button type="button" disabled={busy} onclick={() => remove(r)}>{t('Delete')}</button>
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('An upgrade you can get outside the RSI store (from a friend, a trade or a coming sale) can be added here, and plans will use it at the price you give.')}</p>
  {/if}
</section>

{#if editing !== undefined}
  {#key editing?.id ?? 'new'}<VirtualCcuDialog {ships} ccu={editing} onsave={(action) => dispatch(action)} onclose={() => { editing = undefined; }} />{/key}
{/if}

<style>
  .virtual { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  h4 { margin: 0; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--glass-border); }
  li.expired { opacity: 0.6; }
  .pair { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
  .acts { display: flex; gap: 6px; flex-shrink: 0; }
  .muted, .used { color: var(--muted); font-size: 13px; }
  .note { font-size: 13px; font-style: italic; }
  .link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
  p { margin: 0; }
</style>

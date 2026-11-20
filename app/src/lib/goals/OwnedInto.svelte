<script>
  import { t } from '$logic/i18n.mjs';
  import { ownedInto } from '$logic/ownedInto.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipThumb from '../ShipThumb.svelte';

  // "CCUs you own into this ship": the owned CCUs that end at the goal's target, and what each copy is used for.
  // The list says what each copy is used for, which looks at every goal's route and lock cover: it is only worked out when its tab is open.
  let { app, chain } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => ships.get(id)?.name ?? t('unknown ship');
  const r = $derived(ownedInto(app, chain.target, { goalId: chain.id }));
</script>

<div>
  <ul data-owned-into>
      {#each r.groups as g (g.from)}
        <li>
          <span class="from"><ShipThumb ship={ships.get(g.from) ?? null} size="xs" /> {g.fromName} → {name(chain.target)} <b>×{g.count}</b></span>
          <ul class="copies">
            {#each g.copies as c (c.copyId)}
              <li class={c.use.kind}>{c.use.text}<span class="paid">{c.paid != null ? ` · ${t('paid {amount}', { amount: usd(c.paid) })}` : ''}{c.giftable ? ` · ${t('giftable')}` : ''}</span></li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
</div>

<style>
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .from { display: inline-flex; align-items: center; gap: 6px; }
  .copies { margin: 2px 0 0 26px; gap: 2px; font-size: 13px; color: var(--muted); }
  .copies .used { color: var(--text); }
  .copies .cover { color: var(--held); }
  .paid { color: var(--muted); }
</style>

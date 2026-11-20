<script>
  import { t } from '$logic/i18n.mjs';
  import { valueLabel } from '../view/hangar.mjs';
  import RsiLink from '../RsiLink.svelte';
  import { hangarUrl } from '$logic/links.mjs';

  // The Other pledges view: paints, equipment and the rest as one compact list. items: [{ item: pledge, key }].
  let { items, onopen } = $props();
  const contains = (p) => p.items.map((it) => `${it.title}${it.kind ? ` (${it.kind})` : ''}`).join(', ');
</script>

<div class="wrap">
  <table aria-label={t('Other pledges')}>
    <thead><tr><th scope="col">{t('Pledge')}</th><th scope="col">{t('Contains')}</th><th scope="col">{t('Added')}</th><th scope="col" class="num">{t('Value')}</th><th scope="col"><span class="sr">{t('Marks and link')}</span></th></tr></thead>
    <tbody>
      {#each items as { item: p, key } (key)}
        <tr data-pledge={p.pledgeId} data-category={p.category}>
          <td class="name"><button type="button" class="link" onclick={() => onopen(p.pledgeId)}>{p.name}</button></td>
          <td class="muted contains" title={contains(p)}>{contains(p)}</td>
          <td class="muted nowrap">{p.created ?? ''}</td>
          <td class="num">{valueLabel(p.value)}</td>
          <td class="marks">{#if p.giftable}<span class="tag" title={t('You can gift this pledge to another account')}>{t('Giftable')}</span>{/if}{#if p.reclaimable}<span class="tag" title={t('If you melt it, RSI lets you buy it back later')}>{t('Reclaimable')}</span>{/if}<RsiLink href={hangarUrl()} label={t('Hangar')} aria={t('Open {name} in the RSI hangar', { name: p.name })} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; padding: 4px 8px; color: var(--muted); font-weight: 600; white-space: nowrap; }
  td { padding: 5px 8px; height: 38px; border-top: 1px solid var(--glass-border); vertical-align: middle; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--muted); }
  .nowrap { white-space: nowrap; }
  .name { max-width: 320px; }
  .contains { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .marks { display: flex; gap: 4px; align-items: center; justify-content: flex-end; white-space: nowrap; }
  .link { background: none; border: none; padding: 0; color: var(--text); text-align: left; font-weight: 600; text-decoration: underline dotted; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>

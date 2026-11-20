<script>
  import { t } from '$logic/i18n.mjs';
  // What the automatic CCU Game import did after the first sync: what was added and what was left out, with the reason.
  import { ui } from './state.svelte.js';
  import { IMPORT_GROUPS } from '$logic/describe.mjs';
  import { addedText } from './view/pendingImport.mjs';
  import GlassPanel from './ui/GlassPanel.svelte';

  const r = $derived(ui.importResult);
  const groups = $derived(r ? Object.entries(IMPORT_GROUPS).filter(([s]) => s !== 'new').map(([status, title]) => ({ title, items: r.skipped.filter((x) => x.status === status) })).filter((g) => g.items.length) : []);
</script>

{#if r}
  <GlassPanel class="summary" role="status" aria-label={t('CCU Game import')}>
    <h2>{t('CCU Game import')}</h2>
    <p class="added">{addedText(r.added)}</p>
    {#each groups as g (g.title)}
      <h3>{t('Left out')} · {t(g.title)} <span class="n">{g.items.length}</span></h3>
      <ul>{#each g.items as x, i (i)}<li><b>{x.toName}</b> <span class="muted">{t('from {name}', { name: x.fromName })}</span> <span class="muted">· {x.reason}</span></li>{/each}</ul>
    {/each}
    <p><button type="button" onclick={() => { ui.importResult = null; }}>{t('Dismiss')}</button></p>
  </GlassPanel>
{/if}

<style>
  h2 { margin: 0 0 6px; font-size: 16px; }
  h3 { margin: 10px 0 4px; font-size: 13px; color: var(--muted); }
  .n { font-weight: 400; }
  .added { margin: 0; }
  ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: 13px; }
  .muted { color: var(--muted); }
  p:last-child { margin: 10px 0 0; }
</style>

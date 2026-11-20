<script>
  import { tick } from 'svelte';
  import { t } from '$logic/i18n.mjs';
  import { glossaryList } from '$logic/glossary.mjs';
  import { matchesQuery, searchText } from '$logic/search.mjs';
  import { ui, closeGlossary } from './state.svelte.js';

  // The words the planner uses, one short entry each. ui.glossary names the entry to bring into view ('' = the top).
  let dialog = $state(null);
  let filter = $state('');
  const shown = $derived(glossaryList().filter((e) => matchesQuery(searchText(e.term, e.text), filter)));
  const focusables = () => [...(dialog?.querySelectorAll('button:not([disabled]), input') ?? [])];
  const onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeGlossary(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], end = f[f.length - 1];
    if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  };
  // Where focus was when the panel opened; it goes back there on close (as the Explainer does).
  const opener = ui.glossaryOpener;
  $effect(() => () => { if (opener?.isConnected) opener.focus(); });
  // Focus stays on the Close button (the only control, so Tab is trapped); the asked-for entry is scrolled into view.
  $effect(() => {
    const key = ui.glossary;
    if (!dialog) return;
    tick().then(() => {
      dialog.querySelector('.close')?.focus();
      if (key) dialog.querySelector(`[data-term="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  });
</script>

<div class="backdrop" role="presentation" {onkeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="gl-title" tabindex="-1" bind:this={dialog}>
    <header><h2 id="gl-title">{t('Glossary')}</h2><button type="button" class="close" onclick={closeGlossary}>{t('Close')}</button></header>
    <label class="find">{t('Find a word')} <input type="search" bind:value={filter} placeholder={t('For example melt, LTI, chain')} /></label>
    <dl>
      {#each shown as e (e.key)}
        <div class="entry" class:on={ui.glossary === e.key}>
          <dt data-term={e.key}>{e.term}</dt>
          <dd>{e.text}</dd>
        </div>
      {/each}
      {#if !shown.length}<p class="none">{t('No word matches “{filter}”.', { filter })}</p>{/if}
    </dl>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: 16px; background: rgba(5, 8, 14, 0.7); }
  .dialog { width: min(560px, 100%); max-height: 85vh; overflow: auto; padding: 20px 24px; border-radius: var(--radius); background: #121a2b; border: 1px solid var(--glass-border); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }
  .dialog:focus { outline: none; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  h2 { margin: 0; font-size: 20px; }
  .find { display: grid; gap: 4px; margin-bottom: 12px; color: var(--muted); font-size: 12px; }
  .find input { width: 100%; box-sizing: border-box; font-size: 14px; padding: 6px 8px; }
  .none { color: var(--muted); margin: 0; }
  dl { margin: 0; display: grid; gap: 12px; }
  .entry { padding: 6px 8px; border-radius: 8px; }
  .entry.on { background: rgba(76, 194, 255, 0.1); }
  dt { font-weight: 700; }
  dd { margin: 2px 0 0; color: var(--muted); line-height: 1.45; }
</style>

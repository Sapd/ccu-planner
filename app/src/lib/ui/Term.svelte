<script>
  import { t } from '$logic/i18n.mjs';
  import { glossaryEntry } from '$logic/glossary.mjs';
  import { openGlossary } from '../state.svelte.js';

  // A small "?" that opens the Glossary at the term's entry. With `label`, the whole label is the button (a bigger target;
  // the "?" stays small): <Term term="melt" label="Melt" />.
  let { term, label = '' } = $props();
  const entry = $derived(glossaryEntry(term));
</script>

{#if entry}
  {#if label}
    <button type="button" class="termlabel" aria-label={t('{label}: what is {term}?', { label, term: entry.term })} title={t('What is {term}?', { term: entry.term })} onclick={(e) => openGlossary(term, e.currentTarget)}>{label}<span class="q" aria-hidden="true">?</span></button>
  {:else}
    <button type="button" class="term" aria-label={t('What is {term}?', { term: entry.term })} title={t('What is {term}?', { term: entry.term })} onclick={(e) => openGlossary(term, e.currentTarget)}>?</button>
  {/if}
{/if}

<style>
  .term { width: 24px; height: 24px; padding: 0; border-radius: 50%; font-size: 12px; line-height: 1; color: var(--muted); vertical-align: middle; margin-left: 4px; }
  .termlabel { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font: inherit; color: inherit; background: none; border: 1px solid var(--glass-border); }
  .q { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; font-size: 10px; line-height: 1; color: var(--muted); border: 1px solid var(--glass-border); }
</style>

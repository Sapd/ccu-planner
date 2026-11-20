<script>
  import { t } from '$logic/i18n.mjs';
  import { SECTIONS, SECTION_LABEL } from '../view/nav.mjs';

  let { current, onselect } = $props();
</script>

<nav aria-label={t('Sections')}>
  {#each SECTIONS as s (s)}
    <button type="button" class:active={current === s} aria-current={current === s ? 'page' : undefined} onclick={() => onselect(s)}>{t(SECTION_LABEL[s])}</button>
  {/each}
</nav>

<style>
  nav { display: flex; gap: 4px; }
  button { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 14px; color: var(--muted); font-weight: 600; font-size: 15px; }
  button:hover:not(:disabled) { background: none; color: var(--text); }
  button.active { color: var(--text); border-bottom-color: var(--accent); }
</style>

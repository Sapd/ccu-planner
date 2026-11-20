<script>
  import { t } from '$logic/i18n.mjs';
  import { ui, goBack } from '../state.svelte.js';
</script>

{#if ui.back}
  <p class="back"><button type="button" class="backbtn" data-back onclick={goBack}><span aria-hidden="true">←</span> {t(ui.back.label)}</button></p>
{/if}

<style>
  /* Stays at the top while the page scrolls, so the way back is always in reach. */
  .back { margin: 0; position: sticky; top: 0; z-index: var(--z-strip); padding: 6px 0; background: rgba(10, 14, 22, 0.92); }
  .backbtn { background: none; border: 0; padding: 2px 0; color: var(--link); text-decoration: underline; font: inherit; cursor: pointer; }
  .backbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
</style>

<script>
  import { t, N_ } from '$logic/i18n.mjs';
  import { dispatch } from '../state.svelte.js';

  // The override of one LTI ship pledge: "Default" follows the starting ship price limit.
  let { pledgeId, settings } = $props();
  const mark = $derived(settings.use.includes(pledgeId) ? 'use' : settings.never.includes(pledgeId) ? 'never' : null);
  const CHOICES = [['use', N_('Use as starting ship')], ['never', N_('Never use as starting ship')], [null, N_('Default')]];
</script>

<div class="mark" role="group" aria-label={t('Starting ship setting')}>
  {#each CHOICES as [value, label] (label)}
    <button type="button" class:on={mark === value} aria-pressed={mark === value} onclick={() => { if (mark !== value) dispatch({ type: 'markToken', pledgeId, mark: value }); }}>{#if mark === value}<span aria-hidden="true">✓ </span>{/if}{t(label)}</button>
  {/each}
</div>

<style>
  .mark { display: inline-flex; flex-wrap: wrap; gap: 0; }
  button { border-radius: 0; padding: 3px 10px; font-size: 12px; }
  button:first-child { border-radius: 8px 0 0 8px; } button:last-child { border-radius: 0 8px 8px 0; }
  button.on { border-color: var(--accent); background: rgba(76, 194, 255, 0.18); }
</style>

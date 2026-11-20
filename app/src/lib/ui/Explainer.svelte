<script>
  import { t } from '$logic/i18n.mjs';
  import { tick, untrack } from 'svelte';
  import { EXPLAINER_STEPS, EXPLAINER_TITLES, markExplainerSeen } from '../view/firstRun.mjs';
  import { openGlossary } from '../state.svelte.js';

  // inline: all three steps as a static list (empty states). Otherwise a modal three-step overlay.
  let { inline = false, onclose = () => {}, returnTo: opener = null } = $props();
  let step = $state(0);
  let dialog = $state(null);
  // Whatever had the focus when this opened: the Glossary gives the focus back there, the dialog's own button is gone by then.
  // The Help button passes itself in: the menu item that opened this is gone by then.
  const returnTo = untrack(() => opener) ?? (typeof document !== 'undefined' ? document.activeElement : null);
  const last = EXPLAINER_STEPS.length - 1;

  const storage = () => { try { return localStorage; } catch { return null; } };
  const close = () => { markExplainerSeen(storage()); onclose(); };

  const focusables = () => [...(dialog?.querySelectorAll('button:not([disabled])') ?? [])];
  const onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], end = f[f.length - 1];
    if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  };
  const go = async (n) => { step = n; await tick(); (dialog?.querySelector('.primary') ?? focusables()[0])?.focus(); };

  $effect(() => { if (!inline && dialog) dialog.querySelector('.primary')?.focus(); });
</script>

{#if inline}
  <div class="inline" role="note" aria-label={t('How CCUs work')}>
    <h2>{t('How CCUs work')}</h2>
    <ol>{#each EXPLAINER_STEPS as s (s)}<li>{t(s)}</li>{/each}</ol>
    <button type="button" class="gloss" onclick={(e) => openGlossary('', e.currentTarget)}>{t('Glossary: what the words mean')}</button>
  </div>
{:else}
  <div class="backdrop" role="presentation" {onkeydown}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="ex-title" tabindex="-1" bind:this={dialog}>
      <p class="count">{t('How CCUs work · step {n} of {total}', { n: step + 1, total: EXPLAINER_STEPS.length })}</p>
      <h2 id="ex-title">{t(EXPLAINER_TITLES[step])}</h2>
      <p class="text" aria-live="polite">{t(EXPLAINER_STEPS[step])}</p>
      <div class="dots" aria-hidden="true">{#each EXPLAINER_STEPS as _, i (i)}<span class:on={i === step}></span>{/each}</div>
      <p class="glossrow"><button type="button" class="gloss" onclick={() => { close(); openGlossary('', returnTo); }}>{t('Glossary: what the words mean')}</button></p>
      <div class="btns">
        <button type="button" disabled={step === 0} onclick={() => go(step - 1)}>{t('Back')}</button>
        {#if step < last}
          <button type="button" class="primary" onclick={() => go(step + 1)}>{t('Next')}</button>
        {:else}
          <button type="button" class="primary" onclick={close}>{t('Done')}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: 16px; background: rgba(5, 8, 14, 0.7); }
  .dialog { width: min(480px, 100%); padding: 24px; border-radius: var(--radius); background: #121a2b; border: 1px solid var(--glass-border); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); animation: pop 0.18s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(6px); } }
  .dialog:focus { outline: none; }
  h2 { margin: 0 0 10px; font-size: 20px; }
  .count { margin: 0 0 4px; color: var(--muted); font-size: 12px; }
  .text { margin: 0 0 16px; font-size: 16px; line-height: 1.5; min-height: 4.5em; }
  .dots { display: flex; gap: 6px; margin-bottom: 16px; }
  .dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--own); }
  .dots span.on { background: var(--accent); }
  .btns { display: flex; justify-content: space-between; }
  .primary { padding: 6px 18px; }
  .inline { text-align: left; max-width: 520px; margin: 0 auto 20px; padding: 12px 16px; border-radius: 10px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--glass-border); }
  .inline h2 { font-size: 15px; margin-bottom: 6px; }
  .gloss { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; }
  .glossrow { margin: 0 0 14px; }
  .inline .gloss { margin-top: 8px; }
  .inline ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
</style>

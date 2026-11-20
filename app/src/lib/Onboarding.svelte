<script>
  import { t, N_ } from '$logic/i18n.mjs';
  import { onboardingSteps, syncProgressView, ONBOARDING_TITLE } from './view/onboarding.mjs';
  import { ui, enterSample, goSection } from './state.svelte.js';
  import { login, syncFirstRun } from './sync-actions.svelte.js';
  import CcuGameRow from './CcuGameRow.svelte';

  // The first steps: sign in, sync, pick a goal. Used on the welcome screen and on an empty Today.
  // welcome: on the welcome screen the page title above already says what this is, so the "Get started" heading is left out.
  let { app = null, welcome = false } = $props();
  const steps = $derived(onboardingSteps({ session: ui.session, app }));
  const busy = $derived(ui.syncBusy || ui.signingIn || ui.switching);
  // While a sync runs, the goal step waits for it and shows how far it is instead of its button.
  const progress = $derived(ui.syncBusy ? syncProgressView(ui.syncProgress) : null);
  const act = {
    signin: () => login(),
    sync: () => syncFirstRun(app),
    goal: () => { ui.addingGoal = true; goSection('goals'); },
  };
  const label = { signin: N_('Connect my RSI account'), sync: N_('Sync store and hangar'), goal: N_('Pick your first goal') };
  // A goal needs the store's ships: that step opens once the store has been synced.
  const ready = (step) => step.key !== 'goal' || !!app;
  // The button of a step: the next one, and the goal step as soon as it can be opened.
  const hasButton = (step) => step.next || (step.key === 'goal' && !step.done && ready(step));
</script>

<!-- Sync and sign-in are off while sample data is shown, so the steps that need them are not offered. -->
{#if !ui.sample}
<section class="steps" class:welcome aria-label={t(ONBOARDING_TITLE)}>
  {#if !welcome}<h2>{t(ONBOARDING_TITLE)}</h2>{/if}
  <ol>
    {#each steps as step, i (step.key)}
      <li class:done={step.done} class:next={step.next} data-step={step.key} aria-current={step.next ? 'step' : undefined}>
        <span class="mark" aria-hidden="true">{step.done ? '✓' : i + 1}</span>
        <div class="body">
          <p class="title"><b>{step.title}</b>{#if step.note}<span class="note"><span class="sep" aria-hidden="true">·</span>{step.note}</span>{/if}</p>
          {#if step.text}<p class="text">{step.text}</p>{/if}
          {#if step.key === 'goal' && progress}
            <div class="progress" role="status" data-sync-progress>
              <p class="text">{t('Wait: {text}', { text: progress.text })}</p>
              {#if progress.max}<progress value={progress.value} max={progress.max}></progress>{:else}<progress></progress>{/if}
            </div>
          {/if}
        </div>
        {#if hasButton(step) && !(step.key === 'goal' && progress)}
          <button type="button" class:primary={step.next} disabled={busy || !ready(step)} onclick={act[step.key]}>{busy && step.key !== 'goal' ? t('Working…') : t(label[step.key])}</button>
        {/if}
      </li>
    {/each}
  </ol>
  <div class="more">
    <CcuGameRow {app} />
    <p class="sample"><button type="button" class="link" disabled={busy} onclick={enterSample}>{t('Not ready? Explore a sample chain')}</button></p>
  </div>
</section>
{/if}

<style>
  .steps { text-align: left; max-width: 560px; margin: 0 auto; display: grid; gap: 18px; }
  .steps.welcome { max-width: none; margin: 0; }
  h2 { margin: 0; font-size: 18px; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 4px 14px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--glass-border); opacity: 0.8; }
  li.next { opacity: 1; border-color: var(--accent); background: rgba(76, 194, 255, 0.08); }
  li.done { opacity: 0.65; }
  .mark { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--own); font-size: 13px; font-weight: 700; }
  li.next .mark { background: var(--accent); color: var(--on-accent); }
  li.done .mark { background: var(--now); color: var(--on-accent); }
  .body { min-width: 0; }
  .title { margin: 0; }
  .text { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
  .note { color: var(--muted); font-size: 13px; }
  .sep { margin: 0 0.5em; }
  .more { display: grid; gap: 12px; }
  .progress { display: grid; gap: 6px; margin-top: 6px; }
  .progress .text { margin: 0; color: var(--text, inherit); }
  progress { width: 100%; height: 8px; accent-color: var(--accent); }
  .sample { margin: 0; }
  .link { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; }
  .link:hover:not(:disabled) { background: none; }
  @media (max-width: 480px) {
    li { grid-template-columns: 24px 1fr; }
    li button { grid-column: 2; justify-self: start; }
  }
</style>

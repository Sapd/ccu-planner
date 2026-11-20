<script>
  import { t } from '$logic/i18n.mjs';
  import { tokenSettings } from '$logic/tokens.mjs';
  import { dispatch } from '../state.svelte.js';

  // The price limit: ships up to this store price count as starting ships. Typed in dollars, saved in cents.
  let { plans } = $props();
  const uid = $props.id();
  const limit = $derived(tokenSettings(plans).limitCents);
  let text = $state(null); // null while the field shows the saved value
  let problem = $state('');

  async function commit() {
    if (text == null) return;
    const dollars = Number(text);
    if (text.trim() === '' || !Number.isFinite(dollars) || dollars < 0) {
      problem = t('Enter an amount of 0 or more.');
      return;
    }
    problem = '';
    const cents = Math.round(dollars * 100);
    text = null;
    if (cents !== limit) await dispatch({ type: 'setTokenSettings', tokens: { limitCents: cents } });
  }
</script>

<div class="limit">
  <label for="limit-{uid}">{t('Starting ship price limit (store price, $)')}</label>
  <input id="limit-{uid}" type="number" min="0" step="1" inputmode="decimal" value={text ?? String(limit / 100)}
    oninput={(e) => { text = e.currentTarget.value; }} onchange={commit} onkeydown={(e) => { if (e.key === 'Enter') commit(); }} aria-invalid={problem ? 'true' : undefined} />
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</div>

<style>
  .limit { display: grid; gap: 4px; max-width: 220px; }
  label { color: var(--muted); font-size: 12px; }
  .problem { margin: 0; color: var(--warn); font-size: 12px; }
</style>

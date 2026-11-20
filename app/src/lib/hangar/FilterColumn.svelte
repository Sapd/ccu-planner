<script>
  import { t } from '$logic/i18n.mjs';
  import { groupActive } from '../view/filters.mjs';
  import Term from '../ui/Term.svelte';

  // The filter column: plain checkboxes under a heading per group, "(reset)" for a group that is not at its start state.
  // groups/sel: see view/filters.mjs; counts: { groupId: { optionId: n } } (how many each option would show).
  let { groups, sel, counts = {}, label = undefined, ontoggle, onreset, onrange } = $props();
  const uid = $props.id();
</script>

<div class="col" role="group" aria-label={label ?? t('Filters')}>
  {#each groups as g (g.id)}
    <div class="grp" role="group" aria-labelledby="{uid}-{g.id}">
      <div class="head">
        <span class="gl" id="{uid}-{g.id}" title={g.help ? t(g.help) : undefined}>{t(g.label)}</span>{#if g.term}<Term term={g.term} />{/if}
        {#if groupActive(groups, sel, g.id)}<button type="button" class="reset" onclick={() => onreset(g.id)} aria-label={t('Reset {label}', { label: t(g.label) })}>{t('(reset)')}</button>{/if}
      </div>
      {#if g.kind === 'range'}
        <div class="range">
          <input type="text" inputmode="decimal" placeholder={t('From $')} aria-label={t('{label}: from, in dollars', { label: t(g.label) })} value={sel[g.id].min} oninput={(e) => onrange(g.id, 'min', e.currentTarget.value)} />
          <span aria-hidden="true">–</span>
          <input type="text" inputmode="decimal" placeholder={t('Up to $')} aria-label={t('{label}: up to, in dollars', { label: t(g.label) })} value={sel[g.id].max} oninput={(e) => onrange(g.id, 'max', e.currentTarget.value)} />
        </div>
      {:else}
        {#each g.options as o (o.id)}
          {@const n = counts[g.id]?.[o.id]}
          {@const on = (sel[g.id] ?? []).includes(o.id)}
          <label class="opt" class:zero={n === 0 && !on}>
            <input type="checkbox" checked={on} onchange={() => ontoggle(g.id, o.id)} />
            <span class="ol">{t(o.label)}</span>
            {#if n != null}<span class="n">{n}</span>{/if}
          </label>
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style>
  .col { display: flex; flex-direction: column; gap: 14px; }
  .grp { display: flex; flex-direction: column; gap: 3px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .gl { margin-right: auto; font-weight: 700; font-size: 13px; color: var(--accent); }
  .reset { background: none; border: none; padding: 0; color: var(--muted); font-size: 12px; text-decoration: underline; }
  .opt { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 13px; cursor: pointer; }
  .opt input { margin: 0; flex: none; accent-color: var(--accent); }
  .ol { flex: 1; min-width: 0; }
  .n { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .zero { opacity: 0.6; }
  .range { display: flex; align-items: center; gap: 6px; }
  .range input { width: 0; flex: 1; min-width: 0; padding: 3px 6px; font-size: 13px; }
</style>

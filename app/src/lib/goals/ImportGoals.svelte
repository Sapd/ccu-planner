<script>
  import { t } from '$logic/i18n.mjs';
  import { parseSavedChains, importRows, restatus } from '$logic/ccugame.mjs';
  import { IMPORT_HELP, IMPORT_GROUPS, IMPORT_NEEDS_SHIP_HELP, importConfirmLabel } from '$logic/describe.mjs';
  import aliases from '../../../../src/logic/aliases.json';
  import ShipPicker from '../ShipPicker.svelte';
  import { dispatch } from '../state.svelte.js';
  import { onDestroy } from 'svelte';
  import { Job } from '../jobs.svelte.js';
  import { signed } from '$logic/whatifText.mjs';
  import { usd } from '$logic/format.mjs';
  import JobStatus from '../ui/JobStatus.svelte';
  import FilePick from '../ui/FilePick.svelte';

  // embedded: inside the first-run steps. The heading and help are the step's, the picker is a button, and Cancel only clears the preview.
  let { app, onclose = () => {}, embedded = false, lead = '' } = $props();
  let rows = $state(null);
  let error = $state(null);
  let busy = $state(false);
  let fileText = $state(null);
  // "Compare": CCU Game's cost for each chain against the planner's for the matching goal. Nothing is imported.
  const compare = new Job();
  onDestroy(() => compare.cancel());
  const cmp = $derived(compare.status === 'done' ? compare.value : null);
  let cmpApp = $state.raw(null);
  const outdated = $derived(compare.status === 'done' && cmpApp !== app);
  const runCompare = () => { cmpApp = app; compare.start(app, 'compareCcuGame', { text: fileText }); };

  const ctx = $derived({ ships: app.data.ships, aliases, plans: app.plans, lti: app.data.lti ?? [] });
  const groups = $derived(Object.entries(IMPORT_GROUPS).map(([status, title]) => ({ status, title, items: (rows ?? []).map((r, i) => ({ r, i })).filter((x) => x.r.status === status) })));
  const count = $derived((rows ?? []).filter((r) => r.status === 'new').length);

  async function choose(file) {
    error = null;
    rows = null;
    fileText = null;
    compare.reset();
    try {
      const text = await file.text();
      rows = importRows(parseSavedChains(text), ctx);
      fileText = text;
    } catch (err) { error = err?.message ?? String(err); }
  }
  // Picks the ship for the side that failed to match, then recomputes every row's status.
  function fix(i, side, ship) {
    rows = restatus(rows.map((r, j) => (j === i ? { ...r, [side]: ship.id } : r)), ctx);
  }
  function reset() { rows = null; error = null; fileText = null; compare.reset(); }
  async function confirm() {
    if (busy || !count) return;
    busy = true;
    const added = await dispatch({ type: 'importGoals', rows });
    busy = false;
    if (added) { if (embedded) reset(); onclose(); }
  }
  const shipName = (id) => app.data.ships.get(id)?.name ?? t('unknown ship');
</script>

<section class="import" class:embedded>
  {#if embedded}
    <div class="pick">
      {#if lead}<span class="lead">{lead}</span>{/if}
      <FilePick label={t('Import CCU Game file')} inputLabel={t('Saved Chains file from CCU Game')} onfile={choose} />
    </div>
  {:else}
    <h3>{t('Import from CCU Game')}</h3>
    <p class="help">{t(IMPORT_HELP)}</p>
    <input type="file" accept=".json" aria-label={t('Saved file from CCU Game')} onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) choose(f); }} />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if rows}
    {#each groups as g (g.status)}
      {#if g.items.length}
        <div class="group">
          <h4>{t(g.title)} <span class="n">{g.items.length}</span></h4>
          <ul>
            {#each g.items as { r, i } (i)}
              <li class:dim={g.status === 'exists'}>
                <span class="line"><b>{r.toName}</b> <span class="from">{t('from {name}', { name: r.fromName })}</span></span>
                {#if g.status === 'needs-ship'}
                  <span class="fix">
                    <span class="help">{t(IMPORT_NEEDS_SHIP_HELP)}</span>
                    {#if r.to == null}<ShipPicker ships={app.data.ships} id="imp-to-{i}" label={t('Ship you want ({name})', { name: r.toName })} onpick={(s) => fix(i, 'to', s)} />{/if}
                    {#if r.start == null || r.from === r.to}<ShipPicker ships={app.data.ships} id="imp-from-{i}" label={t('Start from ({name})', { name: r.fromName })} onpick={(s) => fix(i, 'from', s)} />{/if}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
  {/if}

  <div class="row">
    {#if rows}<button type="button" class="primary" disabled={!count || busy} onclick={confirm}>{importConfirmLabel(count)}</button>{/if}
    {#if fileText && !embedded}<button type="button" disabled={compare.status === 'running'} onclick={runCompare}>{t('Compare')}</button>{/if}
    {#if !embedded || rows || error}<button type="button" onclick={embedded ? reset : onclose}>{t('Cancel')}</button>{/if}
  </div>
  <JobStatus job={compare} what={t('Comparing with your goals')} />
  {#if cmp}
    <div class="compare" data-compare class:stale={outdated}>
      <h4>{t('CCU Game against the planner')}</h4>
      {#if outdated}<p class="note" data-outdated>{t('Outdated: your goals or data changed since this comparison. Press Compare again.')}</p>{/if}
      <table>
        <thead><tr><th scope="col">{t('Chain')}</th><th scope="col">CCU Game</th><th scope="col">{t('Its start ship')}</th><th scope="col">{t('Planner')}</th><th scope="col">{t('Difference')}</th></tr></thead>
        <tbody>
          {#each cmp.rows as r, i (i)}
            <tr>
              <td><b>{r.target}</b> <span class="from">{t('from {name}', { name: r.ccugameStart })}</span>
                {#each r.notes as n, k (k)}<div class="note">{n}</div>{/each}</td>
              <td class="num">{usd(r.ccugameCashNoStart)}</td>
              <td class="num">{r.startCost ? usd(r.startCost) : '–'}</td>
              <td class="num">{r.goalId ? usd(r.ourCash) : '–'}{#if r.ourAlone != null && r.ourAlone !== r.ourCash}<div class="note">{t('If planned alone')} · {usd(r.ourAlone)}</div>{/if}</td>
              <td class="num">{r.diff == null ? '–' : signed(r.diff)}</td>
            </tr>
          {/each}
        </tbody>
        {#if cmp.totals.matched}
          <tfoot><tr><th scope="row">{t('Total of the {n} matched goals', { n: cmp.totals.matched })}</th><td class="num">{usd(cmp.totals.ccugame)}</td><td class="num">{cmp.totals.startCosts ? usd(cmp.totals.startCosts) : '–'}</td><td class="num">{usd(cmp.totals.ours)}</td><td class="num">{signed(cmp.totals.diff)}</td></tr></tfoot>
        {/if}
      </table>
      {#if cmp.onlyOurs.length}<ul class="only">{#each cmp.onlyOurs as o (o.goalId)}<li>{o.note}</li>{/each}</ul>{/if}
      {#each cmp.notes as n, k (k)}<p class="help">{n}</p>{/each}
      <p class="help">{t("CCU Game's cost here leaves out the store ship it starts from (shown apart), since you start from your own ship. A negative difference means the planner is cheaper. Figures are the new money each side expects to spend.")}</p>
    </div>
  {/if}
</section>

<style>
  .import { display: grid; gap: 10px; max-width: 620px; }
  h3 { margin: 0; font-size: 16px; }
  h4 { margin: 0 0 4px; font-size: 13px; color: var(--muted); }
  .n { font-weight: 400; }
  .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .lead { color: var(--muted); }
  .embedded { max-width: none; }
  .help { margin: 0; color: var(--muted); font-size: 12px; }
  .error { margin: 0; color: var(--warn); font-size: 13px; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  li { display: grid; gap: 6px; }
  li.dim { color: var(--muted); }
  .from { color: var(--muted); font-size: 12px; }
  .fix { display: grid; gap: 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .compare { display: grid; gap: 6px; }
  .compare.stale table { opacity: 0.55; }
  table { width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 4px 8px; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .note { color: var(--muted); font-size: 12px; font-weight: 400; }
  .only { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .primary { background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 700; }
</style>

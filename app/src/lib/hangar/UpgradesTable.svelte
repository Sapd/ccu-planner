<script>
  import { usd } from '$logic/format.mjs';
  import { ariaSortOf } from '../view/filters.mjs';
  import ShipThumb from '../ShipThumb.svelte';

  // The Upgrades view: one line per From → To pair of identical copies, sortable. groups: groupCcuPairs() rows (sorted by the caller).
  // Opening a group shows its single copies. Prices are today's list prices from the catalog and what you paid; a missing one is "–".
  let { groups, sort, ship, expanded, showMatch = false, empty = 'No upgrades match.', onsort, ontoggle, onopen, ongoal } = $props();
  const money = (c) => (c == null ? '–' : usd(c));
  // A figure worked out from ship prices because RSI sells no Standard upgrade for the pair is an estimate: "≈$60".
  const approx = (c, est) => (c == null ? '–' : `${est ? '≈' : ''}${usd(c)}`);
  const arrow = (key) => (sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const cols = [
    { key: 'x', label: '×', sr: 'Copies', title: 'How many identical copies you have', cls: 'c' },
    { key: 'reserved', label: 'Reserved', title: 'Copies held by a goal', cls: '' },
    { key: 'from', label: 'From', title: 'The ship the upgrade starts from', cls: '' },
    { key: 'to', label: 'To', title: 'The ship it upgrades to. Click a name to open the pledge.', cls: '' },
    { key: 'fromValue', label: 'From $', title: "Today's list price of the From ship", cls: 'num' },
    { key: 'toValue', label: 'To $', title: "Today's list price of the To ship", cls: 'num' },
    { key: 'value', label: 'Upgrade $', title: "What the same upgrade would cost today as a Standard offer. When RSI sells none, the difference of the two ship prices, marked ≈.", cls: 'num' },
    { key: 'paid', label: 'Paid', title: 'What you paid for it', cls: 'num' },
    { key: 'saving', label: 'Saving', title: "What the same upgrade would cost today as a Standard offer, minus what you paid. Marked ≈ when that price is estimated from the ship prices.", cls: 'num' },
    { key: 'pct', label: 'Saving %', title: 'Saving as a share of the upgrade value (Upgrade $)', cls: 'num' },
  ];
  const savingClass = (s) => (s == null ? '' : s > 0 ? 'gain' : s < 0 ? 'loss' : '');
  const goalsTitle = (g) => g.goals.map((x) => `${x.name}${x.count > 1 ? ` ×${x.count}` : ''}`).join(', ');
</script>

<!-- A scrollable region must take the keyboard focus to be scrolled without a mouse. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="wrap" role="region" aria-label="Upgrade pledges" tabindex="0">
  <table>
    <thead>
      <tr>
        <th scope="col" class="pic"><span class="sr">Ship</span></th>
        {#each cols as c (c.key)}
          <th scope="col" class={c.cls} aria-sort={ariaSortOf(sort, c.key)}><button type="button" class="sortbtn" title="{c.title} Sort by it." onclick={() => onsort(c.key)}>{#if c.sr}<span aria-hidden="true">{c.label}</span><span class="sr">{c.sr}</span>{:else}{c.label}{/if}{arrow(c.key)}</button></th>
        {/each}
        <th scope="col" class="c" title="RSI sold it as a Warbond Edition upgrade">Warbond</th>
        <th scope="col" class="c" title="You can gift it to another account">Gift</th>
        <th scope="col" class="c" title="RSI lets you melt it for store credit">Melt</th>
        {#if showMatch}<th scope="col">Match</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each groups as g (g.copyId)}
        <tr data-copy={g.copyId} data-from={g.from} data-to={g.to} tabindex="-1">
          <td class="pic"><ShipThumb ship={ship(g.to)} size="s" /></td>
          <td class="c">
            {#if g.count > 1}<button type="button" class="x" aria-expanded={expanded.includes(g.copyId)} aria-label="{g.count} copies of {g.fromName} to {g.toName}: {expanded.includes(g.copyId) ? 'hide' : 'show'} each copy" onclick={() => ontoggle(g.copyId)}>×{g.count} <span aria-hidden="true">{expanded.includes(g.copyId) ? '▾' : '▸'}</span></button>{:else}1{/if}
          </td>
          <td class="res">
            {#if g.excludedCount}<span class="tag off" title="You chose not to use {g.count === 1 ? 'this copy' : 'these copies'} in plans. Open a copy to change it.">{g.count === 1 ? 'Not used in plans' : `${g.excludedCount} not used in plans`}</span>{/if}
            {#if g.reservedCount}
              {@const partial = g.count > 1 && !g.reservedBy}
              {#if g.reservedBy}<button type="button" class="link goal" data-view-chain title="Reserved for {g.reservedByName}: view its chain" onclick={() => ongoal(g.reservedBy)}>{g.reservedByName}</button>
              {:else if partial}<span title="Reserved for {goalsTitle(g)}">{g.reservedCount} of {g.count}<span class="sr"> reserved for {goalsTitle(g)}</span></span>
              {:else}<span title="Reserved for {goalsTitle(g)}">{goalsTitle(g)}</span>{/if}
            {/if}
          </td>
          <td class="nm"><span class="ell" title={g.fromName}>{g.fromName}</span></td>
          <td class="nm"><button type="button" class="link ell" title={g.toName} onclick={() => onopen(g.copyId)}>{g.toName}</button>{#if g.extras.length}<span class="tag extra" title="Also included: {g.extras.join(', ')}">+{g.extras.length} {g.extras.length === 1 ? 'item' : 'items'}<span class="sr">: {g.extras.join(', ')}</span></span>{/if}</td>
          <td class="num">{money(g.fromValue)}</td>
          <td class="num">{money(g.toValue)}</td>
          <td class="num" title={g.estimate ? 'RSI sells no Standard upgrade for this pair: estimated from the ship prices' : undefined}>{approx(g.value, g.estimate)}</td>
          <td class="num">{money(g.paid)}</td>
          <td class="num {savingClass(g.saving)}" title={g.estimate && g.saving != null ? 'Estimated: RSI sells no Standard upgrade for this pair' : undefined}>{approx(g.saving, g.estimate)}</td>
          <td class="num {savingClass(g.saving)}">{g.pct == null ? '–' : `${g.estimate ? '≈' : ''}${g.pct}%`}</td>
          <td class="c">{#if g.warbond}<span class="wbmark" role="img" title="RSI sells this as a Warbond edition (new cash only, usually discounted)" aria-label="Warbond edition">✓</span>{/if}</td>
          <td class="c">{#if g.giftable}<span role="img" title="Giftable" aria-label="Giftable">✓</span>{:else}<span class="muted" role="img" aria-label="Not giftable">–</span>{/if}</td>
          <td class="c">{#if g.meltable}<span role="img" title="Meltable" aria-label="Meltable">✓</span>{:else}<span class="tag warn" title="Not meltable">No</span>{/if}</td>
          {#if showMatch}<td class="muted">{g.matchMethod}</td>{/if}
        </tr>
        {#if g.count > 1 && expanded.includes(g.copyId)}
          {#each g.members as m, n (m.copyId)}
            <tr class="sub" data-copy-of={g.copyId} data-member={m.copyId} tabindex="-1">
              <td class="pic"></td>
              <td class="c"></td>
              <td class="res">{#if m.excluded}<span class="tag off" title="You chose not to use this copy in plans. Open it to change it.">Not used in plans</span>{/if}{#if m.reservedBy}<button type="button" class="link goal" data-view-chain title="Reserved for {m.reservedByName}: view its chain" onclick={() => ongoal(m.reservedBy)}>{m.reservedByName}</button>{/if}</td>
              <td class="nm" colspan="2"><button type="button" class="link" onclick={() => onopen(m.copyId)}>Copy {n + 1} of {g.count}</button></td>
              <td class="num" colspan="3"></td>
              <td class="num">{money(m.paid)}</td>
              <td class="num" colspan="2"></td>
              <td colspan="3"></td>
              {#if showMatch}<td class="muted">{m.matchMethod}</td>{/if}
            </tr>
          {/each}
        {/if}
      {:else}
        <tr><td colspan="20" class="muted empty">{empty}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .tag.off { color: var(--muted); border-color: currentColor; margin-right: 6px; }
  .wrap { overflow-x: auto; border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 12px; padding: 4px 6px; color: var(--muted); font-weight: 600; white-space: nowrap; }
  th.num, td.num { text-align: right; }
  th.c, td.c { text-align: center; }
  .sortbtn { background: none; border: none; padding: 0; color: inherit; font: inherit; font-weight: 600; white-space: nowrap; }
  .sortbtn:hover:not(:disabled) { background: none; color: var(--text); text-decoration: underline; }
  td { padding: 4px 6px; height: 40px; box-sizing: border-box; border-top: 1px solid var(--glass-border); vertical-align: middle; white-space: nowrap; }
  td.pic { width: 64px; padding-right: 0; padding-left: 2px; }
  .ell { display: inline-block; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
  td.res { white-space: nowrap; }
  tr.sub td { height: 30px; font-size: 13px; color: var(--muted); border-top-style: dashed; }
  tr:focus { outline: 2px solid var(--focus); outline-offset: -2px; }
  .gain { color: var(--now); }
  .loss { color: var(--warn); }
  .muted { color: var(--muted); }
  .link { background: none; border: none; padding: 0; color: var(--text); text-decoration: underline dotted; text-align: left; }
  .goal { color: var(--link); font-size: 13px; display: inline-block; max-width: 16ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
  .extra { margin-left: 6px; padding: 0 6px; }
  .x { padding: 0 8px; font-size: 12px; font-weight: 700; color: var(--accent); }
  .wbmark { color: var(--accent); font-weight: 700; }
  .tag.warn { color: var(--warn); border-color: var(--warn); }
  .empty { padding: 14px 8px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>

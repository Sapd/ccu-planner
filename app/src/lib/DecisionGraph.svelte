<script>
  import { t } from '$logic/i18n.mjs';
  import { decisionMemo } from '$logic/decision.mjs';
  import { shipName } from '$logic/ships.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipThumb from './ShipThumb.svelte';

  let { app, chain } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => shipName(ships, id);
  const g = $derived(decisionMemo(app, chain.id));
  const wanted = $derived(g.verdict.helps);

  // Which step's options are open; a different chain starts with none.
  let pick = $state({ chain: null, index: null });
  const index = $derived(pick.chain === chain.id ? pick.index : null);
  const step = $derived(index == null ? null : g.steps[index] ?? null);
  const choose = (i) => { pick = { chain: chain.id, index: i }; };

  // Geometry: one column per layer, the spine on the middle lane, alternatives
  // on lanes above and below it where no other card is within a column.
  const COL = 200, W = 150, H = 70, PAD = 16, LANE = 96;
  const layout = $derived.by(() => {
    const lanes = new Map();
    const placed = [];
    const alts = g.nodes.filter((n) => !n.onBest).sort((a, b) => a.layer - b.layer || a.id - b.id);
    for (const n of g.nodes.filter((x) => x.onBest)) { lanes.set(n.id, 0); placed.push({ layer: n.layer, lane: 0 }); }
    for (const n of alts) {
      for (let k = 1; ; k++) {
        const lane = k % 2 ? Math.ceil(k / 2) : -k / 2;
        if (placed.some((p) => p.lane === lane && Math.abs(p.layer - n.layer) < 0.85)) continue;
        lanes.set(n.id, lane); placed.push({ layer: n.layer, lane }); break;
      }
    }
    const span = Math.max(0, ...[...lanes.values()].map(Math.abs));
    const pos = new Map(g.nodes.map((n) => [n.id, { x: PAD + n.layer * COL, y: PAD + (span + lanes.get(n.id)) * LANE }]));
    const maxLayer = Math.max(0, ...g.nodes.map((n) => n.layer));
    return { pos, width: PAD * 2 + maxLayer * COL + W, height: PAD * 2 + 2 * span * LANE + H };
  });
  const ends = (e) => {
    const a = layout.pos.get(e.from), b = layout.pos.get(e.to);
    return { x1: a.x + W, y1: a.y + H / 2, x2: b.x, y2: b.y + H / 2 };
  };
  // Edges between the same two ships are spread apart by their index within the pair.
  const SPREAD = 16;
  const offsets = $derived.by(() => {
    const seen = new Map();
    const out = new Map();
    for (const e of g.edges) { const k = `${e.from}-${e.to}`; seen.set(k, (seen.get(k) ?? 0) + 1); out.set(e, seen.get(k) - 1); }
    return new Map(g.edges.map((e) => [e, (out.get(e) - (seen.get(`${e.from}-${e.to}`) - 1) / 2) * SPREAD]));
  });
  const curve = (e) => {
    const { x1, y1, x2, y2 } = ends(e);
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    const o = offsets.get(e) * 4 / 3; // a cubic's midpoint moves by 3/4 of its control offset
    return `M${x1},${y1} C${x1 + dx},${y1 + o} ${x2 - dx},${y2 + o} ${x2},${y2}`;
  };
  const mid = (e) => { const { x1, y1, x2, y2 } = ends(e); return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + offsets.get(e) - 5 }; };
  const stepIndexOf = (e) => g.steps.findIndex((s) => s.from === e.from && s.to === e.to && s.chosen.kind === e.kind);
  const ordered = $derived([...g.edges].sort((a, b) => Number(a.best) - Number(b.best)));
</script>

<section class="verdict" aria-label={t('Verdict')}>
  <p class="text">{g.verdict.text}</p>
  {#if g.verdict.versus}<p>{t('Why this route: {text}.', { text: g.verdict.versus })}</p>{/if}
  {#each wanted as w}<p class="help">{w}</p>{/each}
</section>

{#if g.nodes.length}
  <p class="hint">{t('Left to right: the best route as the spine, alternatives branch off it and rejoin, labelled by how much more they cost. Click a step for its options.')}</p>
  <div class="scroll">
    <div class="canvas" style:width="{layout.width}px" style:height="{layout.height}px">
      <svg width={layout.width} height={layout.height} aria-hidden="true">
        {#each ordered as e (`${e.kind}:${e.from}-${e.to}:${e.copyId ?? ''}`)}
          <path class="edge {e.kind}" class:alt={!e.best} d={curve(e)} />
          {#if e.best}
            {@const si = stepIndexOf(e)}
            <path class="hit" d={curve(e)} onclick={() => choose(si)} role="presentation" />
            <text class="label" x={mid(e).x} y={mid(e).y} text-anchor="middle">{e.kind === 'owned' ? t('owned') : usd(e.cash)}</text>
          {:else}
            <text class="label dim" x={mid(e).x} y={mid(e).y} text-anchor="middle">+{usd(e.delta)}</text>
          {/if}
        {/each}
      </svg>
      {#each g.nodes as n (n.id)}
        <div class="card" class:alt={!n.onBest} style:left="{layout.pos.get(n.id).x}px" style:top="{layout.pos.get(n.id).y}px" style:width="{W}px" style:height="{H}px" data-ship={n.id}>
          <ShipThumb ship={ships.get(n.id) ?? null} size="s" />
          <span class="info"><b>{n.name}</b><span>{usd(n.msrp)}{n.concept ? ` · ${t('concept')}` : ''}</span></span>
        </div>
      {/each}
    </div>
  </div>

  <div class="steps" role="group" aria-label={t('Route steps')}>
    {#each g.steps as s, i (i)}
      <button class="stepbtn {s.chosen.kind}" class:active={index === i} aria-pressed={index === i} onclick={() => choose(i)}>{name(s.from)} → {name(s.to)}</button>
    {/each}
  </div>

  {#if step}
    <div class="detail" data-from={step.from} data-to={step.to}>
      <p class="decision">{step.decision}</p>
      {#if step.tie}<p class="tie" data-tie>{step.tie}</p>{/if}
      <table>
        <thead><tr><th>{t('Option')}</th><th>{t('Price')}</th><th>{t('Why')}</th></tr></thead>
        <tbody>
          {#each step.options as o}
            <tr class:chosen={o.chosen} class:off={!o.available}>
              <td class={o.kind}>{o.kind === 'owned' ? (o.paid != null ? t('Owned CCU (paid {amount})', { amount: usd(o.paid) }) : t('Owned CCU')) : o.kind === 'warbond' ? t('Warbond') : o.kind === 'standard' ? t('Standard') : t('Expected price')}</td>
              <td>{o.kind === 'owned' ? t('free') : usd(o.cash)}</td>
              <td>{o.why}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  .verdict { margin: 8px 0; padding: 8px 12px; border: 1px solid var(--glass-border); border-radius: 10px; background: var(--glass); }
  .verdict p { margin: 4px 0; }
  .text { font-weight: 600; }
  .help { color: var(--muted); }
  .hint { color: var(--muted); }
  .scroll { overflow: auto; border: 1px solid var(--glass-border); border-radius: 10px; max-height: 560px; }
  .canvas { position: relative; }
  svg { position: absolute; inset: 0; }
  .edge { fill: none; stroke-width: 3; stroke: var(--muted); }
  .edge.owned { stroke: var(--own); } .edge.standard { stroke: var(--wait); } .edge.warbond { stroke: var(--now); }
  .edge.alt { stroke-width: 1.5; opacity: .45; stroke-dasharray: 5 4; }
  .hit { fill: none; stroke: transparent; stroke-width: 16; cursor: pointer; pointer-events: stroke; }
  .label { fill: var(--text); font-size: 11px; paint-order: stroke; stroke: var(--bg); stroke-width: 3px; }
  .label.dim { fill: var(--muted); }
  .card { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 4px 6px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; }
  .card.alt { opacity: .6; }
  .info { display: flex; flex-direction: column; min-width: 0; font-size: 12px; line-height: 1.2; }
  .info b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .info span { color: var(--muted); }
  .card :global(.thumb) { align-self: flex-start; }
  .steps { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  .stepbtn { padding: 4px 10px; background: var(--glass); color: var(--text); border: 1px solid var(--glass-border); border-left: 3px solid var(--glass-border); border-radius: 4px; cursor: pointer; font: inherit; }
  .stepbtn.owned { border-left-color: var(--own); } .stepbtn.standard { border-left-color: var(--wait); } .stepbtn.warbond { border-left-color: var(--now); }
  .stepbtn.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .detail { border: 1px solid var(--glass-border); border-radius: 10px; padding: 8px 12px; }
  .decision { margin: 0 0 8px; font-weight: 600; }
  .tie { margin: -4px 0 8px; color: var(--muted); font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 10px 4px 0; border-bottom: 1px solid var(--glass-border); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  tr.chosen td { font-weight: 600; }
  tr.off td { color: var(--muted); }
  td.owned { color: var(--own); } td.standard { color: var(--wait); } td.warbond { color: var(--now); }
</style>

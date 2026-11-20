<script>
  import ShipThumb from '../ShipThumb.svelte';

  // The Ships view: a grid of big ship pictures, the name on the picture, one line under it about where the ship came from. At most two badges: the insurance and one tag on the picture (Starting ship or Goal ...). Giftable is a filter and the card's hover text.
  // items: fleetItems() cards (owned ships and goal ships); ship(id) -> the planner ship (for its picture).
  let { items, ship, onopen, ongoal } = $props();
  const labelOf = (c) => (c.kind === 'goal'
    ? `${c.name}, ${c.tag}: open the goal`
    : `${c.name}${c.count > 1 ? `, ${c.count} copies` : ''}${c.insurance ? `, ${c.insurance}` : ''}${c.startingText ? `, ${c.startingText.toLowerCase()}` : ''}${c.giftable ? `, ${c.giftableText.toLowerCase()}` : ''}: show ${c.pledges > 1 ? 'the first pledge' : 'the pledge'}`);
</script>

<ul class="grid" aria-label="Ships">
  {#each items as c (c.key)}
    <li>
      <button type="button" class="card" class:goal={c.kind === 'goal'} data-owned-ship={c.kind === 'owned' ? (c.shipId ?? undefined) : undefined} data-goal-ship={c.kind === 'goal' ? c.goalId : undefined}
        aria-label={labelOf(c)} title={c.kind === 'owned' && c.giftable ? c.giftableText : undefined} onclick={() => (c.kind === 'goal' ? ongoal(c.goalId) : onopen(c.pledgeId))}>
        <span class="pic">
          <ShipThumb ship={ship(c.shipId) ?? { name: c.name, manufacturer: c.manufacturer, image: null }} size="card" />
          {#if c.kind === 'goal'}<span class="corner goaltag" class:ready={c.ready}>{c.tag}</span>
          {:else if c.starting}<span class="corner starttag">{c.startingText}</span>{/if}
          {#if c.count > 1}<span class="count">×{c.count}</span>{/if}
          <span class="title">{c.name}</span>
        </span>
        <span class="sub">
          <span class="line" title={c.line ?? undefined}>{c.line ?? c.manufacturer ?? ''}</span>
          {#if c.insurance}<span class="tag ins" class:lti={c.insuranceKind === 'lti'}>{c.insurance}</span>{/if}
        </span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
  .card { display: flex; flex-direction: column; gap: 4px; width: 100%; height: 100%; text-align: left; padding: 6px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 10px; backdrop-filter: var(--glass-blur); }
  .card:hover { border-color: var(--accent); }
  .card.goal { border-style: dashed; }
  .pic { position: relative; display: block; border-radius: 6px; overflow: hidden; }
  /* The name sits on the picture, on a dark fade so it reads on any image. */
  .title { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 5px; font-weight: 700; font-size: 15px; line-height: 1.2; color: #fff; background: linear-gradient(transparent, rgba(6, 9, 15, 0.88)); text-shadow: 0 1px 2px #000; }
  .corner { position: absolute; top: 6px; left: 6px; max-width: calc(100% - 52px); padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(6, 9, 15, 0.85); border: 1px solid currentColor; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .goaltag { color: var(--accent); }
  .goaltag.ready { color: #cfd8e6; }
  .starttag { color: var(--accent); }
  .count { position: absolute; top: 6px; right: 6px; padding: 1px 8px; border-radius: 999px; background: rgba(10, 14, 22, 0.85); font-weight: 700; font-size: 13px; }
  .sub { display: flex; gap: 6px; align-items: flex-start; min-height: 32px; font-size: 12px; padding: 0 2px; }
  .line { flex: 1; min-width: 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; }
  .tag.lti { color: var(--accent); border-color: var(--accent); }
  .tag { padding: 0 8px; }
</style>

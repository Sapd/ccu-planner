<script>
  import { untrack } from 'svelte';
  import { searchShips } from './view/shipSearch.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import { usd } from '$logic/format.mjs';

  // ships: Map id -> ship. value: selected ship id or null. Arrow keys move, Enter picks, Escape closes.
  // onpick(ship): called when the user picks a ship from the list.
  let { ships, value = $bindable(null), label, id, onpick, suggest = [] } = $props();
  let text = $state(untrack(() => (value != null ? ships.get(value)?.name : '') ?? ''));
  let open = $state(false);
  let active = $state(0);
  // With an empty field the list shows the suggestions, so the first click is not an empty box.
  const results = $derived(text.trim() === '' ? suggest : searchShips(ships, text));
  const selected = $derived(value != null ? ships.get(value) : null);
  const listId = $derived(`${id}-list`);
  // A ship chosen elsewhere (a click on the map) shows its name here too.
  let shown = null; // the ship id this effect last wrote into the field
  $effect(() => {
    const v = value;
    untrack(() => {
      const n = v != null ? ships.get(v)?.name : null;
      if (n && n !== text) text = n;
      // Cleared from outside (a "Clear" button): the field stops showing the ship that is no longer selected.
      else if (v == null && shown != null && text === ships.get(shown)?.name) text = '';
      shown = v;
    });
  });


  function pick(s) {
    value = s.id;
    text = s.name;
    open = false;
    onpick?.(s);
  }
  function onkeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (open) active = Math.min(active + 1, results.length - 1); else open = true; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) active = Math.max(active - 1, 0); else open = true; }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); open = false; }
  }
  function oninput(e) {
    text = e.currentTarget.value;
    open = true;
    active = 0;
    if (selected && text !== selected.name) value = null;
  }
</script>

<div class="picker">
  <label for={id}>{label}</label>
  <input {id} role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-activedescendant={open && results[active] ? `${id}-opt-${results[active].id}` : undefined} aria-autocomplete="list"
    autocomplete="off" placeholder="Type a ship name" value={text} {oninput} {onkeydown}
    onfocus={() => { open = true; }} onblur={() => { open = false; }} />
  {#if open && results.length}
    <ul id={listId} role="listbox" aria-label={text.trim() === '' ? 'Suggestions' : undefined}>
      {#each results as s, i (s.id)}
        <li id="{id}-opt-{s.id}" role="option" aria-selected={i === active} class:active={i === active}
          onmousedown={(e) => { e.preventDefault(); pick(s); }}>
          <span class="opt"><ShipThumb ship={s} size="xs" /><span>{s.name}</span></span><span class="msrp">{usd(s.msrp)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; display: grid; gap: 4px; }
  label { color: var(--muted); font-size: 12px; }
  input { padding: 6px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--glass-border); border-radius: 4px; font: inherit; }
  ul { position: absolute; top: 100%; left: 0; right: 0; z-index: var(--z-popover); margin: 2px 0 0; padding: 0; list-style: none; background: #121a2b; box-shadow: 0 8px 24px rgba(0,0,0,.45); border: 1px solid var(--glass-border); border-radius: 4px; max-height: 260px; overflow-y: auto; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 8px; cursor: pointer; }
  li.active { background: rgba(255, 255, 255, 0.14); }
  .opt { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .msrp { color: var(--muted); }
</style>

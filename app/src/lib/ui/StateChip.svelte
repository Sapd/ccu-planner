<script>
  import { STATE_LABEL, LOCK_LABEL, FILLER_LABEL, chipHelp } from '$logic/describe.mjs';

  // state: 'own' | 'now' | 'wait' | 'norush' | 'optional' | 'reserved'; lock: a step that locks its price now (shown for 'now').
  // count: shows "2 Wait" instead of "Wait" (counts as chips). One short label per state, never a sentence. text: a label of its own ("1 of 5 reserved").
  let { state, lock = false, count = null, text = null } = $props();
  const label = $derived(text ?? (lock && state === 'now' ? LOCK_LABEL : (STATE_LABEL[state] ?? '')));
  // What the chip means, as its tooltip (a filler is a waiting step shown with its own label).
  const help = $derived(chipHelp(state, { lock, filler: text === FILLER_LABEL }));
</script>

<span class="chip {state}" title={help ?? undefined}><span class="dot" aria-hidden="true"></span>{#if count != null}<b class="n">{count}</b>{" "}{/if}{label}</span>

<style>
  .chip[title] { cursor: help; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(8, 12, 20, 0.55); border: 1px solid currentColor; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .n { font-variant-numeric: tabular-nums; }
  .own { color: #a9b6c9; } .now { color: var(--now); } .wait { color: var(--wait); }
  /* On sale reuses the calm neutral accent; optional is muted; reserved is amber. */
  .norush { color: var(--accent); } .optional { color: var(--muted); }
  .reserved { color: var(--held); }
  .own .dot { background: var(--own); }
</style>

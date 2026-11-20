// The chain as a subway line: ship pictures as stops, the upgrades between them as coloured segments.
// Pure: a journey's steps in, nodes and segments out. Runs of owned upgrades collapse into one segment ("16 owned").
import { usd } from '../../../../src/logic/format.mjs';

/** The look of a step: 'own' | 'now' | 'norush' | 'optional' | 'wait'. */
export const stripState = (item) => (item.state === 'now' && (item.urgency === 'norush' || item.urgency === 'optional') ? item.urgency : item.state);

const WORD = { own: 'Owned', now: 'Buy now', norush: 'On sale', optional: 'Optional', wait: 'Wait' };

/**
 * @param {{ state: string, urgency?: string|null, step: { from: number, to: number, cash: number } }[]} steps a journey's steps
 * @returns {{ nodes: number[], segments: { kind: string, label: string, sub: string|null, count: number }[] }}
 *   nodes[i] -> segments[i] -> nodes[i + 1]; label is "$40" or "16 owned", sub the state word for a purchase.
 */
export function chainStrip(steps) {
  if (!steps.length) return { nodes: [], segments: [] };
  const nodes = [steps[0].step.from];
  const segments = [];
  let i = 0;
  while (i < steps.length) {
    if (steps[i].state === 'own') {
      let end = i;
      while (end + 1 < steps.length && steps[end + 1].state === 'own') end++;
      const count = end - i + 1;
      segments.push({ kind: 'own', label: count === 1 ? 'Owned' : `${count} owned`, sub: null, count });
      nodes.push(steps[end].step.to);
      i = end + 1;
    } else {
      const kind = stripState(steps[i]);
      segments.push({ kind, label: usd(steps[i].step.cash), sub: WORD[kind], count: 1 });
      nodes.push(steps[i].step.to);
      i++;
    }
  }
  return { nodes, segments };
}

/** The strip as one sentence for a screen reader: "Pulse, $40 Wait, Syulen, 16 owned, 600i Explorer". */
export function stripText(strip, name) {
  return strip.nodes.map((n, i) => (i < strip.segments.length ? `${name(n)}, ${[strip.segments[i].label, strip.segments[i].sub].filter(Boolean).join(' ')}` : name(n))).join(', ');
}

// Compare routes: input handling. Pure.
import { parseSlackUsd } from '../../../../src/logic/wantedView.mjs';

/** Credit typed in dollars -> cents. Empty means 0; anything else that is not a non-negative number is null. */
export function parseCreditUsd(text) {
  return String(text ?? '').trim() === '' ? 0 : parseSlackUsd(text);
}

/** Integer in [min, max], or null. */
export function parseBounded(text, min, max) {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

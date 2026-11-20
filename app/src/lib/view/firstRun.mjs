// First-run explainer: copy and the "seen" flag. Storage may be missing or throw.
export const EXPLAINER_STEPS = [
  'A CCU upgrades one ship to a more expensive one; you pay the difference.',
  'Chaining small upgrades is often cheaper than one big one.',
  'The cheapest upgrades (Warbonds) mostly appear during sales, so the best price usually means waiting.',
];
/** A short title for each step, so the three steps do not all read "How CCUs work". Same order as EXPLAINER_STEPS. */
export const EXPLAINER_TITLES = ['What a CCU is', 'Why chain upgrades', 'Why wait for sales'];
/** The "what is this?" text on the welcome screen: what a CCU is (one made-up example) and what the planner does. */
export const WELCOME_TEXT = 'A CCU upgrades a ship you own to a more expensive one — you pay only the difference (e.g. Aurora $50 → Cutlass $110 costs $60). The planner finds the cheapest chain to the ship you want.';
const KEY = 'ccu.explainer.seen';

export const shouldShowExplainer = (storage) => {
  try { return storage?.getItem(KEY) !== '1'; } catch { return true; }
};
export const markExplainerSeen = (storage) => {
  try { storage?.setItem(KEY, '1'); } catch { /* storage unavailable: it shows again next time */ }
};

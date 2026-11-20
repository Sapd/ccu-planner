// The first-run steps on Today: sign in, sync, pick a goal. Done / next state comes from the real data. Pure.

export const ONBOARDING_TITLE = 'Get started in three steps';

/**
 * @param {{ session: string, app: object | null }} input session: 'none' | 'signed in' | 'expired' (SyncMenu's status);
 *   app: the derived app state, or null while there is no store data.
 * @returns {{ key: 'signin'|'sync'|'goal', title: string, note: string, text: string, done: boolean, next: boolean }[]}
 */
export function onboardingSteps({ session, app }) {
  const meta = app?.data?.meta ?? {};
  const hasStore = !!meta.catalogAt && storeComplete(app);
  const hasHangar = !!meta.hangarAt;
  const goals = Object.keys(app?.plans?.chains ?? {}).length;
  // Only a live RSI session counts: data imported from a folder says nothing about being signed in.
  const signedIn = session === 'signed in';
  // note: a short label after the title ("Sign in to RSI · already signed in"); text: one muted line under it.
  const steps = [
    { key: 'signin', title: 'Sign in to RSI', note: signedIn ? 'already signed in' : '', text: signedIn ? '' : session === 'expired' ? 'Your RSI sign-in has run out. Sign in again; the planner never sees your password.' : 'Opens the RSI website; the planner never sees your password.', done: signedIn },
    { key: 'sync', title: 'Sync store and hangar', note: hasStore && hasHangar ? 'done' : 'takes a minute or two', text: '', done: hasStore && hasHangar },
    { key: 'goal', title: 'Pick your first goal', note: goals > 0 ? 'done' : '', text: '', done: goals > 0 },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, next: i === nextIndex }));
}

/**
 * Whether the last store sync finished: every offer has its details (Standard/Warbond title and the ship's item IDs). A cancelled
 * or failed store sync leaves offers without them, and hangar upgrades RSI names its own way cannot be mapped without the details.
 */
export const storeComplete = (app) => (app?.data?.meta?.inferredKinds ?? 0) === 0;

/** True when the store data is from the same local day as `now` and that store sync finished. */
export const storeIsFresh = (app, now = new Date()) => {
  const at = app?.data?.meta?.catalogAt;
  return !!at && new Date(at).toDateString() === now.toDateString() && storeComplete(app);
};

/** What the first-run "Sync store and hangar" runs: the hangar alone when the store data is fresh. */
export const syncKinds = (app, now = new Date()) => (storeIsFresh(app, now) ? ['hangar'] : ['upgrades', 'hangar']);

const PHASE_TEXT = {
  hangar: 'Loading your hangar', buyback: 'Loading your buy-back pledges', upgrades: 'Loading the store’s upgrades',
  details: 'Loading upgrade prices', images: 'Loading ship pictures', 'store catalog': 'Loading the store', 'store catalog pictures': 'Loading store pictures',
};
const PAGED = new Set(['hangar', 'buyback']);
/**
 * What the first-run steps show while a sync runs: a line of text and a bar (max null = no known end).
 * @param {{ phase?: string, done?: number, total?: number | null } | null} p ui.syncProgress
 */
export function syncProgressView(p) {
  if (!p) return null;
  const label = PHASE_TEXT[p.phase] ?? `Syncing ${p.phase ?? ''}`.trim();
  const done = p.done ?? 0;
  const max = p.total > 0 ? p.total : null;
  const count = !done ? '' : PAGED.has(p.phase) ? (max ? `page ${done} of ${max}` : `page ${done}`) : max ? `${done} of ${max}` : `${done}`;
  return { text: count ? `${label}… ${count}` : `${label}…`, value: max ? Math.min(done, max) : null, max };
}

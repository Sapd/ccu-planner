// The first-run steps on Today: sign in, sync, pick a goal. Done / next state comes from the real data. Pure.
import { t, tn, N_ } from '../../../../src/logic/i18n.mjs';

export const ONBOARDING_TITLE = N_('Get started in three steps');

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
    { key: 'signin', title: t('Sign in to RSI'), note: signedIn ? t('already signed in') : '', text: signedIn ? '' : session === 'expired' ? t('Your RSI sign-in has run out. Sign in again; the planner never sees your password.') : t('Opens the RSI website; the planner never sees your password.'), done: signedIn },
    { key: 'sync', title: t('Sync store and hangar'), note: hasStore && hasHangar ? t('done') : t('takes a minute or two'), text: '', done: hasStore && hasHangar },
    { key: 'goal', title: t('Pick your first goal'), note: goals > 0 ? t('done') : '', text: '', done: goals > 0 },
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
  hangar: N_('Loading your hangar'), buyback: N_('Loading your buy-back pledges'), upgrades: N_('Loading the store’s upgrades'),
  details: N_('Loading upgrade prices'), images: N_('Loading ship pictures'), 'store catalog': N_('Loading the store'), 'store catalog pictures': N_('Loading store pictures'),
};
const PAGED = new Set(['hangar', 'buyback']);
/**
 * What the first-run steps show while a sync runs: a line of text and a bar (max null = no known end).
 * @param {{ phase?: string, done?: number, total?: number | null } | null} p ui.syncProgress
 */
export function syncProgressView(p) {
  if (!p) return null;
  const label = PHASE_TEXT[p.phase] ? t(PHASE_TEXT[p.phase]) : p.phase ? t('Syncing {phase}', { phase: p.phase }) : t('Syncing');
  const done = p.done ?? 0;
  const max = p.total > 0 ? p.total : null;
  const count = !done ? '' : PAGED.has(p.phase) ? (max ? t('page {done} of {max}', { done, max }) : t('page {done}', { done })) : max ? t('{done} of {max}', { done, max }) : `${done}`;
  return { text: count ? `${label}… ${count}` : `${label}…`, value: max ? Math.min(done, max) : null, max };
}

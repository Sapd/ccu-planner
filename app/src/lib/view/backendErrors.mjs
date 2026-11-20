// Translates the messages the desktop backend (Rust), the dev server and the sync core send to the screen. Their
// wording is fixed English text; an exact match or a known pattern (with its dynamic part kept) is shown in the
// current language, anything else stays as it came. Pure; English in, English out.
import { t, N_ } from '../../../../src/logic/i18n.mjs';

// Whole messages. Marked with N_ so the completeness test sees them; shown with t().
const FIXED = new Set([
  N_('Sign-in expired'),
  N_('Sign-in cancelled'),
  N_('Sign-in timed out'),
  N_('RSI sign-in is already open'),
  N_('Sync cancelled; progress saved'),
  N_('A sync is already running'),
  N_('Unknown sync'),
  N_('Sync Store first'),
  N_('RSI network request failed'),
  N_('Could not read RSI response'),
  N_('RSI store listing too large'),
  N_('Invalid RSI JSON'),
  N_('RSI refused the request (403)'),
  N_('RSI refused the store catalog request (401)'),
  N_('Public RSI request failed'),
  N_('Public RSI response too large'),
  N_('Public RSI retry limit reached'),
  N_('Too many image redirects'),
  N_('Unsupported image type'),
  N_('Signed in, but the session couldn\'t be saved; you\'ll need to sign in again next time'),
  N_('Data folder busy: another planner process is saving. Try again in a moment.'),
  N_('Planner commands require the main window'),
  N_('Planner commands require the local app'),
  N_('legacy catalog.json is missing'),
  N_('source is the app data dir'),
  N_('Refusing to open a non-RSI URL'),
  N_('RSI session missing or expired: RSI showed its sign-in or access-denied page instead of your account. Sign in again, then sync.'),
  N_('RSI returned no store items'),
  N_('listing has no resources'),
  N_('The saved catalog is from a signed-in sync and a public one would drop its Subscriber and Concierge items. Sign in to RSI and refresh again'),
  N_('signed in, but RSI returned no Subscriber or Concierge items; the catalog is saved as a public one'),
  N_('store pictures stopped after repeated failures; sync again later'),
  N_('RSI listed no pledges in your hangar. If you have pledges, sign in to RSI again and sync the hangar'),
]);

// Messages with a dynamic part: [pattern, builder of the translated text from the match].
const PATTERNS = [
  [/^Another sync is running \(started (.*), pid (\d+)\)\.$/, (m) => t('Another sync is running (started {when}, pid {pid}).', { when: m[1], pid: m[2] })],
  [/^Another sync is running \(started (.*)\)\.$/, (m) => t('Another sync is running (started {when}).', { when: m[1] })],
  [/^A sync has been running for over 2 h \(started (.*), pid (\d+)\); if it is stuck, delete (.*)\.$/, (m) => t('A sync has been running for over 2 h (started {when}, pid {pid}); if it is stuck, delete {file}.', { when: m[1], pid: m[2], file: m[3] })],
  [/^RSI HTTP (\d+)$/, (m) => t('RSI HTTP {status}', { status: m[1] })],
  [/^Public RSI HTTP (\d+)$/, (m) => t('Public RSI HTTP {status}', { status: m[1] })],
  [/^request failed \((\d+)\)$/, (m) => t('request failed ({status})', { status: m[1] })],
  [/^invalid JSON: (.*)$/s, (m) => t('invalid JSON: {error}', { error: m[1] })],
  [/^RSI returned (\d+) of (\d+) pledges\. Overwrite anyway\?$/, (m) => t('RSI returned {seen} of {active} pledges. Overwrite anyway?', { seen: m[1], active: m[2] })],
  [/^RSI returned an unusually small hangar; nothing was changed \((\d+) of (\d+) pledges; use --force to overwrite\)$/, (m) => t('RSI returned an unusually small hangar; nothing was changed ({seen} of {active} pledges; use --force to overwrite)', { seen: m[1], active: m[2] })],
  [/^RSI sent page (\d+) of your hangar without the pledge list \(maintenance or a temporary error\)\. Nothing was changed; sync again later\.$/, (m) => t('RSI sent page {page} of your hangar without the pledge list (maintenance or a temporary error). Nothing was changed; sync again later.', { page: m[1] })],
  [/^RSI answered (.+) of (\d+) queries$/, (m) => t('RSI answered {got} of {total} queries', { got: m[1], total: m[2] })],
  [/^Resuming store sync from ship (\d+) of (\d+) \(started (.*)\)$/, (m) => t('Resuming store sync from ship {n} of {total} (started {time})', { n: m[1], total: m[2], time: m[3] })],
  [/^RSI returned (\d+) store items, the saved catalog has (\d+)$/, (m) => t('RSI returned {n} store items, the saved catalog has {saved}', { n: m[1], saved: m[2] })],
  [/^RSI delivered fewer store entries than it announced: (.*)$/s, (m) => t('RSI delivered fewer store entries than it announced: {list}', { list: m[1] })],
  [/^session currency is (.*); upgradeUsdCents left empty$/, (m) => t('session currency is {currency}; upgradeUsdCents left empty', { currency: m[1] })],
  [/^RSI's (\w+) page (\d+) of (\d+) came back incomplete; nothing was marked as gone\. Sync again later$/, (m) => t('RSI\'s {what} page {page} of {pages} came back incomplete; nothing was marked as gone. Sync again later', { what: m[1], page: m[2], pages: m[3] })],
];

/** The message in the current language when it is a known fixed one or matches a known pattern; else unchanged. */
export function backendText(message) {
  if (typeof message !== 'string') return message;
  if (FIXED.has(message)) return t(message);
  for (const [re, build] of PATTERNS) {
    const m = re.exec(message);
    if (m) return build(m);
  }
  return message;
}

/** The text of a caught error (or a rejected value), translated as above. */
export const backendError = (e) => backendText(e?.message ?? String(e));

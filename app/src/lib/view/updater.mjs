// Plain-language texts for the update check (no Tauri imports, so tests can run it).
export const CHECK_FIRST_DELAY_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function plainUpdateError(error) {
  const text = String(error?.message ?? error ?? '');
  if (/signature|verif|pubkey/i.test(text)) return 'An update was found, but it could not be verified, so it was not installed.';
  return 'Could not reach the update server. Check your internet connection and try again.';
}

// What the Help menu line says for the manual check.
export function checkLine(status, current, version, error) {
  if (status === 'checking') return 'Checking…';
  if (status === 'downloading') return `Downloading ${version}…`;
  if (status === 'ready') return `${version} is ready. Use the Restart button in the top bar.`;
  if (status === 'uptodate') return `You're up to date (${current}).`;
  if (status === 'error') return error;
  return current ? `You have ${current}.` : 'Looks for a newer version.';
}

// Release notes arrive as plain text; show at most this much.
export const NOTES_LIMIT = 2000;
export const notesText = (notes) => String(notes ?? '').trim().slice(0, NOTES_LIMIT);

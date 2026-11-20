// Refreshes the signed data feed (sale events, the public store catalog) into <data dir>/feed/, the same way the app does.
//
//   node scripts/feed.mjs [--force] [--images] [--dev]
//
// One GET each of https://sapd.github.io/ccu-planner/feed/manifest.json and manifest.json.sig, then the files the manifest lists; every file is
// checked against the ed25519-signed manifest before it is saved, and a refused or unreachable feed leaves the last good copy. At most every
// 6 hours unless --force. --images also downloads the catalog pictures (the app does that only while it shows the feed's catalog).
// With --dev, CCU_FEED_URL points it at another address (testing: a folder served over http on localhost); without --dev that variable is
// ignored. Exit: 0 fine or offline, 1 refused, 2 bad usage.
import { DATA_DIR, checkLegacyData } from '../src/data.mjs';
import { refreshFeed, fetchFeedImages, readFeed, feedBase } from '../src/feed.mjs';

const args = process.argv.slice(2);
const known = new Set(['--force', '--images', '--dev']);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length) { console.error(`unknown option ${unknown.join(' ')}\nusage: node scripts/feed.mjs [--force] [--images] [--dev]`); process.exit(2); }
checkLegacyData();
let base;
try { base = feedBase(process.env, { dev: args.includes('--dev') }); } catch (e) { console.error(e.message); process.exit(2); }
const r = await refreshFeed({ dir: DATA_DIR, force: args.includes('--force'), base });
console.log(`feed: ${r.status}${r.generatedAt ? `, generated ${r.generatedAt}` : ''}${r.stale ? ' (STALE: older than 30 days, the publisher seems to have stopped)' : ''}${r.error ? ` (${r.error})` : ''}`);
if (args.includes('--images') && r.status !== 'rejected') {
  for (;;) {
    const i = await fetchFeedImages({ dir: DATA_DIR, base });
    console.log(`feed pictures: ${i.downloaded} downloaded, ${i.remaining} left, ${i.failed} failed`);
    if (!i.downloaded || !i.remaining) break;
  }
}
const feed = readFeed(DATA_DIR);
if (feed) console.log(`saved copy: ${feed.eventsDoc?.events?.length ?? 0} sale events, ${feed.catalog?.items?.length ?? 0} catalog items, ${feed.images.length} pictures`);
process.exit(r.status === 'rejected' ? 1 : 0);

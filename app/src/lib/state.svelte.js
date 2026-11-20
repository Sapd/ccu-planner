import { tick } from 'svelte';
import { backend as realBackend } from './backend.js';
import { createSampleBackend } from './view/sample.mjs';
import { createBackendSwitch, switchBackend } from './view/backendSwitch.mjs';
import sampleData from './sample-data.json';
import { createController } from './view/controller.mjs';
import { clearJobCache } from './jobs.svelte.js';
import aliases from '../../../src/logic/aliases.json';
import { readCatalog } from '../../../src/logic/store-catalog.mjs';
import { readEvents, feedCatalog, chooseCatalog, feedShipFiles, FEED_REFRESH_MS } from '../../../src/logic/feed.mjs';
import { freshBrowse } from './view/storeBrowser.mjs';

const freshStore = () => ({ query: '', scope: 'all', hours: 24, onlyMine: false, open: {}, checkOpen: false, checks: {} });
const freshHangar = () => ({ chip: 'ships', query: '', sel: {}, sort: null, expanded: [], showMatch: false, picked: false });

// Reactive mirror of the controller. The derived state is replaced as a whole
// on every change, so it is kept raw (no deep proxy over the ship maps).
class Ui {
  app = $state.raw(null);
  notice = $state(null);
  bought = $state(false);
  syncBusy = $state(false);
  loaded = $state(false);
  selected = $state(null);
  section = $state('today');
  advanced = $state(null);
  // Set by Today to open Goals with the Add goal form open; GoalsPage reads and clears it.
  addingGoal = $state(false);
  // RSI sign-in status of SyncMenu ('none' | 'signed in' | 'expired'), shared so Today's first steps can show it.
  session = $state('none');
  signingIn = $state(false);
  // A running sync, shared by every SyncMenu (the header is replaced when the first sync loads data).
  syncProgress = $state(null);
  syncResume = $state(null);
  confirmation = $state(null);
  // A CCU Game file chosen before the first sync, kept until the import runs (view/pendingImport.mjs), and what the last automatic import did.
  pending = $state.raw(null);
  importResult = $state.raw(null);
  // The Glossary panel: null = closed, '' = open at the top, otherwise the entry to show.
  glossary = $state(null);
  glossaryOpener = $state.raw(null);
  // Sample data is on: the planner runs on a throwaway in-memory copy and never touches the data folder.
  sample = $state(false);
  // Set while the sample is being opened: the shell then skips the first-run tour (it is under Help).
  skipTour = $state.raw(false);
  // The data set is being swapped (sample on or off): no sync or sign-in may start until it is done.
  switching = $state(false);
  // A way back to where a link came from ("Back to Today", "Back to Galaxy offers"): { label, section, advanced, selected, scroll }.
  back = $state.raw(null);
  // Set by a link that lands on one step of a goal's chain: { goalId, from, to }. GoalDetail opens and focuses it, then clears it.
  focusStep = $state.raw(null);
  // The Goals page header buttons and the page share these: open the import, preview "Reserve all chains".
  importingGoals = $state(false);
  reserveAllOpen = $state(false);
  // A link into the Store's Sale events section (Prices): Shell opens it and focuses its heading.
  focusSaleEvents = $state(false);
  // A link to one owned copy in the Hangar: HangarTab opens its group and scrolls to it.
  focusCopy = $state(null);
  // Each tab keeps its search, filters and open items while the app runs (the pages are rebuilt on every visit).
  store = $state(freshStore());
  // The Store page's open tab ('upgrades' | 'browse') and what the Browse store tab keeps: store, search, sort, filters.
  storeTab = $state('upgrades');
  browse = $state(freshBrowse());
  // The store catalog the Browse store tab shows: { loaded, doc: { fetchedAt, signedIn, items } | null, source: 'own' | 'feed' | null, error }.
  // 'own' is store-catalog.json (the app's own sync); 'feed' is the signed feed's public snapshot (see chooseCatalog).
  catalog = $state.raw({ loaded: false, doc: null, source: null, error: null });
  // The app's own catalog file alone (read by loadCatalog); the sync menu's "Last synced" is about this one.
  ownCatalog = $state.raw(null);
  ownLoaded = $state(false);
  // The signed data feed's saved copy: { events: [{ id, name, from, to, note }], generatedAt, catalog: doc | null, status, ships }.
  // ships: { "<ship id>": "feed/ships/<id>.webp" } for the feed's ship pictures on disk (ShipThumb's fallback).
  feed = $state.raw({ events: [], generatedAt: null, catalog: null, status: null, ships: {} });
  // chip: the open view ('ships' | 'ccu' | 'others'); sel: the ticked filters per view; sort: the Upgrades table's sort; picked: the user chose a view (else the first non-empty one opens).
  hangar = $state(freshHangar());
  // The open tab at the bottom of a goal's view (kept while moving between goals).
  goalTab = $state('routes');
  // The scroll position of each section when the user left it with the tab bar.
  scroll = {};
}
export const ui = new Ui();

/** What a page remembers while the app runs belongs to one data set: filters, searches, open items and scroll positions are dropped when the sample is entered or left. */
const forgetPageState = () => {
  ui.hangar = freshHangar(); ui.store = freshStore(); ui.storeTab = 'upgrades'; ui.browse = freshBrowse(); ui.goalTab = 'routes'; ui.scroll = {};
  ui.focusCopy = null; ui.focusStep = null; ui.importingGoals = false; ui.reserveAllOpen = false; ui.addingGoal = false; ui.back = null;
};

// The controller reads and saves through whichever backend is active; sample data swaps in an in-memory one.
const routed = createBackendSwitch(realBackend);
const controller = createController(routed, aliases, {
  onChange: (c) => { ui.app = c.state; ui.notice = c.notice; ui.loaded = true; },
  // Sample data is a throwaway set of its own: the feed's sale events are not mixed into it.
  feed: () => (ui.sample ? { events: [], at: null } : { events: ui.feed.events, at: ui.feed.generatedAt }),
});

export const load = async () => {
  try { await controller.load(); } catch (e) { ui.notice = e?.message ?? String(e); ui.loaded = true; }
};
/** Picks what the Browse store tab shows from the app's own catalog and the feed's (see chooseCatalog in src/logic/feed.mjs). */
const chooseShownCatalog = (error = null) => {
  const choice = chooseCatalog(ui.ownCatalog, ui.feed.catalog);
  ui.catalog = { loaded: ui.ownLoaded, doc: choice?.doc ?? null, source: choice?.source ?? null, error };
};
/** Reads the store catalog file (it has its own sync and is not part of the planner data). A missing file is "no catalog yet" (the feed's may fill in). */
export const loadCatalog = async () => {
  try { ui.ownCatalog = readCatalog(await realBackend.loadCatalog()); ui.ownLoaded = true; chooseShownCatalog(); }
  catch (e) { ui.ownCatalog = null; ui.ownLoaded = true; chooseShownCatalog(e?.message ?? String(e)); }
};

// ----- the signed data feed: sale events and a public catalog snapshot, checked by Rust (desktop) or the dev server (browser) -----

/** Reads the feed's verified copy and applies it: the planner's sale events and the catalog choice. Silent when there is none. */
const readFeedCache = async () => {
  let cache = null;
  try { cache = await realBackend.feed.read(); } catch { /* no feed in this build or an unreadable cache: nothing to show */ }
  const have = new Set(cache?.images ?? []);
  ui.feed = {
    ...ui.feed, generatedAt: cache?.generatedAt ?? null,
    events: readEvents(cache?.eventsDoc),
    catalog: cache?.catalog ? feedCatalog(cache.catalog, (name) => have.has(name)) : null,
    ships: feedShipFiles(cache?.images),
  };
  chooseShownCatalog(ui.catalog.error);
  await controller.refeed();
};
/** Only the list of the feed's ship pictures on disk, for ShipThumb (cheaper than a whole readFeedCache: nothing is derived again). */
const readFeedShips = async () => {
  let cache = null;
  try { cache = await realBackend.feed.read(); } catch { return; }
  ui.feed = { ...ui.feed, ships: feedShipFiles(cache?.images) };
};
let feedRunning = false;
/** How many ship pictures one download round fetches; the list is re-read after each round. */
const SHIP_ROUND = 60;
/**
 * One feed round: show what is saved, ask for a newer one (the backend asks at most every 6 hours), show that, then fetch the ship
 * pictures (whatever catalog is shown: every ship thumbnail uses them until the picture sync has its own), then the catalog pictures
 * while the feed's catalog is the one shown. Offline, refused or unavailable is silent; the saved copy stays.
 */
export const refreshFeed = async ({ force = false } = {}) => {
  if (feedRunning || ui.sample) return;
  feedRunning = true;
  try {
    if (!ui.ownLoaded) await loadCatalog(); // which catalog is shown depends on it
    await readFeedCache();
    let status = null;
    try { status = (await realBackend.feed.refresh(force))?.status ?? null; } catch { status = 'offline'; }
    ui.feed = { ...ui.feed, status };
    if (status === 'updated') await readFeedCache();
    // Ship pictures first, in small rounds so the first ones show at once.
    for (let round = 0; round < 100; round++) {
      let r = null;
      try { r = await realBackend.feed.images(SHIP_ROUND, 'ships'); } catch { break; }
      if (!r?.downloaded) break;
      await readFeedShips();
      if (!r.remaining) break;
    }
    for (let round = 0; round < 100 && ui.catalog.source === 'feed' && ui.feed.catalog; round++) {
      let r = null;
      try { r = await realBackend.feed.images(200); } catch { break; }
      if (!r?.downloaded) break;
      await readFeedCache();
      if (!r.remaining) break;
    }
  } finally { feedRunning = false; }
};
/** Starts the feed: now, then every 6 hours while the app runs. Returns a stop function. */
export const startFeed = () => {
  const first = setTimeout(() => { refreshFeed(); }, 1500);
  const every = setInterval(() => { refreshFeed(); }, FEED_REFRESH_MS + 60_000);
  return () => { clearTimeout(first); clearInterval(every); };
};
export const dispatch = (action) => controller.dispatch(action);
export const dismissNotice = () => { ui.notice = null; };

/** Open a main section (and close any Advanced screen). A link that wants a way back sets it after this (see `navigate`). */
export const goSection = (section) => { ui.section = section; ui.advanced = null; ui.back = null; };
/** Open the goals view of a goal. Picking a goal drops the way back of an earlier link (`navigate` sets its own after the move). */
export const openGoal = (id) => { ui.back = null; ui.selected = id; if (ui.advanced !== 'graphs' && (ui.section !== 'goals' || ui.advanced)) goSection('goals'); };

// The page scrolls inside .main (wide windows) or .body (narrow ones).
const scrollers = () => [document.querySelector('.main'), document.querySelector('.body')];
const readScroll = () => scrollers().map((e) => e?.scrollTop ?? 0);
const restoreScroll = async (pos) => {
  await tick();
  scrollers().forEach((e, n) => { if (e) e.scrollTop = pos?.[n] ?? 0; });
};
const placeKey = () => (ui.advanced ? `adv:${ui.advanced}` : ui.section);

/** The tab bar and the Advanced menu: a page the user left comes back where they scrolled to. */
export async function pickSection(section) {
  ui.scroll[placeKey()] = readScroll();
  goSection(section);
  await restoreScroll(ui.scroll[section]);
}
export async function pickAdvanced(key) {
  ui.scroll[placeKey()] = readScroll();
  ui.advanced = key; ui.back = null;
  await restoreScroll(ui.scroll[`adv:${key}`]);
}

/**
 * Go somewhere with a link that offers a way back: remembers the page, its goal and its scroll position under `label`.
 * `go` does the move (it may call goSection / openGoal / set ui.advanced); the way back is set after it.
 */
export async function navigate(label, go, { top = true } = {}) {
  const back = { label, section: ui.section, advanced: ui.advanced, selected: ui.selected, scroll: readScroll() };
  go();
  ui.back = back;
  if (top) await restoreScroll(null);
}
/** The "Back to ..." link: returns to the remembered page, goal and scroll position. */
export async function goBack() {
  const b = ui.back;
  if (!b) return;
  ui.back = null;
  ui.section = b.section; ui.advanced = b.advanced; ui.selected = b.selected;
  await restoreScroll(b.scroll);
}

/** Today (or anywhere) -> one step of a goal's chain: opens the goal, expands the run that holds the step, focuses the row. */
export const openStep = (goalId, from, to, label = 'Back to Today') => navigate(label, () => {
  ui.focusStep = { goalId, from, to };
  ui.selected = goalId;
  ui.section = 'goals'; ui.advanced = null;
});
/** A goal's owned step -> that copy in the Hangar's upgrade table. */
export const openHangarCopy = (copyId, label) => navigate(label, () => {
  ui.hangar.chip = 'ccu'; ui.hangar.sel.ccu = null; ui.hangar.query = ''; ui.hangar.picked = true;
  ui.focusCopy = copyId;
  goSection('hangar');
});
/** A goal's chain map. */
export const openChainMap = (goalId, label) => navigate(label, () => { ui.selected = goalId; ui.advanced = 'graphs'; });
/** Prices -> the Store's Sale events section. */
export const openSaleEvents = (label = 'Back to Price assumptions') => navigate(label, () => { ui.focusSaleEvents = true; ui.storeTab = 'upgrades'; goSection('store'); }, { top: false });
/** A Store offer -> the upgrades you own into that ship, in the Hangar. */
export const openHangarUpgrades = (shipName, label) => navigate(label, () => {
  ui.hangar.chip = 'ccu'; ui.hangar.sel.ccu = null; ui.hangar.query = shipName; ui.hangar.picked = true;
  goSection('hangar');
});
/** The hangar-health banner -> the Hangar's upgrades with only "Needs review" ticked: the upgrades the planner could not read. */
export const openNeedsReview = (label = 'Back') => navigate(label, () => {
  ui.hangar.chip = 'ccu'; ui.hangar.sel.ccu = { use: ['review'] }; ui.hangar.query = ''; ui.hangar.picked = true;
  goSection('hangar');
});
/** Open Today and bring the "Since last sync" panel into view. */
export const openChanges = async () => {
  goSection('today');
  await tick();
  document.getElementById('since-sync')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Opens the Glossary at an entry. `opener` (the clicked element) gets the focus back on close. */
export const openGlossary = (key = '', opener = null) => { ui.glossaryOpener = opener; ui.glossary = key; };
export const closeGlossary = () => { ui.glossary = null; };

/** Switch to the built-in sample data (in memory; the real data folder is not read or written meanwhile). */
export const enterSample = async () => {
  if (ui.syncBusy || ui.signingIn || ui.switching) return;
  ui.switching = true;
  ui.skipTour = true;
  try {
    try { await switchBackend(routed, controller, createSampleBackend(sampleData)); }
    catch (e) { ui.notice = e?.message ?? String(e); return; }
    clearJobCache(); // answers of the other data set must not be shown here
    forgetPageState();
    // The sample opens on its chain (the Goals page), not on Today with a definition over it.
    ui.sample = true; ui.advanced = null; ui.back = null; ui.notice = null;
    await controller.refeed(); // the sample gets none of the feed's events
    ui.selected = Object.keys(controller.state?.plans?.chains ?? {})[0] ?? null;
    ui.section = ui.selected ? 'goals' : 'today';
  } finally { ui.switching = false; }
};
/** Back to the real data (or the welcome screen when there is none). Stays in sample mode, with the error shown, when the real data cannot be loaded. */
export const leaveSample = async () => {
  if (ui.switching) return;
  ui.switching = true;
  try {
    try { await switchBackend(routed, controller, realBackend); }
    catch (e) { ui.notice = `Could not load your data, still on sample data: ${e?.message ?? e}`; return; }
    clearJobCache();
    forgetPageState();
    ui.sample = false; ui.selected = null; ui.advanced = null; ui.section = 'today'; ui.notice = null;
    await controller.refeed(); // your data gets the feed's events again
  } finally { ui.switching = false; }
};

/** A link to a goal from another page ("View Galaxy chain"), with a way back. */
export const openGoalFrom = (goalId, label) => navigate(label, () => { ui.selected = goalId; ui.section = 'goals'; ui.advanced = null; });

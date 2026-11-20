# CCU Planner desktop app — design

Date: 2026-11-18. Status: draft for approval.

## Intent

The CCU planner (this repository) works today as Node CLI scripts: a read-only
RSI client with Playwright login, a route planner, saved chains with CCU
reservations, watch/finish/lock modes, melt candidates, expected prices and a
"wanted Warbonds" list. It replaces the buggy CCU Game browser extension for
Denis and possibly a few friends.

The goal is a real desktop app with a proper UI and charts, so the daily
routine during sales (especially IAE, when Warbonds appear daily) is: open the
app, sync, see per chain what to buy, what to watch for and what to melt. It is
not part of Star Compendium and will not be.

## Goals

- Native desktop app built with Tauri 2 (Rust). Mac first, Windows next,
  Linux later. Each user runs it on their own computer with their own RSI
  login; there is no shared server and no multi-user mode.
- Everything the CLI can do is available in the app (list below).
- Charts: per-chain price staircase, "would help" thresholds, melt candidates
  by value, offer-history timeline, and an interactive view of the CCU graph
  the planner searches. A fleet map (all chains on one price axis) is an
  optional later extra.
- Login to RSI inside an app window; syncs run in the background with progress.

## Non-goals

- Buying, melting, gifting, applying CCUs, buy-back or cart actions on RSI.
  The app tells you what to do; you do it on the RSI site.
- Predicting which Warbonds RSI will offer, or Warbond likelihood data.
- Shared/hosted service, accounts, syncing data between users.
- Being part of Star Compendium.

## Anti-goals (failure even if it works)

- Storing the RSI password anywhere, or sending session cookies/tokens
  anywhere except RSI.
- Any RSI request outside the read-only allowlist (a mutation by accident is
  the worst outcome).
- Logic drift: planner results in the app differ from the tested logic.
- Hammering RSI (requests must stay spaced, ~1 s, with 429 back-off).

## Constraints and facts

- RSI endpoints, auth headers, allowlist and HTML parsing rules are documented
  in `README.md` ("RSI endpoints used", "Safety") and implemented in
  `src/rsi.mjs`, `src/parse.mjs`, `scripts/sync.mjs`. Key facts: GraphQL at
  `/pledge-store/api/upgrade/v2/graphql` needs `x-csrf-token` from the account
  page's `<meta name="csrf-token">`; the upgrade context needs
  `POST /api/ship-upgrades/setContextToken` with header `x-rsi-token` = the
  `Rsi-Token` cookie; hangar and buy-back are HTML, 10 entries per page
  regardless of `pagesize`; incremental paging stops on an empty, short or
  repeated page; a full re-sync every 7 days marks vanished pledges.
- Tauri 2 can read all cookies of its own webview including HttpOnly ones
  (`WebviewWindow::cookies_for_url`). On Windows this deadlocks in synchronous
  commands: read cookies from async commands on a separate thread.
- Planner logic is pure ES modules except for file IO in `src/data.mjs`
  (`loadPlannerData`, overrides) and `scripts/chain.mjs` (state file).
- Currency: friends use EUR accounts with VAT (Denis, 2026-11-18), so EUR
  is a first-class case, not a fallback. Observed so far: `initShipUpgrade`
  returns `app.pricing` with `currencyCode`, `exchangeRate` (EUR session:
  8800, read as 0.88) and `taxRate` (20 % in that session); a USD session has
  exchange rate 1 and no tax. Catalog msrp is USD without tax. Today's sync
  only fills prices for USD sessions, so this is new work (see "Currency"
  below).
- 45 node tests in `test/` cover planner, chains, melt, watch, objective,
  prices, wanted and concept behaviour.

## Approaches considered

- **A. Tauri; Rust for RSI and files; existing JS logic in the UI (chosen).**
  Rust does login window, RSI client, sync jobs and data storage. The tested
  planner modules run unchanged in the webview. Only the RSI/sync layer is
  rewritten.
- B. Tauri with all logic ported to Rust. One language, but rewrites ~1,500
  lines of tested logic and 45 tests for no speed benefit (routes already take
  10–50 ms). Rejected.
- C. Tauri around the existing Node code as a sidecar. Ships Node + Chromium
  (~200 MB) and is Rust in name only. Rejected.

## Decided

- Tauri 2, approach A.
- Main screen layout B "chain workspace" (mockup chosen 2026-11-18):

```
┌ Today: nothing to buy · store 11:13 · hangar 11:16      [Sync] ┐
├──────────┬─────────────────────────────────────────────────────┤
│ CHAINS   │ Pulse → Galaxy   $60 new · all-in $165 · watch      │
│ ▸ Galaxy │  price staircase (x: step, y: ship msrp; segments   │
│   Arrastra│  coloured owned / Standard / Warbond)              │
│   600i   │  Steps (buy now / lock / later / owned) │ Would help │
│   Odyssey│                                          │ (bars)     │
│ + chain  │                                                     │
├──────────┴─────────────────────────────────────────────────────┤
│ Hangar · Melt · Prices · Offer history                         │
└────────────────────────────────────────────────────────────────┘
```

- Platforms: macOS first, Windows second, Linux later.
- Read-only toward RSI, password never stored (unchanged safety rules).

## Proposed (Claude's calls, open to correction)

### Architecture

```
Webview (Svelte + ECharts)
  ├─ src/logic/*  ← planner.mjs, chains.mjs, melt.mjs, wanted.mjs,
  │                 data mapping (pure part of data.mjs) — shared with CLI
  └─ invoke() ──► Rust (Tauri commands)
                    ├─ login window (RSI site), cookie capture
                    ├─ RSI client: allowlist, 1 s spacing, 401/403 → re-login
                    │  prompt, 429 back-off
                    ├─ sync jobs: catalog, upgrades, details, hangar, buyback
                    │  (incremental), progress events, cancel
                    └─ store: JSON files in the app data dir, atomic writes,
                       rev check for plans.json
```

- `src/data.mjs` is split into a pure mapping module (catalog + upgrades +
  details + hangar → ships/offers/owned/review; overrides) and a thin Node file
  loader. The app passes the raw JSON it gets from Rust into the pure module.
  CLI and app use the same logic files; the 45 tests keep running with node.
- Parsing hangar/buy-back HTML moves to Rust (`scraper` crate), matching
  `src/parse.mjs` field for field (pledgeId, name, value, currency,
  notBuybackable, availability, created, contains, canGift via
  `.js-gift, .js-gift-v2`, canReclaim, canApplyUpgrade, upgrade JSON from
  `js-upgrade-data`, items). Output files keep today's JSON shape so the JS
  logic and CLI keep working.
- Rust stores the session (cookies + csrf) in the app data dir, file mode 600
  on Unix; on Windows default user-profile ACLs. When RSI answers 401/403, the
  app shows "log in again" (opens the login window) instead of re-authing
  silently.
- Sync semantics match `scripts/sync.mjs`, including offer-history events
  (appeared / disappeared / repriced) and fetching details for new SKUs.

### Screens

- Chain workspace (layout above). Chain header: new money, all-in, mode,
  objective, lock; actions: accept proposal N, release, remove, change
  mode/objective/lock, priority. Proposal vs accepted diff ("same path, $10
  less", "alternative path", "blocked"). "X less if cN released" note.
- Steps table grouped: buy now (Warbonds), lock now, later (Standard bridges),
  owned (copy id, paid, giftable). Price-change warnings ("buy before the price
  rises/changes").
- Would help panel: grouped wanted list ("any discount helps" / "needs N%
  off" / "would create a route"), bars by threshold; "on sale near this route"
  with slack control.
- Today banner: across chains, Warbonds to buy now, locks to buy, anything new
  since last sync; sync buttons with progress; data ages.
- Sync buttons (user request 2026-11-18), each with its own progress, data
  age and a cancel. Only one sync job runs at a time; the others are disabled
  while it runs:
  - "Sync store": catalog, upgrades, details and ship pictures.
  - "Update hangar": quick (incremental, stops at the first unchanged page)
    and full (all pages, marks vanished pledges). Buy-back is included.
  The banner shows the store and hangar ages beside them. The Rust client
  arrives in phase 3; until then the buttons are not shown.
- Hangar tab (extended 2026-11-18): the whole hangar. That means standalone
  ships and game packages with details (insurance, contents, value, giftable,
  upgraded), CCUs (filter by mapped/needs review, giftable, meltable,
  reserved by), paints, equipment and other items, a detail view per pledge,
  and the buy-back list.
- Melt tab: candidates with reason for every kept copy, the melt plan for
  finish chains and locks, totals; bar chart by value.
- Prices tab: expected prices (add/clear, note), concept ships list,
  affected offers count.
- Offer history tab: timeline of appeared/disappeared/repriced offers, filter
  by ship/chain; Warbonds that appeared and which chains use them.
- Add chain: ship pickers (search by name) for base and target, priority,
  mode.
- Graph view (asked for by Denis): the graph the planner searches, made
  visible. Ships are nodes placed by msrp (x axis); edges are owned CCUs,
  Standard offers and Warbonds in the three route colours. The full graph has
  ~14,800 offer edges, so it opens filtered: by default the neighbourhood of
  the selected chain (its proposals and accepted route highlighted, the ships
  reachable from the base and those that reach the target), with toggles for
  edge kinds, owned-only, Warbonds-only, price range and "edges a chain
  uses". Hovering an edge shows price, kind, copy/SKU; clicking a ship lists
  its CCUs in and out. Copies reserved by other chains are marked. Wanted
  pairs ("would help") can be drawn as dashed hypothetical edges.
- Plan explorer (from `plan.mjs`): any from/to, k routes, credit,
  objective, no-owned / no-warbond toggles.

### Currency (EUR with VAT)

- Planning stays in one internal unit: USD cents without tax, the unit of
  catalog msrp and of Standard upgrades (msrp difference). Exchange rate and
  VAT are the same factor for every item in a session, so route choices do
  not change; only the displayed numbers do.
- Sync in a non-USD session converts each native offer price to the internal
  unit with that session's `exchangeRate` and `taxRate`, keeps the native
  amount next to it, and checks a sample of pairs with `getPrice` (`amount`
  vs `nativeAmount`). A pair whose conversion does not round-trip is flagged,
  not guessed. Standard prices are cross-checked against the msrp
  difference.
- Hangar values (what a CCU cost, its melt value) are in the currency the
  pledge was bought in, including the VAT paid then. They are compared with
  store prices in that same currency including VAT, so melt candidates and
  savings mean "credit you get back vs what it costs to buy again today".
- Display: everything in the account's currency including VAT (e.g.
  "€42.24"), with the internal USD shown on hover; a setting can switch the
  main display to USD.
- Acceptance: verified live on a friend's EUR account (they log in
  themselves in the app) before EUR is called supported: offer prices match
  the RSI upgrade tool, hangar values match the hangar page, melt credit
  matches RSI's reclaim figure for a sample CCU.

### Data migration

On first start the app offers to import `.local/data` from this repository
(catalog, upgrades, details, hangar, buyback, plans, price-overrides, offer
history). The Chrome profile and capture files are not imported.

### Distribution

- macOS: signed and notarized `.dmg` with Denis's Apple developer account for
  friends; unsigned dev builds for himself.
- Windows: MSI/NSIS build later, unsigned at first (SmartScreen warning
  accepted for friends).
- No auto-updater in the first version.

### Phases

1. Logic split (pure data module), Tauri skeleton, read-only screens over
   imported data (workspace, steps, staircase, would help, melt, prices,
   hangar). No RSI access yet.
2. Write actions (chains, prices, modes) with the same state rules as the CLI.
3. Rust RSI client + login window + background sync, verified against the
   Node sync on the same account (same JSON output modulo timestamps), then
   EUR-with-VAT support verified on a friend's account.
4. Graph view, offer history timeline, today banner, polish, macOS signed
   build.
5. Windows build. Later: Linux, fleet map.

### Settled after the builder check (Claude's calls)

- **Repository layout:** the app lives in this repo under `app/` (Tauri +
  Svelte). `src/` is split into `src/logic/` (pure: planner, chains, melt,
  wanted, data mapping, state transitions) and Node-only files (session,
  Playwright, file loaders). Tests keep running with `node --test`.
- **State ownership:** the app data dir is the single data location. The
  state transitions now in `scripts/chain.mjs` (new state, add, accept with
  claim check, release, remove, mode/objective/lock, credit, prices) move into
  a pure module in `src/logic/`. The webview runs them; Rust persists the
  result with an atomic write and the existing rev check (refuse if the file
  changed since it was read). The CLI stays as a developer tool and gets a
  `--data <dir>` option pointing at the app data dir; with the rev check, an
  app and a CLI run at the same time cannot overwrite each other silently.
- **Rust HTTP path:** today Node `fetch` (not a browser) works with the
  captured cookies, so `reqwest` with the same headers is expected to work.
  Phase 3 starts with a short spike that proves it on the five allowlisted
  calls. Fallback if RSI rejects it: run the allowlisted requests from inside
  the hidden login webview, with the allowlist and spacing still enforced in
  Rust before each request.
- **Login lifetime:** the login webview uses a persistent profile in the app
  data dir (cookies survive restarts, like the Chrome profile today). On
  401/403 the app first re-reads cookies from that profile silently; only if
  that fails does it ask "log in again". A sync that hits this pauses, waits
  for the login and resumes from the page/ship it was on.
- **Phases vs friends:** phases 1–2 are for Denis only (data imported from
  `.local/data`). Friends need phase 3 (login + sync). The Windows cookie
  workaround belongs to phase 3/5.
- **Sync acceptance:** one live comparison against the Node sync on Denis's
  account before the Node sync is retired, plus a committed fixture suite of
  anonymised hangar/buy-back/GraphQL responses as the automated gate.

## Left to the builder

- Svelte flavour (SvelteKit static adapter or plain Vite + Svelte), state
  management, component library or none, styling.
- Chart library details (ECharts proposed; anything comparable is fine).
- Rust crate choices (reqwest, scraper, serde, tokio), module layout, error
  types, how progress events are shaped.
- Exact app data dir layout and file names, as long as the JSON shapes the
  JS logic reads stay compatible.
- Test strategy for Rust parsing (fixtures from saved HTML pages; strip
  personal data before committing fixtures).
- Using Codex subagents for well-specified parts (Denis allowed it).

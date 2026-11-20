# CCU Planner desktop app, phases 1–2: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 desktop app (macOS) that shows and edits Denis's CCU chains over data imported from `.local/data`: chain workspace (layout B) with price staircase, steps, "would help", hangar, melt, prices, graph view, add chain and plan explorer. No RSI access in this plan.

**Architecture:** Pure planner logic moves to `src/logic/` and runs unchanged in the webview (Svelte 5 + ECharts) and in the Node CLI. Rust (Tauri commands) only reads and writes JSON files in the app data dir, with an atomic write and a rev check. A Vite dev plugin serves the same two operations over HTTP so the UI can be checked in a normal browser.

**Tech Stack:** Rust 1.94, Tauri 2 (`tauri = "2"`, `tauri-build = "2"`, `@tauri-apps/cli` 2.12.5, `@tauri-apps/api` 2.12.5), Svelte 5.58 (runes), Vite 8.3 with `@sveltejs/vite-plugin-svelte` 7.3, ECharts 6.1, `node --test` for JS, `cargo test` for Rust.

**Spec:** `docs/superpowers/specs/2026-11-18-ccu-desktop-app-design.md` (approved 2026-11-18). Later plans: phase 3 (Rust RSI client, login, sync, EUR with VAT), phase 4 (offer-history timeline, signed build), phase 5 (Windows).

## Global Constraints

- No request to RSI anywhere in this plan. No buy/melt/gift/apply/cart action, ever.
- `.local/` (profile, session, data) and the app data dir are never committed; fixtures in `test/fixtures/` are synthetic (invented IDs and names), never copied from Denis's account.
- One internal money unit: USD cents without tax (integers). Display `$` with `usd()` formatting as in `scripts/chain.mjs` (`$40`, `$42.50`).
- The logic modules in `src/logic/` stay free of Node and browser APIs (no `fs`, `path`, `window`, `fetch`).
- View-model modules in `app/src/lib/view/*.mjs` are plain ES modules tested with `node --test test/view/`; they import logic by relative path (`../../../../src/logic/x.mjs`), never through the Vite alias, so node can load them. Svelte components may use the `$logic` alias.
- Saves never overwrite a newer file: a save carries the `rev` it was based on; a mismatch is a conflict.
- Commit messages: subject + body listing what changed and what was verified; no AI attribution lines.
- Bundle identifier `com.ccuplanner.desktop`, product name `CCU Planner`.

## Review Focus

1. **First start with an empty data dir** → the app shows the import screen ("Import from a ccu-planner checkout"), never a blank page or an exception. Test in Task 3 (Rust `load_data` on empty dir) and Task 4 (`deriveAppState(null)`).
2. **A chain without any route** (Carrack → Odyssey today) → the workspace shows "No route today", an empty staircase with that message, and the "would create a route" list. Test in Task 5 (`staircase` of null route) and Task 6.
3. **plans.json changed by the CLI while the app is open** → the save is refused, the app reloads the data and says "Changed outside the app; reloaded. Do it again." No silent overwrite. Test in Task 3 (Rust) and Task 4 (backend conflict path).
4. **Ship IDs missing from the catalog** (offer or CCU pointing at an unknown ship) and hangar CCUs needing review → names fall back to `#<id>`, review items are listed in the Hangar tab, nothing throws. Test in Task 1 (mapping) and Task 8.
5. **The full graph is large** (~14,800 offer edges, ~240 ships) → the graph view never renders more than `maxEdges` (default 600) edges and says how many were hidden. Test in Task 9.

## Before Task 1

The working tree holds uncommitted planner work (expected prices, all-in objective, wanted Warbonds, concept ships, target lock; 45 tests green) plus the design and this plan. Commit those first, with Denis's go-ahead, on `main`; then create a branch `desktop-app` for this plan. Task 1 uses `git mv` and must start from a clean tree.

---

### Task 1: Split pure logic from Node file access

**Files:**
- Move (git mv): `src/planner.mjs`, `src/chains.mjs`, `src/melt.mjs`, `src/wanted.mjs`, `src/aliases.json` → `src/logic/`
- Create: `src/logic/mapping.mjs`, `src/logic/ships.mjs`, `src/logic/prices.mjs`
- Modify: `src/data.mjs` (becomes the Node loader), `scripts/chain.mjs`, `scripts/plan.mjs`, `scripts/sync.mjs`, all `test/*.test.mjs` imports
- Create: `test/fixtures/raw-small.json`, `test/mapping.test.mjs`

**Interfaces:**
- Produces:
  - `RawData` (the contract between Rust/dev server and JS): `{ catalog, details: object|null, upgrades: UpgradeFile[], hangar: object|null, buyback: object|null, history: string, plans: object|null, overrides: object|null }` where `UpgradeFile` is today's `upgrades/<fromId>.json` content and `history` is the raw `offer-history.jsonl` text (`''` if absent).
  - `buildPlannerData(raw: RawData, aliases: object) -> { ships: Map, offers: [], owned: [], review: [], buyback: [], meta: {} }` in `src/logic/mapping.mjs` — today's `loadPlannerData` body without file access; `buyback` is `raw.buyback?.entries` as an array (or `[]`).
  - `norm(s)`, `findShip(ships, query)`, `shipName(ships, id) -> string` (`#<id>` when unknown) in `src/logic/ships.mjs`.
  - `expectedMsrp`, `expectedOffers` (unchanged) plus `emptyOverrides() -> { rev: 0, ships: {} }` in `src/logic/prices.mjs`.
  - Node: `DATA_DIR` (env `CCU_DATA` or `<repo>/.local/data`), `readRaw(dir = DATA_DIR) -> RawData`, `loadPlannerData(dir) -> buildPlannerData(readRaw(dir), aliases)`, `loadOverrides(dir)`, `saveOverrides(o, dir)` in `src/data.mjs`.

- [ ] **Step 1: Write the failing mapping test** `test/mapping.test.mjs` with a synthetic `test/fixtures/raw-small.json` (3 ships: ids 1 "Alpha" $50, 2 "Beta" $75 concept, 3 "Gamma" $100; one upgrades file from 1 with a Standard SKU to 2 and a Warbond SKU to 3; details giving SKU titles; hangar with one CCU 1→2 matched by item id, one with unresolvable items, one pointing at ship id 99 by name "Nope"). Assertions:
  - `ships.get(2).concept === true`, `offers.length === 2`, kinds `standard`/`warbond` from titles
  - `owned.length === 1`, `owned[0].matchMethod === 'item-id'`
  - `review.length === 2`
  - `buildPlannerData({ ...raw, details: null, history: '', buyback: null }, aliases)` still returns offers (kind inferred), `meta.inferredKinds === 2`
  - `shipName(ships, 99) === '#99'`
- [ ] **Step 2: Run** `node --test test/mapping.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** the move and split. `git mv` the four modules and `aliases.json`; `mapping.mjs` takes `aliases` as a parameter (the Node loader reads `src/logic/aliases.json`; the app imports it as JSON). Keep `src/data.mjs` re-exporting `findShip`, `norm`, `expectedOffers`, `expectedMsrp` so scripts change only their import paths.
- [ ] **Step 4: Run** `node --test test/` → all 45 old tests + the new one PASS; `node scripts/chain.mjs list` and `node scripts/plan.mjs --from Pulse --to Galaxy --k 1` print the same as before the change (compare output saved before Step 3).
- [ ] **Step 5: Commit** "Split planner logic into src/logic and a Node loader".

### Task 2: Pure state actions shared by CLI and app

**Files:**
- Create: `src/logic/state.mjs`, `test/state.test.mjs`
- Modify: `scripts/chain.mjs` (use the actions; add `--data <dir>` → sets `CCU_DATA`)

**Interfaces:**
- Consumes: `addChain`, `acceptRoute`, `releaseChain`, `setMode`, `setObjective`, `setLock`, `ConflictError` from `src/logic/chains.mjs`.
- Produces: `applyAction(doc: { plans, overrides }, action: Action, ctx: { ships, graph }) -> { plans, overrides, changed: 'plans'|'overrides', result? }` — pure, returns new deep-copied documents, never mutates input. `Action` is one of:
  - `{ type: 'addChain', base, target, name?, priority?, mode? }` → `result: chain`
  - `{ type: 'accept', chainId, route }` (throws `ConflictError` like today)
  - `{ type: 'release' | 'remove', chainId }`
  - `{ type: 'setMode' | 'setObjective' | 'setLock' | 'setPriority', chainId, value }`
  - `{ type: 'setCredit', cents }`
  - `{ type: 'setPrice', shipId, cents, note? }`, `{ type: 'clearPrice', shipId }`
  - `{ type: 'acceptFleet', plans: [{ chainId, route }] }` (release all, accept each; as `chain fleet --accept`)

- [ ] **Step 1: Write failing tests** in `test/state.test.mjs`:
  - `applyAction` leaves the input `doc` unchanged (deep-equal to a copy taken before)
  - `addChain` then `remove` → `plans.chains` empty, `nextId` still advanced
  - `setPriority` with `'urgent'` throws; `setPrice` with `cents <= 0` throws
  - `setPrice` writes `overrides.ships[id] = { msrp, note, setAt }` and `changed === 'overrides'`; `clearPrice` removes it
  - `accept` of a route using a copy reserved by another chain throws `ConflictError`
  - neither `plans.rev` nor `overrides.rev` is changed by `applyAction` (the store bumps rev)
- [ ] **Step 2: Run** `node --test test/state.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `applyAction` with `structuredClone` and a `switch`; refactor `scripts/chain.mjs` commands `add/accept/release/remove/mode/objective/lock/credit/price/fleet --accept` to call it and then save as today.
- [ ] **Step 4: Run** `node --test test/` → PASS; `node scripts/chain.mjs --data /tmp-copy list` against a copy of `.local/data` (in the scratchpad) works and `chain credit 0` there bumps `rev` by exactly 1.
- [ ] **Step 5: Commit** "Add pure state actions shared by CLI and app".

### Task 3: Tauri app skeleton and Rust data store

**Files:**
- Create: `app/package.json`, `app/vite.config.js`, `app/index.html`, `app/src/main.js`, `app/src/App.svelte`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/build.rs`, `app/src-tauri/capabilities/default.json`, `app/src-tauri/src/main.rs`, `app/src-tauri/src/lib.rs`, `app/src-tauri/src/store.rs`
- Modify: root `.gitignore` (add `app/node_modules/`, `app/dist/`, `app/src-tauri/target/`)

**Interfaces:**
- Produces Tauri commands (all `async`):
  - `load_data() -> RawData | null` — `null` when `catalog.json` is missing in the data dir
  - `save_doc(name: "plans" | "overrides", doc: serde_json::Value, base_rev: u64) -> u64` — returns the new rev; error string `"conflict"` when the file's current `rev` (0 if absent) ≠ `base_rev`; writes `rev = base_rev + 1` via temp file + rename; any other name is rejected
  - `import_legacy(dir: String) -> Vec<String>` — copies only `catalog.json`, `ship-details.json`, `hangar.json`, `buyback.json`, `plans.json`, `price-overrides.json`, `offer-history.jsonl`, `upgrades/*.json` from `dir` into the data dir; returns the copied relative paths; refuses if `dir/catalog.json` is missing
  - `data_dir() -> String`
- Data dir: `app.path().app_data_dir()/data`. File names inside are the same as `.local/data` (`price-overrides.json` for overrides).

- [ ] **Step 1: Scaffold** with `npm create tauri-app@latest` equivalents by hand (Vite + Svelte 5, JS) in `app/`; Vite alias `$logic` → `../src/logic`; `tauri.conf.json`: identifier `com.ccuplanner.desktop`, productName `CCU Planner`, window 1400×900, min 1000×700.
- [ ] **Step 2: Write failing Rust tests** in `store.rs` (`#[cfg(test)]`, `tempfile`):
  - `load_returns_none_on_empty_dir`
  - `save_rejects_stale_rev` (file rev 3, base_rev 2 → `Err("conflict")`, file unchanged)
  - `save_bumps_rev_atomically` (base_rev 3 → returns 4, file has `"rev": 4`, no `.tmp` left)
  - `save_rejects_unknown_name` (`"../catalog"` → error)
  - `import_copies_only_known_files` (source with an extra `session.json` and `profile/` → neither copied)
  - `load_reads_all_upgrades_and_history` (two upgrade files, history text preserved byte for byte)
- [ ] **Step 3: Run** `cd app/src-tauri && cargo test` → FAIL.
- [ ] **Step 4: Implement** `store.rs` as plain functions over a `&Path` (testable without Tauri) and thin `#[tauri::command]` wrappers in `lib.rs` that resolve the data dir.
- [ ] **Step 5: Run** `cargo test` → PASS; `cd app && npm install && npm run tauri dev` opens a window titled "CCU Planner" showing `data_dir()`.
- [ ] **Step 6: Commit** "Add Tauri app skeleton with a rev-checked JSON store".

### Task 4: Backend adapter, dev server, app state and shell (layout B)

**Files:**
- Create: `app/src/lib/backend.js`, `app/vite-dev-data.js` (Vite plugin), `app/src/lib/state.svelte.js`, `app/src/lib/view/derive.mjs`, `app/src/lib/view/controller.mjs`, `app/src/lib/view/format.mjs`, `app/src/lib/view/today.mjs`, `app/src/lib/Shell.svelte`, `app/src/lib/ImportScreen.svelte`, `test/view/today.test.mjs`, `test/view/controller.test.mjs`
- Modify: `app/src/App.svelte`, `app/vite.config.js`

**Interfaces:**
- Consumes: Task 1 `buildPlannerData`, Task 2 `applyAction`, Task 3 commands.
- Produces:
  - `backend.load() -> RawData|null`, `backend.save(name, doc, baseRev) -> newRev` (throws `ConflictError`-like `{ conflict: true }`), `backend.importLegacy(dir)`, `backend.dataDir()`. Uses `@tauri-apps/api/core` `invoke` when `window.__TAURI_INTERNALS__` exists, else `fetch('/__dev/load' | '/__dev/save' | ...)` served by `vite-dev-data.js` from `process.env.CCU_DATA` with the same rev rule.
  - `deriveAppState(raw: RawData|null, aliases) -> null | { data, graph, plans, overrides, expected }` in `app/src/lib/view/derive.mjs` (pure).
  - `createController(backend, aliases) -> { state, notice, load(), dispatch(action) }` in `app/src/lib/view/controller.mjs`: `dispatch` runs `applyAction`, saves the changed doc with its rev and bumps the local rev; on `{ conflict: true }` it calls `load()` and sets `notice = 'Changed outside the app; reloaded. Do it again.'`; other errors set `notice` to the error message. `state.svelte.js` wraps the controller in Svelte `$state`.
  - `usd(cents)` in `format.mjs` (`$40`, `$42.50`, `?` for null).
  - `todaySummary(appState) -> { buyNow: [{ chainId, step }], locks: [{ chainId, step }], nothing: boolean, catalogAt, hangarAt }` in `today.mjs`, using each watch chain's best proposal (`proposeChain` k=1), `splitRoute(route, { lock: !!lockReason(...) })`.
- Shell layout: top Today banner ("Nothing to buy" when `nothing`; else the buy-now and lock lines), left chain list (name, mode badge, "no route" badge), main area (selected chain, Task 5), bottom tabs Hangar · Melt · Prices · Graph · Plan explorer. Dark theme tokens: background `#0d1117`, panels `#161b22`, border `#30363d`, owned `#3fb950`, Standard `#d29922`, Warbond `#a371f7`.

- [ ] **Step 1: Write failing tests** `test/view/today.test.mjs`: (a) synthetic state where no route has Warbond steps and no lock → `nothing === true`; (b) a watch chain whose best route has a Warbond step → listed in `buyNow`; (c) concept target with a Standard last step → listed in `locks`; (d) `deriveAppState(null)` returns `null`; `usd(4250) === '$42.50'`, `usd(null) === '?'`. And `test/view/controller.test.mjs` with a fake backend: a successful `dispatch({ type: 'setCredit', cents: 500 })` calls `save('plans', doc, 0)` once and the next dispatch uses base rev 1; a backend whose `save` throws `{ conflict: true }` makes `dispatch` call `load` again and set the exact notice text.
- [ ] **Step 2: Run** `node --test test/view/` → FAIL.
- [ ] **Step 3: Implement** backend, dev plugin, derive, today, shell, import screen (text field for a checkout path, default `~/Documents/GitHub/ccu-planner/.local/data`, button "Import"; shows the copied files).
- [ ] **Step 4: Run** `node --test test/ test/view/` → PASS. Run `cd app && CCU_DATA=<scratch copy of .local/data> npx vite`, open it in the browser pane: banner says "Nothing to buy", chain list shows the 4 chains, Odyssey has a "no route" badge. With an empty `CCU_DATA` dir the import screen appears.
- [ ] **Step 5: Commit** "Add app shell, data adapter and today summary".

### Task 5: Chain workspace: header, staircase, steps, actions

**Files:**
- Create: `app/src/lib/view/staircase.mjs`, `app/src/lib/Workspace.svelte`, `app/src/lib/Staircase.svelte`, `app/src/lib/Steps.svelte`, `app/src/lib/Proposals.svelte`, `test/view/staircase.test.mjs`

**Interfaces:**
- Consumes: Task 4 app state and `dispatch`; `proposeChain`, `evaluateAccepted`, `diffRoutes`, `splitRoute`, `lockReason`, `expectedChanges` from `src/logic/chains.mjs`.
- Produces: `staircase(route|null, ships) -> { points: [{ x: stepIndex, y: msrpCents, ship: name }], segments: [{ from: i, to: i+1, kind: 'owned'|'standard'|'warbond' }], empty: boolean }` — x = 0 is the base ship; `empty` for null/zero-step routes.
- Workspace shows: header (`name`, new money, all-in, mode/objective/lock/priority selects, accepted status OK/REPRICED/BLOCKED with issues); staircase chart (ECharts line with one series per kind, ship names on hover); proposals 1–3 with `describeDiff` wording from the CLI ("Same path · $10 less cash", "Alternative path", "Unchanged", "New plan", "Blocked · no route") and an Accept button each; steps grouped Buy now / Lock now / Later / Owned (copy id, paid, giftable); warnings from `expectedChanges` ("Buy before the price rises/changes"); "X less if cN released …" note; Release and Remove (Remove asks for confirmation). Sidebar footer: "Fleet plan" opens `proposeFleet` results (per chain route line, total new money, credit left) with "Accept all" → `dispatch({ type: 'acceptFleet', plans })`.

- [ ] **Step 1: Write failing tests** `test/view/staircase.test.mjs`: a 3-step route Pulse($30) → 325a($70, Standard) → Spartan($80, owned) → M50($100, Warbond) gives 4 points with y `[3000, 7000, 8000, 10000]` and segment kinds `['standard','owned','warbond']`; `staircase(null)` and a zero-step route give `empty: true`; an unknown ship id yields `ship: '#<id>'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Move `describeDiff` and `routeLine` from `scripts/chain.mjs` into `src/logic/describe.mjs` and use them from both CLI and app.
- [ ] **Step 4: Run** `node --test test/ test/view/` → PASS. In the browser pane (dev server on a scratch copy): select "Pulse → Galaxy": staircase rises from $30 to $400 with two Standard segments; change mode to finish, reload page → still finish (persisted, `rev` +1); select Odyssey → "No route today".
- [ ] **Step 5: Commit** "Add chain workspace with staircase, steps and chain actions".

### Task 6: Would-help panel

**Files:**
- Create: `src/logic/wantedView.mjs`, `test/wanted-view.test.mjs`, `app/src/lib/WouldHelp.svelte`
- Modify: `scripts/chain.mjs` (`wanted` command uses `groupWanted`)

**Interfaces:**
- Consumes: `wantedWarbonds(state, chainId, graph, ships, { slack })` from `src/logic/wanted.mjs`.
- Produces: `groupWanted(result) -> { createsRoute: [item], ties: [{ to, items }], needs: [{ to, sharePct, items }] }` — the grouping now inline in `scripts/chain.mjs` (`ties` = needOff 0, `needs` sorted by required share, grouped by target ship).
- Panel: three sections ("Any discount helps", "Would help if discounted enough", "Would create a route" for no-route chains); horizontal bars per group (bar = Standard price, marker at "below"); "On sale near this route" list with a slack input in dollars (default 10).

- [ ] **Step 1: Failing test** `test/wanted-view.test.mjs`: from a synthetic `wantedWarbonds` result with two ties into the same target and one need → `ties.length === 1` with 2 items, `needs[0].sharePct === 14` for needOff 1000 / standard 7000; a result with `createsRoute` items puts them only in `createsRoute`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; CLI output of `chain wanted` stays as today.
- [ ] **Step 4: Run** tests → PASS; browser pane: Galaxy shows "→ M50 needs 14% off · from Pulse below $60"; Odyssey shows "Carrack → Odyssey up to $100".
- [ ] **Step 5: Commit** "Add would-help panel and share wanted grouping with the CLI".

### Task 7: Add chain and plan explorer

**Files:**
- Create: `app/src/lib/ShipPicker.svelte`, `app/src/lib/AddChain.svelte`, `app/src/lib/PlanExplorer.svelte`, `app/src/lib/view/shipSearch.mjs`, `test/view/ship-search.test.mjs`

**Interfaces:**
- Consumes: `norm`, `findShip` (Task 1); `planRoutes` from `src/logic/planner.mjs`; `dispatch({ type: 'addChain', ... })`.
- Produces: `searchShips(ships, query, limit = 8) -> [ship]` — exact normalized match first, then prefix, then substring, ties by msrp ascending.
- Plan explorer: from/to pickers, credit ($), k (1–5), objective, "no owned" / "no Warbond" toggles, max steps 25; shows routes with the same step rendering as Task 5 and the "No route: RSI currently offers no upgrade to X, and you own no CCU into it." message from `scripts/plan.mjs`.

- [ ] **Step 1: Failing test**: `searchShips` for `"gal"` returns "Galaxy" first; `"c1"` finds "C1 Spirit"; empty query returns `[]`.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS; browser pane: add "Pulse → Hull A", it appears in the list as a watch chain with a proposal; plan explorer Pulse → Galaxy k 3 shows 3 routes.
- [ ] **Step 5: Commit** "Add chain creation and plan explorer".

### Task 8: Hangar, Melt and Prices tabs

**Files:**
- Create: `app/src/lib/HangarTab.svelte`, `app/src/lib/MeltTab.svelte`, `app/src/lib/PricesTab.svelte`, `app/src/lib/view/hangar.mjs`, `test/view/hangar.test.mjs`

**Interfaces:**
- Consumes: `classifyCopies`, `meltPlan`, `KEEP` (melt), `reservations` (chains), overrides and `expectedOffers` (prices), `dispatch` for `setPrice`/`clearPrice`/`setCredit`.
- Produces: `hangarRows(data, plans) -> [{ copyId, from, to, fromName, toName, paid, giftable, meltable, reservedBy|null, matchMethod, extras }]` plus `review` passthrough.
- Hangar: table with filters (all / reserved / free / giftable / needs review), buy-back list below. Melt: candidates table with the keep reason for every non-candidate, the melt plan (finish chains + locks, new money before/after, credit left), credit pool input, ECharts bar chart of candidates by value. Prices: expected prices list with add (ship picker + $ + note) and clear, the number of affected Standard offers, and the concept ship list (name, msrp, on sale or not).

- [ ] **Step 1: Failing test**: `hangarRows` marks a copy reserved by `c1`, falls back to `#99` for an unknown ship, and returns review items unchanged.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS; browser pane: Melt shows 11 candidates / $115 on the scratch copy with the Prospector $175 override; clearing the override in Prices makes Melt show 16 candidates; set it back.
- [ ] **Step 5: Commit** "Add hangar, melt and prices tabs".

### Task 8a: Full hangar (CCUs, standalone ships with details, other items)

Added 2026-11-18 at the user's request: "hangar should show CCUs, standalone ships with details, other objects etc in the hangar". Task 8's Hangar tab only lists CCU copies. The synced `hangar.json` has every pledge (350 in the real data). For each pledge it has `pledgeId`, `name`, `value`, `configurationValue`, `currency`, `created`, `contains`, `canGift`, `canReclaim`, `notBuybackable`, `upgrade` (non-null for CCUs) and `items[{ title, kind, liner }]`. Item kinds seen: Ship, Insurance, Skin, FPS Equipment, Component, Hangar decoration, Credits, and null (game packages, hangars, other).

**Files:**
- Create: `src/logic/hangar.mjs` (pure), `app/src/lib/PledgeDetail.svelte`, `test/hangar-pledges.test.mjs`
- Modify: `src/logic/mapping.mjs` (`buildPlannerData` also returns `pledges`), `src/parse.mjs` (best-effort pledge and item image URL), `app/src/lib/HangarTab.svelte`, `app/src/lib/view/hangar.mjs`

**Interfaces:**
- `classifyPledge(pledge) -> 'ccu' | 'ship' | 'package' | 'paint' | 'equipment' | 'other'`:
  - `ccu`: `upgrade` is non-null.
  - `package`: has a Ship item and an item whose title matches `/Star Citizen Digital Download|Squadron 42|Game Package/i`.
  - `ship`: any other pledge with a Ship item.
  - `paint`: only Skin items.
  - `equipment`: only FPS Equipment or Component items.
  - `other`: everything else.
- `pledgeView(pledge, ships) -> { pledgeId, name, category, value, created, giftable, reclaimable, buybackable, ships: [{ title, shipId|null, manufacturer }], insurance: string|null, items: [{ title, kind, liner }], image|null, upgraded: boolean }`:
  - `shipId` comes from `findShip` with aliases. It is `null` when the match is not unique; never guess.
  - `insurance` is the Insurance item title, e.g. "120 Month Insurance" or "Lifetime Insurance".
  - `upgraded` is true when the pledge name names a different ship than the one it contains, i.e. a CCU was applied.
- `buildPlannerData(raw).pledges` = `pledgeView` of every non-gone hangar entry.
- `hangarSummary(pledges) -> { count, byCategory, totalValue, giftable, ships }`.
- Hangar tab layout, top to bottom:
  - Summary strip: pledge count, total value, ships, and counts per category.
  - Category chips: All, Ships and packages, CCUs, Paints, Equipment, Other.
  - Search box.
  - List. Ship and package rows show the ship picture (Task 8c, `ShipThumb` by `shipId`), name, manufacturer, insurance badge, value, created, giftable/reclaimable badges and "Upgraded" if applied. CCU rows keep Task 8's table (reserved, free, needs review). Other rows show item title, kind and value.
  - Clicking a row opens `PledgeDetail`: every item with kind and liner, value and configuration value, created, flags, and the pledge image when present.
  - Buy-back list stays below.
- Parser: `parseHangarPage` also records the pledge thumbnail and each item's image URL, if the page has one (`image` / `items[].image`, else null). This only takes effect after the next hangar sync, which needs the user's session. Pin it with a synthetic HTML test and verify on that sync.

- [ ] **Step 1: Failing tests** in `test/hangar-pledges.test.mjs`, all on synthetic pledges:
  - The Avenger Titan pledge with digital download, insurance, paint and hangar is `package`, with `insurance` "120 Month Insurance" and `ships[0].title` "Avenger Titan".
  - A pledge with `upgrade` set is `ccu`.
  - A Skin-only pledge is `paint`.
  - A pledge with Ship "A1 Spirit" whose name says "Khartu-Al" has `upgraded: true`.
  - An unknown ship title has `shipId: null`.
  - `hangarSummary` counts categories and totals values in cents.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS. CLI output unchanged. In the browser pane, on the scratch copy:
  - Ships and packages, CCUs, Paints, Equipment and Other are all populated.
  - The Avenger Titan pledge detail lists its 6 items.
- [ ] **Step 5: Commit** "Show the whole hangar: ships, packages, CCUs, paints and equipment".

### Task 8b: RSI links (buy in the normal browser, hangar, buy-back)

Added 2026-11-18 at the user's request: CCUs to buy get a link that opens the RSI upgrade tool in the user's normal browser so they can put it into the cart themselves; owned CCUs and hangar/melt lists get a link to the RSI hangar page. The app itself still never adds to cart, buys or calls any RSI write endpoint (spec non-goal); it only opens a page in the system browser, where the user is signed in.

**Files:**
- Create: `src/logic/links.mjs`, `app/src/lib/RsiLink.svelte`, `test/links.test.mjs`
- Modify: `app/src-tauri/Cargo.toml`, `app/src-tauri/src/lib.rs`, `app/src-tauri/capabilities/*.json`, `app/package.json`, `app/src/lib/backend.js`, `app/src/lib/Steps.svelte`, the would-help panel (Task 6), `HangarTab.svelte`, `MeltTab.svelte`

**Interfaces:**
- Produces (all URLs absolute, `https://robertsspaceindustries.com`, one module so a changed RSI URL is fixed in one place):
  - `upgradeToolUrl({ from, to }) -> string`: base `/en/pledge/ship-upgrade-ccu` (verified 200 on 2026-11-18; the old `/pledge/ship-upgrades` is 404). `from`/`to` are RSI ship ids. Preselection parameters are NOT verified yet: return the bare tool URL unless `LINKS.upgradePreselect` (a constant in the module, default `null`) names the verified query format, e.g. `{ from: 'from', to: 'to' }`.
  - `hangarUrl({ type = 'upgrade', search } = {}) -> string`: `/en/account/pledges?product-type=upgrade` (200 on 2026-11-18); `search` only when `LINKS.hangarSearch` names a verified parameter, default `null`.
  - `buybackUrl(buybackPledgeId) -> string`: `/en/pledge/buyback/<id>` (the parsed `buyBackLink` shape); `/en/account/buy-back-pledges` when the id is null.
  - `isRsiUrl(url) -> boolean`: true only for `https://robertsspaceindustries.com/` URLs.
- `backend.openExternal(url)`: refuses unless `isRsiUrl(url)`; Tauri → `@tauri-apps/plugin-opener` `openUrl`; dev → `window.open(url, '_blank', 'noopener')`.
- Rust: `tauri-plugin-opener` registered; capability `opener:allow-open-url` scoped to `https://robertsspaceindustries.com/*` only.
- `RsiLink.svelte` (`href`, label, `title`): a small "↗" link button calling `openExternal`; title explains "Opens RSI in your browser. Add it to the cart there."
- Placement: Steps "Buy now" / "Lock now" / "Later" rows → "Buy on RSI ↗" (upgrade tool, from/to of the step, the step's price and Standard/Warbond kind visible beside it so the user picks the right one in the tool); Steps "Owned" rows, Hangar rows, Melt candidates → "Hangar ↗"; buy-back rows → "Buy back ↗"; would-help items → "Watch on RSI ↗" (upgrade tool).

- [ ] **Step 1: Failing tests** `test/links.test.mjs`: `upgradeToolUrl({from:1,to:2})` is `https://robertsspaceindustries.com/en/pledge/ship-upgrade-ccu` with the default `LINKS`; with `upgradePreselect = { from: 'from', to: 'to' }` it carries `from=1&to=2`; `hangarUrl()` ends in `/en/account/pledges?product-type=upgrade`; `buybackUrl(61965779)` ends in `/en/pledge/buyback/61965779`; `buybackUrl(null)` is the list page; `isRsiUrl` rejects `http://robertsspaceindustries.com/`, `https://robertsspaceindustries.com.evil.test/` and `javascript:` URLs.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS; `cargo check` in `app/src-tauri`; browser pane: the buttons render in the steps and hangar lists; clicking one in dev opens a new tab on the RSI URL (no request from the app itself).
- [ ] **Step 5: Commit** "Add RSI links to buy steps, hangar and buy-back".

### Task 8c: Ship pictures everywhere

Added 2026-11-18 at the user's request ("integrate pictures everywhere from the stuff like ships"). The synced data has no image fields (`initShipUpgrade` does not ask for media). Each catalog ship has a public store page (`ship.link`, e.g. `/pledge/ships/rsi-aurora/Aurora-Mk-I-ES`) whose `<meta property="og:image">` is a public image URL under `https://robertsspaceindustries.com/i/…` (verified 2026-11-18 without login). Images are loaded from that URL in this phase; local caching and downscaling move to the phase-3 Rust client.

**Files:**
- Create: `scripts/sync-images.mjs` (or an `images` command in `scripts/sync.mjs`), `src/logic/images.mjs`, `app/src/lib/ShipThumb.svelte`, `test/images.test.mjs`
- Modify: `src/data.mjs` (`readRaw` reads optional `ship-images.json`), `src/logic/mapping.mjs` (`buildPlannerData` sets `ship.image`), `app/src-tauri/src/store.rs` (`load_data` returns `images`; `ship-images.json` in `LEGACY_FILES`), `app/vite-dev-data.js` (same), `app/src-tauri/tauri.conf.json` (`img-src 'self' data: https://robertsspaceindustries.com` in `csp` and `devCsp`), components listed below.

**Interfaces:**
- `parseOgImage(html) -> string|null` in `src/logic/images.mjs`: the `og:image` content; only `https://robertsspaceindustries.com/` URLs, else null.
- Sync (CLI, the only new RSI traffic): unauthenticated GET of `https://robertsspaceindustries.com/en` + `ship.link` for catalog ships with no entry yet in `ship-images.json` (`{ fetchedAt, images: { [shipId]: { url, page, fetchedAt } } }`), 1 s spacing, 429 back-off, `--refresh` re-reads all, `--limit N`. Same-host GET only, no cookies sent, no other method. A failed page records `{ url: null, error }` and is retried on the next run.
- `buildPlannerData(raw)` → `ships.get(id).image` = url or null.
- `ShipThumb.svelte` props `ship` (or `id` + `ships`), `size` ('xs' 32×16, 's' 64×32, 'm' 160×80, 'hero' full width 2:1): `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt={name}>` with `object-fit: cover`; when `image` is null or the load fails, a placeholder tile with the manufacturer's initials on the panel colour.
- Placement: chain list (target, 's'), workspace header (target, 'hero' banner, dimmed under the title), staircase tooltip (point ship, 's'), step rows (from → to, 'xs' each), proposals (target of each changed step, 'xs'), would-help group headings ('s'), ship picker options ('xs'), plan explorer routes ('xs'), hangar and melt rows ('xs' from/to), prices expected/concept lists ('s'), fleet plan rows ('xs'). Task 9's graph shows the image of the hovered node in its tooltip.

- [ ] **Step 1: Failing tests** `test/images.test.mjs`: `parseOgImage` returns the URL from a synthetic page with `<meta property="og:image" content="https://robertsspaceindustries.com/i/abc/source.jpg" />`, null without the tag, null for `https://evil.test/x.jpg`; `buildPlannerData` with `images: { images: { 1: { url } } }` sets `ships.get(1).image` and leaves others `null`; without the file all ships have `image: null`.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS; `cargo test` in `app/src-tauri`; controller runs the image sync once against `.local/data` and the scratch copy (≈250 public GETs at 1 s); browser pane: chain list, workspace banner, steps, picker show pictures; a ship without an image shows the initials tile.
- [ ] **Step 5: Commit** "Show ship pictures across the app".

### Task 8e: Optimised local ship pictures

The user asked on 2026-11-18 for the pictures to be optimised. Today every thumbnail loads RSI's 2048×1024 `og:image` JPEG, even at 32 px. This task moves the image caching planned for phase 3 forward: each picture is downloaded once and downscaled into small local WebP files. The app reads those files from the data dir, so pictures also work offline.

**Files:**
- Modify: `src/image-sync.mjs`, `scripts/sync-images.mjs`, `package.json` (`sharp`), `src/logic/images.mjs`, `src/logic/mapping.mjs`, `app/src-tauri/tauri.conf.json` (asset protocol), `app/src-tauri/src/store.rs`, `app/src-tauri/src/lib.rs`, `app/vite-dev-data.js`, `app/src/lib/backend.js`, `app/src/lib/ShipThumb.svelte`
- Test: `test/image-sync.test.mjs`, `test/images.test.mjs`, `test/view/dev-store.test.mjs`, cargo tests

**Interfaces:**
- Sync: once the URL is known, fetch the image itself. Use the same safety rules: same host, no cookies, 15 s timeout, 1 s spacing, 429 stop, and a 20 MB size cap. Check that `content-type` starts with `image/`. Then write `images/<shipId>-s.webp` (320×160, quality 70) and `images/<shipId>-l.webp` (1280×640, quality 75) under the data dir with `sharp`, using `fit: cover` and atomic writes. Record `thumbs: { s, l, sourceUrl, bytes }` in `ship-images.json`. Skip any ship whose `thumbs.sourceUrl` equals the current URL and whose files exist. `--refresh` re-downloads. Ships whose files are missing are filled in on the next run, without extra page fetches.
- `buildPlannerData` → `ship.image = { s, l } | null`, where `s` and `l` are file names relative to `images/`, and `ship.imageUrl` is the remote URL (kept for the record, never loaded by the app).
- `backend.imageSrc(file) -> string`:
  - In Tauri, `convertFileSrc(<dataDir>/images/<file>)`, with the asset protocol enabled and its scope limited to `$APPDATA/images/**` (the data dir's images folder only).
  - In dev, `/__dev/images/<file>`, served by the dev plugin. It only serves names matching `^\d+-(s|l)\.webp$`, with nothing that could break out of the folder.
- CSP: `img-src 'self' data: asset: http://asset.localhost` in `csp`, plus the dev server origin in `devCsp`. Remove `https://robertsspaceindustries.com` from `img-src`; the app no longer loads remote images.
- `ShipThumb`: uses `s` for `xs`/`s`/`m` and `l` for `hero`; otherwise the initials tile, as before.
- Import (`import_legacy` and the dev mirror) also copies `images/*.webp` (regular files whose names match the pattern), and skips existing files.

- [ ] **Step 1: Failing tests:**
  - The sync with an injected fetch writes both WebP files through an injected `resize`, so tests don't need `sharp`, and records `thumbs`.
  - An unchanged source URL is not re-downloaded.
  - A non-image `content-type`, an off-host URL or an oversized body is rejected without writing files.
  - The dev endpoint refuses `../x` and `1-s.png`.
  - Mapping sets `image: { s, l }` only when both are recorded.
  - Import copies the matching images.
- [ ] **Step 2–4:** run the tests to see them FAIL, implement, then run them to see them PASS. Run `cargo test`. The controller then runs the sync once on `.local/data` and copies `images/` and `ship-images.json` into the scratch copy. In the browser pane, check that the network panel shows only local `.webp` requests, no `robertsspaceindustries.com` image requests, and thumbs at most about 15 KB each.
- [ ] **Step 5: Commit** "Store ship pictures as small local WebP files".

### Task 8f: Availability beyond sale events (melt and "buy later")

**Why.** On 2026-11-18 the user corrected the melt rule. It treated a CCU as a melt candidate when it was "rebuyable at the same Standard price today", and that is wrong during a sale event. Today is during IAE 2956, and many upgrades are buyable only because of the event. The same assumption also sits behind watch-mode "Standard … later" steps.

**What the data can and cannot show.**
- Stock flags don't help: all 147 on-sale ships carry an unlimited-stock Standard SKU.
- `offer-history.jsonl` only records changes between syncs, and no sync has run outside IAE yet.
- So availability must be learned over time, with the user's own knowledge as an override.

**Files:**
- Create: `src/logic/availability.mjs` (pure), `test/availability.test.mjs`
- Modify:
  - `scripts/sync.mjs`: the catalog sync appends `sale-history.json`.
  - `src/data.mjs`, `src/logic/mapping.mjs`: `readRaw` and `buildPlannerData` carry `saleHistory`, `saleEvents` and availability overrides.
  - `app/src-tauri/src/store.rs` and `app/vite-dev-data.js`: both handle the same new files (load and import parity), plus the `save_doc` name `sale-events` with rev check.
  - `src/logic/state.mjs`: actions `setSaleEvent`, `removeSaleEvent`, `setAvailability`, `clearAvailability`.
  - `src/logic/melt.mjs`, `src/logic/chains.mjs`, `src/logic/describe.mjs`, `scripts/chain.mjs`
  - `app/src/lib/PricesTab.svelte`, `app/src/lib/MeltTab.svelte`, `app/src/lib/Steps.svelte`, and the today banner

**Interfaces:**
- **`sale-history.json`.** Shape: `{ ships: { [shipId]: { onSaleDays: ['YYYY-MM-DD', …] } } }`.
  - The catalog sync adds today's date for every ship that has a Standard SKU.
  - Keep at most 365 distinct days per ship.
  - Write it atomically.
- **`sale-events.json`.** Shape: `{ rev, events: [{ id, name, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }] }`.
  - The user maintains it in the Prices tab ("Sale events").
  - The app offers a prefilled suggestion of name "IAE 2956" and to "2026-11-27" (the end date RSI's site banner shows), but only adds it when the user confirms.
- **Availability overrides.** In `price-overrides.json`: `ships[id].availability = 'regular' | 'event-only'`, plus an optional note.
- **`availability(shipId, { saleHistory, saleEvents, overrides, today })`** returns `{ status, daysOutside, firstSeen, lastSeen, event|null }`.
  - `status` is one of `'regular' | 'event-only' | 'unknown' | 'off-sale'`.
  - An override wins.
  - `'regular'` means the ship was seen on sale on at least 2 dates outside every sale event, at least 7 days apart.
  - `'event-only'` means it was seen on sale only on event dates, and at least one event has ended since.
  - `'unknown'` means it was seen only during an ongoing event, or the history is too short.
  - `'off-sale'` means it has no Standard SKU now.
  - `event` is the ongoing event that covers today, if any.
- **Melt.** A copy is a candidate only if its target's status is `'regular'`. New keep reasons:
  - `KEEP.EVENT_ONLY`: 'buyable only during sale events (e.g. IAE 2956) as far as we know'
  - `KEEP.UNKNOWN_AVAIL`: 'not known to stay on sale after <event> (seen on sale only during it)'
  - `meltHeadline` drops "rebuyable at the same Standard price today". It says "rebuyable outside sale events (seen on sale on ≥2 days outside events, or marked regular by you)".
- **Buy later.**
  - `lockReason` gets the reason `'event'` when the step's target is not `'regular'` and an event is ongoing.
  - `splitRoute` with that lock moves such a Standard step into Lock now.
  - `expectedChanges` adds the alert reason `'event'` with the text "only known on sale during <event> (ends <to>): buy before it ends or risk losing this upgrade path".
  - This flows into the Steps warnings, the today banner ("N steps only known buyable during IAE 2956, ends Nov 27") and the decision graph (Task 9 `why`).
- **CLI.**
  - `chain melt`, `list` and `prices` show the new reasons.
  - New commands: `chain event add "<name>" <from> <to>`, `chain event rm <id>`, `chain avail <ship> regular|event-only|clear`.
  - This is an intended output change; update the CLI tests.
- **Prices tab.**
  - A "Sale events" section: list, add with the suggested-event button, and remove.
  - An "Availability" column per ship showing its status and days seen outside events, with a regular / event-only / auto selector.
- **Melt tab.** It shows the new reasons, and a hint when an event is ongoing and the history is short ("Melt suggestions stay conservative until a sync has run after IAE 2956 ends").

**Steps:**
- [ ] **Step 1: Failing tests** in `test/availability.test.mjs` and the existing melt/chains tests.
  - **Availability status:**
    - With event 11-14…11-27 and today 11-18, a ship seen only on 11-18 is `unknown` and `event` is that event.
    - A ship seen on 10-01 and 10-20 is `regular`.
    - A ship seen on 10-01 and 10-03 is `unknown` (not 7 days apart).
    - With today 12-05, a ship seen only on 11-15…11-27 is `event-only`.
    - An override of `regular` wins.
  - **Melt:**
    - A copy that met every old rule but whose target is `unknown` now keeps with `UNKNOWN_AVAIL`.
    - The same copy with the target overridden to `regular` is a candidate.
  - **Buy later:**
    - A watch chain's later Standard step into an `unknown` target during the event goes to Lock now with reason `'event'`.
    - The same step outside any event, with the target `regular`, stays Later.
- [ ] **Steps 2–4.**
  - Run → FAIL, implement, run → PASS.
  - `cargo test`.
  - Browser pane on the scratch copy:
    1. Add the suggested IAE 2956 event and check that Melt shows the conservative hint with 0 or few candidates.
    2. Mark Prospector `regular` and check that its CCUs can become candidates again.
    3. Remove both, so the scratch data ends as it started.
- [ ] **Step 5: Commit.** "Treat sale-event availability as unproven for melting and buy-later".

### Task 8d: Warbonds tab: every Warbond on sale now

Added 2026-11-18 at the user's request ("a view which warbonds are currently available in general"). The real data has 877 Warbond offers, and they all lead into 5 target ships, so the view groups them by target. Each Warbond offer has the shape `{ from, to, kind: 'warbond', cash, skuId, title, fetchedAt, limited, firstSeen }`. `offer-history.jsonl` records `appeared` and `disappeared` events, and the CLI `chain warbonds` command already reads it.

**Files:**
- Create: `src/logic/warbonds.mjs` (pure), `app/src/lib/WarbondsTab.svelte`, `test/warbonds-view.test.mjs`
- Modify: `app/src/lib/Shell.svelte` (new "Warbonds" tab between Prices and Graph), `scripts/chain.mjs` (`warbonds` uses the shared "used by" and "appeared" helpers; output unchanged)

**Interfaces:**
- `warbondTargets(offers, ships, { state, graph, history, now }) -> [{ to, name, msrp, concept, sources, cheapest: { from, cash, standard|null, saving|null }, limited, newSince: iso|null, usedBy: [chainId], targetOf: [chainId] }]`:
  - `sources` counts the Warbond offers into `to`.
  - `standard` is the Standard offer for the same from → to, if one exists. `saving = standard - cash`.
  - `newSince` is the latest `appeared` event for a Warbond into `to` within the window.
  - `usedBy` lists the chains whose best route uses a Warbond into `to`, the same way the CLI finds them with `proposeChain` k 1.
  - `targetOf` lists the chains whose target is `to`.
  - Sort: targets of your chains first, then by the cheapest saving descending, then by name.
- `warbondSources(offers, ships, to, { owned }) -> [{ from, fromName, cash, standard|null, saving|null, limited, ownedFrom: boolean }]`, sorted by `cash` ascending. `ownedFrom` is true when you own a pledge or a CCU chain ending in `from`.
- `recentWarbondEvents(history, offers, hours = 24) -> { appeared: [...], disappeared: [...] }`. This is the same filter `chain warbonds` uses.
- The tab shows:
  - A header: total Warbond offers and targets, and "N new in the last 24 h" (with a window selector of 24 h, 7 d or 30 d).
  - One card per target: picture (Task 8c), name, msrp, concept badge, source count, cheapest Warbond with its saving against Standard, limited badge, "New" badge, and "Used by c2" / "Target of c3" badges.
  - When a card is expanded, the source list with from-ship thumbnails, the price, the Standard price, the saving and an "owned" marker.
  - "Buy on RSI ↗" on each source. This uses `upgradeToolUrl` from Task 8b; the app never adds to the cart.
  - A filter box (ship or manufacturer) and toggles for "only my chains" and "only from ships I own".
  - A "Recently appeared / disappeared" list at the bottom.
- No prediction of future Warbonds, and no likelihood data. This is a spec non-goal.

- [ ] **Step 1: Failing tests** in `test/warbonds-view.test.mjs`, using a synthetic catalog and offers:
  - Two Warbonds into ship 10 from 1 and 2, plus a Standard 1 → 10, give one target with `sources: 2`. The cheapest is the lower `cash`, and `saving` is Standard minus Warbond.
  - A chain targeting 10 gives `targetOf: ['c1']` and puts that target first.
  - An `appeared` event 2 h ago marks `newSince`. One 30 h ago does not, at 24 h.
  - `warbondSources` sorts by cash and sets `ownedFrom` for an owned base.
- [ ] **Step 2–4:**
  - Run the tests: they must FAIL.
  - Implement.
  - Run them again: they must PASS.
  - Check that `chain warbonds` output is byte-identical.
  - In the browser pane, check the Warbonds tab on the scratch copy: 5 target cards and 877 offers in total, Galaxy (or whichever target your chain uses) badged, and the expanded sources sorted by price.
- [ ] **Step 5: Commit** "Add Warbonds tab with every Warbond on sale".

### Task 9: Graph view

**Files:**
- Create: `app/src/lib/view/subgraph.mjs`, `test/view/subgraph.test.mjs`, `app/src/lib/GraphTab.svelte`
- Modify: `src/logic/wanted.mjs` (export `dijkstra` and the edge-cost helper; no behaviour change, `test/wanted.test.mjs` stays green)
- Note: the design put the graph view in phase 4; it is pulled into this plan because Denis asked for it.

**Interfaces:**
- Consumes: `graph` from app state, `proposeChain`, `wantedWarbonds`, `reservations`.
- Produces: `subgraph(appState, { chainId|null, kinds: Set<'owned'|'standard'|'warbond'>, minMsrp, maxMsrp, onlyChainEdges: boolean, showWanted: boolean, maxEdges = 600 }) -> { nodes: [{ id, name, msrp, concept, role: 'base'|'target'|'route'|'other' }], edges: [{ from, to, kind, cash, copyId?, reservedBy?, onRoute: boolean, hypothetical: boolean }], hidden: number }`.
  - With a chain: nodes are ships reachable from the base within the chain's best route cost + `$100` and ships that reach the target (Dijkstra as in `wanted.mjs`, export its `dijkstra` helper), plus route ships. Route edges are always kept; remaining edges are ranked owned first, then Warbond, then Standard by price, cut at `maxEdges`; `hidden` counts the rest.
  - `showWanted` adds the chain's top 10 `wanted` pairs as `hypothetical: true` edges.
- Rendering: ECharts `graph` series, `layout: 'none'`, x = msrp scaled to width, y spread by a stable hash of ship id within its price column; edge colours by kind, route edges thick, reserved-by-other edges dashed grey, hypothetical edges dashed purple; tooltip with price, kind, copy/SKU, reserved by; clicking a ship lists its CCUs in and out beside the chart; a line "N edges hidden; narrow the price range or kinds".

- [ ] **Step 1: Failing tests**: on a synthetic graph of 50 ships and 1,000 offer edges with a chain → `edges.length <= 600`, `hidden === total − edges.length`, every edge of the best route present with `onRoute: true`; `kinds = {owned}` returns no offer edges; `showWanted` adds edges with `hypothetical: true`.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS; browser pane on the scratch copy: Galaxy graph renders with the route highlighted, hover shows prices, scrolling/zoom works, render time under 1 s.
- [ ] **Step 5: Commit** "Add graph view of the planner's CCU graph".

#### Task 9 part 2: Decision graph (user request 2026-11-18)

The user asked for a graph that shows how the algorithm decides, not only the network it searches. The Graph tab gets a mode switch, "Network | Decision", and Decision is the default when a chain is selected.

A trace of every label in the search would be unreadable. Instead, the decision graph merges the best route and its alternatives into one directed acyclic graph (DAG) and annotates each choice with the reason it was made.

**Files:**
- Create: `src/logic/decision.mjs` (pure), `test/decision.test.mjs`, `app/src/lib/DecisionGraph.svelte`
- Modify: `app/src/lib/GraphTab.svelte`

**Interfaces:**
- `decisionGraph(appState, chainId, { k = 5 }) -> { nodes, edges, steps, verdict }`. Each part is defined below.
- **Inputs.** It reuses `proposeChain` with `k` and the chain's objective, plus `splitRoute`, `lockReason`, `expectedChanges` and `wantedWarbonds` (the cached result if the panel has one).
- `nodes: [{ id, name, msrp, concept, layer }]` covers every ship on any of the k routes. `layer` is the ship's step index on the best route. Ships that appear only on an alternative are placed by msrp between their neighbours.
- `edges: [{ from, to, kind, cash, routes: [routeIndex], best: boolean, delta }]` merges identical steps across routes. `delta` is the route's total minus the best total, so the best route has 0 and alternatives show "+$10".
- `steps` has one entry per step of the best route:
  - Fields: `{ from, to, chosen: { kind, cash, copyId? }, options: [{ kind, cash, available: boolean, why }], decision }`.
  - `options` lists every way to make the same from → to move that the graph has:
    - an owned copy that is free, or reserved by another chain
    - Warbond SKUs
    - the Standard offer
    - the expected (overridden) price
  - Each option's `why` is "chosen", "reserved by c2", "cheaper by $10", "costs $10 more", "not on sale", "price will rise (expected $X)" or "concept: lock now".
  - `decision` is one sentence. Examples:
    - "Use owned CCU 77587111 (paid $5): free now."
    - "Buy Warbond $40 now: $10 less than Standard; Warbonds can vanish."
    - "Buy Standard $20 later, or lock now: target is a concept ship."
- `verdict` is the route-level summary:
  - Objective, new money and all-in.
  - Why it beats alternative 2, e.g. "same cash, keeps 2 more CCUs free".
  - The would-help thresholds touching this route, e.g. "a Warbond Pulse → M50 below $60 would switch the plan".

**Rendering:**
- The best route runs left to right as the spine, with ships as card nodes carrying a picture (`ShipThumb`, Task 8c) and price.
- Alternatives branch off and rejoin as thinner, faded edges labelled "+$X".
- Edge colours follow the kind colours.
- Clicking a step opens the options table with its `why` column and the `decision` sentence.
- A verdict panel above the graph.
- ECharts `graph` with `layout: 'none'` (positions from `layer`/msrp), or SVG if simpler. Same lifecycle rules as the other charts.

- [ ] **Step 1: Failing tests** in `test/decision.test.mjs`, on a synthetic graph:
  - Two routes that share their first step merge into one edge, with `routes: [0, 1]`.
  - The alternative's distinct edges get `delta` = its total minus the best total.
  - On a step where both an owned copy reserved by another chain and a Standard offer exist, the owned option is `available: false` with why "reserved by c2", and the chosen option is the Standard one.
  - A Warbond cheaper than Standard on the same move gives the Standard option why "costs $10 more".
  - A concept target with lock auto gives the last step a decision that mentions lock.
  - A no-route chain returns `verdict` with the `noRouteMessage` wording and empty nodes.
- [ ] **Step 2–4:**
  - Run the tests and expect FAIL.
  - Implement.
  - Run the tests and expect PASS.
  - In the browser pane, check the Galaxy decision graph: the spine is Pulse → … → Galaxy, alternatives branch with "+$" labels, and clicking "Pulse → 325a" shows options with reasons. Odyssey shows the no-route verdict.
- [ ] **Step 5: Commit** "Add decision graph explaining each route choice".

### Task 10: First-run import in the app, end-to-end check, docs

**Files:**
- Modify: `README.md` (new "Desktop app" section: dev run, build, data dir, import, CLI `--data`), `app/src/lib/ImportScreen.svelte` (Tauri path)

- [ ] **Step 1:** `cd app && npm run tauri dev` with an empty app data dir → import screen; import from `~/Documents/GitHub/ccu-planner/.local/data` → app shows the 4 chains. Check: `ls "~/Library/Application Support/com.ccuplanner.desktop/data"` lists only the allowlisted files.
- [ ] **Step 2:** In the app: change c4 priority to high; then in a terminal `node scripts/chain.mjs --data "<app data dir>" credit 0`; then change c4 back in the app → notice "Changed outside the app; reloaded. Do it again." appears and nothing is lost.
- [ ] **Step 3:** `npm run tauri build -- --debug` produces `CCU Planner.app`; open it, repeat a quick look at workspace, melt and graph.
- [ ] **Step 4:** Run the full checks: `node --test test/ test/view/` and `cd app/src-tauri && cargo test` → all PASS.
- [ ] **Step 5: Commit** "Document the desktop app and verify first-run import".

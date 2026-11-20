# LTI-token goals, shared planning and CCU Game import: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A goal becomes a target ship that starts from any cheap owned LTI pledge (a "token") or, as the exception, from a fixed ship. All goals are planned together by default, and CCU Game's Saved Chains download imports as goals.

**Architecture:**
- **Token list:** a pure module `src/logic/tokens.mjs` turns hangar pledges into a token list.
- **Search:** the route search takes several start points ("starts"), each optionally carrying a token copy. Tokens are reserved with the same copy-id machinery as owned CCUs (`excludeCopies`, `reservations`, accepted routes).
- **Shared planning:** `planGoals` plans accepted goals first, then the rest by priority. `proposeChain` / `proposeFleet` read their claims from it, so every view shows the shared result without caller changes.
- **Import:** a pure parser module handles the CCU Game file.

**Tech Stack:** Node ESM + `node --test`, Svelte 5 runes, Vite 8, Tauri 2 (Rust store unchanged).

**Spec:** `docs/superpowers/specs/2026-11-18-ccu-goal-tokens-design.md`

## Global Constraints

- **Token default:** the pool holds owned standalone ship pledges with Lifetime Insurance, for a ship whose catalog MSRP is at most **$80** (`limitCents: 8000`). Packages never count. A pledge whose ship isn't in the catalog never counts, even if marked "use".
- **Overrides:**
  - per pledge: `use` (include regardless of the limit) or `never` (exclude);
  - per goal: a specific token, or a fixed start ship.
- **Planning rules:**
  - One token per goal and one CCU copy per goal.
  - Accepted routes keep their CCUs, credit and token.
  - Goals are planned in priority order (`PRIORITY`, then `createdAt`, then `id`).
  - When routes cost the same, the cheaper token wins.
- **App constraints:**
  - No RSI requests from the app.
  - Links open only `https://robertsspaceindustries.com/` pages.
  - The CSP stays strict. The import file is read in the webview with `<input type="file">` and `File.text()`; there is no new Tauri permission.
- **Stores:** the Rust store treats `plans.json` as opaque JSON. No new data files. The dev store needs no change. Saves stay rev-checked.
- **Wording:**
  - Shared wording goes in `src/logic/describe.mjs`.
  - The CLI wording stays unchanged, except for the new start line and the `--start` option.
  - The app says "goal", never "chain".
- **Colours:** green, grey and purple only for buy now / own / wait. The neutral accent is `--accent`.
- **Commits:** a subject plus a body listing the changes and what was verified. No AI attribution lines.
- **Testing:** `node --test` must stay green (307 at base). Each new pure function gets tests.

## Review Focus

1. **A goal's accepted token was melted, gifted or sold** (its pledge is no longer in the hangar). `evaluateAccepted` reports `status: 'blocked'` with an issue `{ kind: 'token-gone', pledgeId }`; it must not crash. Test in Task 4.
2. **Empty or missing `hangar.json`.** The token list is `[]`, every token goal shows "No free LTI token", and the app renders. Tests in Task 1 (`ltiShips({entries:{}})` → `[]`) and Task 4 (a token goal with an empty pool → no route, `noToken: true`).
3. **An LTI pledge marked "use" whose ship isn't in the catalog** (F8C Lightning, Odin) never becomes a token. Test in Task 1.
4. **Importing the same file twice.** The second run shows every row as `exists`. Rows duplicated inside one file count once. Test in Task 7.
5. **A file that isn't CCU Game JSON** (random JSON, plain text). The import throws `Error('This is not a CCU Game saved-chains file')` and nothing is saved. Test in Task 7.

---

### Task 1: Token list from the hangar

**Files:**
- Create: `src/logic/tokens.mjs`
- Modify:
  - `src/logic/mapping.mjs` (`buildPlannerData` adds `lti`);
  - `src/logic/planner.mjs` (`buildGraph` sets `graph.lti = data.lti ?? []` — `buildGraph` currently takes `{offers, owned}`; keep that and accept `lti` too);
  - `src/logic/hangar.mjs` (export `aliasShipId`).
- Test: `test/tokens.test.mjs`

**Interfaces:**
- Produces:
  - `DEFAULT_TOKENS = { limitCents: 8000, use: [], never: [] }`
  - `tokenCopyId(pledgeId: string) => 'token:' + pledgeId`
  - `ltiShips(hangarRaw, ships: Map, aliases) => Array<{ pledgeId: string, ship: number, name: string, paidCents: number|null, msrpCents: number|null }>`
    - Uses `classifyPledge === 'ship'`, exactly one Ship item resolved by `aliasShipId ?? findShipExact`, and an Insurance item matching `/lifetime/i`.
    - `hangarRaw.entries` values are `{ data: pledge, … }`.
    - `paidCents` comes from `pledge.value` when USD, `msrpCents` from `ships.get(ship).msrp`.
  - `tokenSettings(plans) => { ...DEFAULT_TOKENS, ...plans.profile?.tokens }`
  - `tokenPool(lti, settings) => same entries`
    - Includes `use`, excludes `never`; otherwise keeps entries with `msrpCents != null && msrpCents <= limitCents`.
    - Sorted by `paidCents` ascending (null last), then `pledgeId`.
  - `data.lti` (from `buildPlannerData`) and `graph.lti`.

- [ ] **Step 1: Write the failing tests** in `test/tokens.test.mjs`, using small inline hangar fixtures built in the test:
  - `ltiShips` keeps an LTI Pulse ship pledge (`msrpCents 3000`) and drops:
    - a 120-month-insurance pledge;
    - a package;
    - a pledge with two ships;
    - a ship not in the catalog.
  - `ltiShips({ entries: {} }, ships)` → `[]`, and `ltiShips(undefined, ships)` → `[]`.
  - `tokenPool` with the defaults keeps Pulse (3000) and Ursa Medivac (6000) and drops Polaris (97500).
  - With `use: [polarisPledgeId]`, Polaris is kept. With `never: [pulsePledgeId]`, Pulse is dropped.
  - `use` on a pledge whose ship isn't in the catalog has no effect (Review Focus 3).
  - The order is by `paidCents`.
  - `tokenSettings({ profile: {} })` deep-equals `DEFAULT_TOKENS`.
- [ ] **Step 2:** `node --test test/tokens.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement `tokens.mjs`, the `mapping.mjs` field and the `buildGraph` property.
- [ ] **Step 4:** `node --test` → all pass.
- [ ] **Step 5:** Commit: "Derive LTI token pledges from the hangar".

### Task 2: Goal start model, migration, actions and CLI `--start`

**Files:**
- Modify:
  - `src/logic/chains.mjs` (`addChain`, `startOf`, `migrateGoals`);
  - `src/logic/state.mjs` (actions);
  - `app/src/lib/view/derive.mjs` (migrate on derive);
  - `scripts/chain.mjs` (`add --start`, migrate after load, start line in `list`).
- Test: `test/chains.test.mjs`, `test/state.test.mjs`, `test/view/controller.test.mjs` if it builds docs.

**Interfaces:**
- Consumes: `tokenPool`, `tokenSettings`, `tokenCopyId` (Task 1).
- Produces:
  - `chain.start: { kind: 'token' } | { kind: 'token', pledgeId: string } | { kind: 'ship', ship: number }`. New goals have no `base` field.
  - `startOf(chain) => chain.start ?? { kind: 'ship', ship: chain.base }`
  - `addChain(state, { name, start, target, priority, mode })`. `name` defaults to the target ship's name, filled in by the `state.mjs` action.
  - `migrateGoals(plans, lti) => { plans, changed: boolean }`
    - Pure: it returns a new doc and does not mutate.
    - For each chain without `start`, it sets `start = { kind: 'token' }` when `base` is a ship type in `tokenPool(lti, tokenSettings(plans))`, else `{ kind: 'ship', ship: base }`, and deletes `base`.
    - For a migrated token goal with `accepted` and no `accepted.token`, it sets `accepted.token = { copyId, pledgeId, ship }`. The pledge is the cheapest pool pledge of that ship type that isn't already some other chain's `accepted.token`. If there is none, `accepted.token` stays `null`.
  - **State actions:**
    - `addChain { start, target, name?, priority?, mode? }`: validation errors are `'addChain needs a start and a target ship'` and, for a ship start, `'start and target must differ'`.
    - `setStart { chainId, start }`: also releases the accepted route, with the same effect as `release`.
    - `setTokenSettings { tokens: { limitCents?, use?, never? } }`: merges into `plans.profile.tokens`.
    - `markToken { pledgeId, mark: 'use'|'never'|null }`: removes the pledge from both lists, then adds it to the chosen one.
  - **Migration call sites:**
    - `deriveAppState` / `withDocs` apply `migrateGoals(plans, data.lti).plans` before returning, so the next save persists the migrated doc.
    - `scripts/chain.mjs` applies it right after `loadPlans`.
  - **CLI:**
    - `chain add --to X [--start token|<ship>]`: the default is `token`; `--from` remains as an alias for `--start <ship>`.
    - `chain list` prints `start: any LTI token` or `start: <ship> (fixed)` under each goal.

- [ ] **Step 1: Write the failing tests:**
  - `migrateGoals` turns `{base: 271 (Pulse), target: 244}` into `start: {kind:'token'}`, with `base` absent, when the pool has a Pulse.
  - `{base: 62 (Carrack)}` becomes `{kind:'ship', ship: 62}`.
  - An accepted Pulse goal gets `accepted.token.pledgeId` set to the cheaper Pulse pledge.
  - Two accepted Pulse goals get different pledges.
  - The `changed` flag is false on an already-migrated doc.
  - The input object is unchanged (deep-equal to a copy taken before the call).
  - The `addChain` action with `start: {kind:'token'}` and no name names the goal after the target.
  - `setStart` clears `accepted`.
  - `markToken` moves a pledge between `use` and `never` and clears it with `null`.
  - `setTokenSettings({limitCents: 5000})` keeps the existing `use` list.
- [ ] **Step 2:** Run the targeted test files → FAIL.
- [ ] **Step 3:** Implement. Keep every existing action's behaviour; existing tests that build chains with `base` keep working through `startOf`.
- [ ] **Step 4:** `node --test` → all pass. Run `node scripts/chain.mjs --data <scratch copy> list` once and check the start lines.
- [ ] **Step 5:** Commit: "Model goal starts as LTI token or fixed ship".

### Task 3: Multi-start route search

**Files:**
- Modify: `src/logic/planner.mjs` (`searchRoutes`, `compareLabels`, `toRoute`, `planRoutes` passthrough)
- Test: `test/planner.test.mjs`

**Interfaces:**
- **`searchRoutes(graph, opts)`:**
  - New option `starts?: Array<{ ship: number, token?: { copyId: string, pledgeId: string, paidCents: number|null } }>`.
  - When `starts` is given, `base` is ignored. Each start seeds one label, and a start whose `ship === target` is skipped.
- **Labels:** each label carries `tokenCents` (the start token's `paidCents ?? 0`) and `start`.
- **`compareLabels`:** add `|| a.tokenCents - b.tokenCents` directly after the "less credit spent" line. Dominance also requires `x.tokenCents <= y.tokenCents`.
- **Routes:** every route gains `start: { ship: number, token: { copyId, pledgeId } | null }`. With `base`, it is `{ ship: base, token: null }`.
- **Basis:** in the `allin` objective, the token's `paidCents` counts towards `basis`, the same as a consumed copy.

- [ ] **Step 1: Write the failing tests** on a hand-built graph:
  - With starts Pulse(token paid 2500) and Rambler(token paid 4500) and identical cash to the target, the route starts from Pulse, and `route.start.token.pledgeId` is the Pulse pledge.
  - When the Rambler route costs $5 less cash, it wins.
  - `base` alone gives `route.start = { ship: base, token: null }`, and existing tests are unchanged.
  - A start with `ship === target` yields no zero-step route.
  - `starts: []` → `[]`.
- [ ] **Step 2:** `node --test test/planner.test.mjs` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test` → all pass.
- [ ] **Step 5:** Commit: "Search routes from several start ships with token tie-break".

### Task 4: Shared planning by default

**Files:**
- Modify: `src/logic/chains.mjs`:
  - `goalStarts`, `planGoals`;
  - `proposeChain`, `proposeFleet`;
  - `reservations`, `acceptRoute`, `evaluateAccepted`;
  - `startShip`.
- Test: `test/chains.test.mjs`, plus existing fleet tests updated where results change.

**Interfaces:**
- **`goalStarts(state, chain, graph, exclude: Set<string>) => starts[]`:**
  - A fixed start gives `[{ ship }]`.
  - A token start with `pledgeId` gives that pool entry if its copy id isn't excluded, else `[]`.
  - An "any" token start gives one entry per ship type in `tokenPool(graph.lti ?? [], tokenSettings(state))`: the first pledge in pool order whose copy id isn't excluded.
- **`planGoals(state, graph, { maxSteps = 25 } = {}) => Map<chainId, { exclude: Set<string>, credit: number, route: Route|null, noToken: boolean }>`:**
  - Goals with `accepted` come first, in priority order. Each claims its accepted steps' `copyId`s, `accepted.token?.copyId` and `accepted.creditUsed`.
  - Then the other goals in `PRIORITY` / `createdAt` / `id` order. Each searches its best route (`maxResults: 1`) with the copies claimed so far excluded and the credit left, then claims that route's copies, token and credit.
  - For each goal, `exclude` and `credit` record what was claimed by everyone except itself and the goals planned after it. An accepted goal sees only the other accepted goals' claims.
  - `noToken` is true for a token goal when `goalStarts` returned `[]`.
  - The result is memoised in a `WeakMap<graph, Map<signature, result>>` with at most 4 entries. The signature is a JSON string of each chain's `{id, start, target, priority, createdAt, mode, objective, accepted}` plus `profile.credit` and `profile.tokens`.
- **`proposeChain(state, chainId, graph, { k, maxSteps })`:**
  - The signature is unchanged. It now uses `planGoals(...).get(chainId)` for `excludeCopies` and `credit`, and `goalStarts` for `starts`.
  - It returns `{ routes, credit, potential, noToken }`.
  - The `potential` logic stays and still considers accepted reservations only.
- **`proposeFleet(state, graph)`:** the same return shape as today, built from `planGoals`. Accepted goals report their accepted route as `route`.
- **`reservations(state, except)`** also maps `accepted.token.copyId → chainId`.
- **`acceptRoute`:**
  - Stores `accepted.token = route.start?.token ? { ...route.start.token, ship: route.start.ship } : null`.
  - Throws `ConflictError('token already used by <chainId>')` when that token is reserved by another goal.
- **`evaluateAccepted(state, chainId, { offers, owned, lti })`:** when `accepted.token` is set and its pledge isn't in `lti`, it adds the issue `{ kind: 'token-gone', pledgeId }` and returns `status: 'blocked'`. Callers pass `app.data.lti` / `data.lti`.
- **`startShip(chain, route) => route?.start?.ship ?? (startOf(chain).kind === 'ship' ? startOf(chain).ship : null)`**

- [ ] **Step 1: Write the failing tests:**
  - Three Pulse tokens and four token goals to Pulse-reachable targets: three goals get routes with three distinct `start.token.pledgeId`s, and the lowest-priority goal gets `noToken: true` and no route.
  - An accepted goal keeps its token: a higher-priority unaccepted goal can't take it.
  - Two goals needing the same single owned CCU copy: only the higher-priority goal uses it, and the other routes around it or pays.
  - `proposeFleet` total equals the sum of the shared routes' cash.
  - `acceptRoute` with a token reserved elsewhere throws `ConflictError`.
  - `evaluateAccepted` with the token pledge missing from `lti` → `blocked`, with a `token-gone` issue (Review Focus 1).
  - An empty pool → `noToken: true`, no throw (Review Focus 2).
  - A fixed-start goal behaves as before.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Update the existing proposeFleet/proposeChain tests only where shared planning legitimately changes the expected route. Name each changed expectation in the commit body.
- [ ] **Step 4:** `node --test` → all pass.
- [ ] **Step 5:** Commit: "Plan all goals together with one token and copy per goal".

### Task 5: Every consumer uses the planned start ship

**Files:**
- Modify:
  - `src/logic/journey.mjs` (`fullPrice` from `startShip`; `null` when unknown);
  - `src/logic/decision.mjs` (layer 0 = `startShip`);
  - `src/logic/wanted.mjs` (Dijkstra from `startShip(chain, best)`; `[]` when null);
  - `app/src/lib/view/subgraph.mjs` (`chain.base` → `startShip`);
  - `app/src/lib/view/today.mjs` (goal entries gain `startShip`, `token` and `noToken`; a `noToken` goal gets status `'no-token'`);
  - `scripts/chain.mjs` (`show`/`list` print the planned start);
  - every other `chain.base` reader found by `grep -rn "\.base\b" src scripts app/src`.
- Test: the existing tests of those modules, plus new cases.

**Interfaces:**
- Consumes: `startShip`, `proposeChain().noToken` (Task 4).
- Produces:
  - Today goal entries `{ …existing, startShip: number|null, token: {pledgeId, ship}|null, noToken: boolean }`.
  - Status `'no-token'` in `todayView` goals and `goalStatusText`.
  - `NO_TOKEN_TEXT = 'No free LTI token'` in describe.mjs.

- [ ] **Step 1: Write the failing tests:**
  - `journey` for a token route from Pulse to Galaxy has `fullPrice = msrp(Galaxy) - msrp(Pulse)`.
  - `todayView` with a `noToken` goal gives status `'no-token'`, and `goalStatusText` returns `'No free LTI token'`.
  - `wanted` for a token goal uses the route's start.
  - `grep -rn "chain\.base\|\.base\b" src scripts app/src` matches only `startOf` and the migration code (record the grep output in the report).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test` → all pass.
- [ ] **Step 5:** Commit: "Use the planned start ship everywhere a goal's base was read".

### Task 6: App: target-first goals, start controls, token settings, no Fleet dialog

**Files:**
- Modify:
  - `app/src/lib/ui/GoalCard.svelte`, `app/src/lib/GoalsPage.svelte`, `app/src/lib/GoalDetail.svelte`, `app/src/lib/TodayPage.svelte`:
    - the target name is the headline;
    - the start line is small text under it.
  - `app/src/lib/goals/GoalSettings.svelte`: a "Starts from" control with:
    - "Any LTI token" (default);
    - a list of the pool tokens ("Pulse · LTI · paid $25");
    - "A fixed ship…" (ShipPicker).

    It dispatches `setStart`. Warn in the help line that changing it releases the accepted route.
  - `app/src/lib/AddChain.svelte`: pick the target only. The start defaults to any LTI token, with a "fixed start ship" toggle that shows a ShipPicker for the start.
  - `app/src/lib/HangarTab.svelte` / `PledgeDetail.svelte`: an "LTI tokens" panel that shows:
    - the limit (a number input in dollars, dispatching `setTokenSettings`);
    - the pool list.

    For each LTI ship pledge, offer "Use as token" / "Never use as token" / "Default" (`markToken`), plus a "Token" badge on pool pledges.
  - Remove `app/src/lib/FleetPlan.svelte` and the "Share CCUs between goals" button with `SHARE_CCUS_HELP`. The Goals page header shows the total of the shared plan (`proposeFleet(...).totalCash`) as "All goals today: $X".
  - `describe.mjs`: the new texts below.
- Test: `test/describe-age.test.mjs` (new texts), `test/view/today.test.mjs`.

**Interfaces:**
- Consumes: the actions from Task 2, the today fields from Task 5, `tokenPool`/`tokenSettings` (Task 1).
- **Exact copy** (in describe.mjs):
  - `startLineText(start, token, shipName)`:
    - `'from your <Ship> · LTI'` for a token;
    - `'from <Ship> (fixed)'` for a ship;
    - `'needs a free LTI token'` when no token is free.
  - `NO_TOKEN_HELP = 'Every cheap LTI ship you own is already used by another goal. Raise the token limit, mark another ship "Use as token" in the Hangar, or pick a fixed start ship.'`
  - `TOKEN_HELP = 'Tokens are cheap ships with Lifetime Insurance. A goal upgrades one of them; the upgraded ship keeps LTI.'`

- [ ] **Step 1:** Write the failing tests for `startLineText` (all three cases) and for the exact constants.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the components. Run the Svelte autofixer on each changed component.
- [ ] **Step 4:** `node --test` → all pass, and `cd app && npx vite build` → OK. Do a browser check on a scratch data copy (`CCU_DATA=<copy> npx vite --port 5179` in `app/`):
  - the Goals headlines and start lines;
  - changing the start, and the limit;
  - marking a token;
  - a no-token goal (set the limit to $10);
  - no console errors.
- [ ] **Step 5:** Commit: "Show goals target-first with start and token controls".

### Task 7: Import goals from CCU Game

**Files:**
- Create:
  - `src/logic/ccugame.mjs`;
  - `test/ccugame.test.mjs`;
  - `test/fixtures/ccugame-saved-chains.json`: the user's 9 chains trimmed to `{ chains: [{ name, fromShipName, toShipName, options: { optimizationTarget } }] }`. The source is `<path to your saved_chains_*.json export>`; copy only those fields, no pledge ids.
  - `app/src/lib/goals/ImportGoals.svelte`.
- Modify:
  - `src/logic/state.mjs` (action `importGoals`);
  - `app/src/lib/GoalsPage.svelte` (an "Import from CCU Game" button next to "+ New goal");
  - `describe.mjs` (texts).

**Interfaces:**
- **`parseSavedChains(text: string) => Array<{ name, fromName, toName, longTerm: boolean }>`:** throws `Error('This is not a CCU Game saved-chains file')` unless the JSON has a `chains` array whose entries all have string `fromShipName` and `toShipName`.
- **`importRows(parsed, { ships, aliases, plans, lti }) => Array<{ name, fromName, toName, from: number|null, to: number|null, start, mode: 'watch'|'finish', status: 'new'|'exists'|'needs-ship' }>`:**
  - **Ship matching:** `aliasShipId ?? findShipExact`.
  - **Start:** `{kind:'token'}` when `from` is a ship type in `tokenPool(lti, tokenSettings(plans))`, else `{kind:'ship', ship: from}`.
  - **Status:**
    - `'needs-ship'` when the target can't be matched, or when the start can't be matched and isn't a token type;
    - `'exists'` when a goal with the same `target` and the same start already exists (token: any token goal; ship: same ship), or an earlier row in this file is the same;
    - otherwise `'new'`.
  - **Mode:** `longTerm` → `'watch'`, else `'finish'`.
- **State action `importGoals { rows }`:** adds every row with status `'new'` as one goal, in one save, with `name` = the row name. Returns the added chain ids.

- [ ] **Step 1: Write the failing tests:**
  - The fixture with a plans doc holding token goals to 600i Explorer, Arrastra and Galaxy plus a fixed Carrack → Odyssey goal gives 9 rows: 4 `exists` and 5 `new`.
  - Carrack → Odyssey has `start.kind === 'ship'`; all Pulse and Rambler rows have `start.kind === 'token'`; every row is `watch`.
  - Running `importGoals`, then `importRows` again, gives 9 `exists` (Review Focus 4).
  - A file whose chain is listed twice yields one `new` and one `exists`.
  - `parseSavedChains('{"foo":1}')` and `parseSavedChains('hello')` throw the exact message (Review Focus 5).
  - An unknown ship name gives `needs-ship`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the logic, then `ImportGoals.svelte`:
  - a file input (`accept=".json"`);
  - preview grouped as New / Already a goal / Needs a ship, where a needs-ship row gets a ShipPicker that turns it into `new`;
  - "Add N goals" dispatches `importGoals`;
  - Cancel discards.
- [ ] **Step 4:** `node --test` → all pass, and `npx vite build` OK. Browser check on a scratch copy by importing the real file `<path to your saved_chains_*.json export>`: the preview shows 5 new and 4 existing, and after confirming the goals appear with start lines.
- [ ] **Step 5:** Commit: "Import goals from CCU Game saved chains".

### Final: whole-branch review, then native build

After Task 7:
- run `cd app/src-tauri && cargo test` (16/16; there must be no Rust diff) and `npx tauri build --debug`;
- do a browser check on a scratch copy of the real data with the real CCU Game file (Today, Goals, Hangar);
- update the README sections on goals and the CLI `add` usage.

### Task 8: Quick search on long lists (user request, 2026-11-18)

The user asked: "big lists like the hangar, store etc need a quick search". Some lists already have their own filter boxes: the Hangar has "Search name or items", the Store's Warbonds list has a "Filter" box, and Prices' availability list has a filter. They behave differently from each other, and several long lists have no search at all.

**Files:**
- Create:
  - `app/src/lib/view/quickSearch.mjs`
  - `app/src/lib/ui/SearchBox.svelte`
  - `test/view/quick-search.test.mjs`
- Modify:
  - `app/src/lib/HangarTab.svelte`, `app/src/lib/MeltTab.svelte` (Worth melting)
  - `app/src/lib/WarbondsTab.svelte` (Store, on sale now)
  - `app/src/lib/PricesTab.svelte`
  - `app/src/lib/GoalsPage.svelte`
  - `src/logic/warbonds.mjs` (`filterWarbondTargets`) and `app/src/lib/view/hangar.mjs` (`filterPledges`), so they use the shared matcher

**Interfaces:**
- `matchesQuery(text: string, query: string) => boolean`:
  - case-insensitive, using `norm` from `src/logic/ships.mjs`;
  - every whitespace-separated word of the query must appear somewhere in the text (AND);
  - an empty query matches everything.

  For example, `"drake cut"` matches "Cutlass Black · Drake Interplanetary".
- `searchText(...parts) => string`: joins the non-empty parts. Each list builds one search string per row: ship names, manufacturer, pledge name and item titles for hangar pledges; from and to ship names for CCU rows.
- `SearchBox.svelte`:
  - props `value` (`$bindable`), `placeholder`, `label`, `shown`, `total`;
  - a `type="search"` input with an `aria-label`;
  - shows "`shown` of `total`" while a query is active;
  - Esc clears the box;
  - pressing "/" anywhere on the page (outside text inputs) focuses the page's first SearchBox;
  - the box stays visible while the list scrolls (sticky at the top of its panel).
- **Where it goes** (one SearchBox per page section; replace the existing ad-hoc inputs):
  - **Hangar:** one box filters the pledge list, the CCU table, the review list and the buyback list.
  - **Worth melting:** filters candidates and kept items.
  - **Store:** replaces Warbonds' Filter box; the "only my goals" and "only from ships I own" checkboxes stay.
  - **Prices:** one box filters the expected-price rows, the availability rows and the concept list. It replaces the availability filter.
  - **Goals:** the goal cards, shown only when there are more than 6 goals.
- **No-results text:** `NO_MATCHES = 'Nothing matches "<query>".'` in `describe.mjs`, built by `noMatchesText(query)`.

- [ ] **Step 1: Write the failing tests:**
  - `matchesQuery`:
    - case and punctuation are ignored (`"c8x"` matches "C8X Pisces Expedition");
    - multi-word AND: `"drake cut"` matches, `"drake zeus"` doesn't;
    - an empty query matches.
  - `noMatchesText('xyz')` gives the exact copy.
  - `filterPledges` and `filterWarbondTargets` still pass their existing tests, plus one multi-word case each.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the matcher, the SearchBox and the list wiring. Run the Svelte autofixer on changed components.
- [ ] **Step 4:** `node --test` → all pass, and `npx vite build` OK. In a browser on a scratch data copy:
  - "/" focuses the box;
  - Esc clears it;
  - the count shows while a query is active;
  - each list above filters;
  - the box stays visible while scrolling the Hangar;
  - no console errors.
- [ ] **Step 5:** Commit: "Add one quick search to every long list".

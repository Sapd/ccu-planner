# CCU planner UI redesign: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the desktop app's UI so beginners understand it on first use. The app opens on a Today home and shows each goal as a journey of own / buy now / wait-for-a-sale steps, in the "space cockpit" look.

**Architecture:**
- **Planner logic, stores and CLI stay as they are.** The one data addition is `warbond-prices.json`.
- **New pure view-model modules** turn routes into journeys (`src/logic/journey.mjs`) and the app state into the Today view (`app/src/lib/view/today.mjs`). They are tested with `node --test`.
- **One in-house design system** in `app/src/lib/ui/` (tokens plus a few components) restyles every screen. The shell becomes four sections plus an Advanced menu.

**Tech Stack:** Tauri 2, Svelte 5 runes, Vite 8, ECharts 6 (existing), `@fontsource-variable/inter` (new, the only new dependency), Node 26 test runner, Rust store.

**Spec:** `docs/superpowers/specs/2026-11-18-ccu-ui-redesign-design.md`. Read its "Money figures" and "Decisions from the builder check" sections before any task.

## Global Constraints

- **No RSI traffic from the app.** Links only open `https://robertsspaceindustries.com/` pages in the system browser, through the existing `RsiLink` / `backend.openExternal`. The app never touches the cart.
- **CSP stays strict.** There is no remote font or image loading; Inter is bundled.
- **The Rust store (`app/src-tauri/src/store.rs`) and the dev store (`app/vite-dev-data.js`) stay in parity** on files, shapes and the import allowlist. Saves stay rev-checked.
- **Wording lives in `src/logic/describe.mjs`.** New plain-language texts go there, and the CLI's existing output stays unchanged.
- **Step states:** `own` (grey), `now` (green), `wait` (purple). Colour is never the only signal: every chip carries words.
- **Colour tokens:**
  - `--own #64748b`, `--now #3ddc97`, `--wait #a78bfa`, `--warn #f0883e`
  - `--bg` is a radial gradient from `#1d2b4a` to `#0a0e16`
  - glass panels: `rgba(255,255,255,.06)` with border `rgba(255,255,255,.12)` and `backdrop-filter: blur(10px)`
- **Copy:**
  - "Goal" replaces "chain" in the UI. Section names are exactly `Today`, `Goals`, `Hangar`, `Store`, `Advanced`.
  - Plain mode choices: "Wait for sales when it saves money" (watch) and "Get it as soon as possible" (finish).
- **Money figures** follow the spec's Money figures section. "If the sales come back" is shown only for watch goals with at least one seen sale price. Otherwise the line is: `Sale prices not seen yet; keep syncing during sales`.
- **Contrast and layout:** text on glass meets WCAG AA. The layout works from 1024 px wide; below that, panels stack. Motion respects `prefers-reduced-motion`.
- **Tests:** `node --test test/ test/view/` and `cd app/src-tauri && cargo test` stay green after every task.
- **Commits:** no AI attribution. Each commit message has a body listing the changes and what was and was not verified.

## Review Focus

1. **Zero goals** (fresh import): Today and Goals show the explainer and "Pick your first goal ship", with no errors or empty boxes. Tested in Task 3 and Task 9.
2. **A goal with no route**, like the scratch data's Carrack → Odyssey: its card says why in plain words (reusing `noRouteMessage`) and its bar is empty, not broken. Tested in Task 2 and Task 6.
3. **Unknown MSRP** on a ship in the route: the bar falls back to step counts and "Full price" shows "unknown". There must be no `NaN` or `$0`. Tested in Task 2.
4. **Long journeys**: Pulse → Galaxy has 16 steps, most owned. Runs of 3 or more consecutive owned steps collapse to "N steps you already own" and expand on click. Tested in Task 2.
5. **Missing pictures**: a ship without an entry in `ship-images.json` uses the initials placeholder in heroes and steps, and the hero falls back to a plain gradient. Tested in Task 4.

---

### Task 1: Seen Warbond prices (`warbond-prices.json`)

**Files:**
- Create: `src/logic/salePrices.mjs`, `test/sale-prices.test.mjs`
- Modify: `scripts/sync.mjs`, `src/data.mjs` (`readRaw` gets `warbondPrices`), `src/logic/mapping.mjs` (`buildPlannerData` passes `warbondPrices` through as `data.warbondPrices`), `app/src-tauri/src/store.rs` and `app/vite-dev-data.js` (`LEGACY_FILES`, load), plus their tests

**Interfaces:**
- Produces:
  - `recordWarbondPrices(prev, offers, today) -> { pairs: { "<from>-<to>": { cash, at: 'YYYY-MM-DD', skuId } } }`
    - Keeps the lowest Warbond `cash` per pair across syncs.
    - On a tie it keeps the earlier date.
    - It ignores non-Warbond offers.
    - It never mutates `prev`.
  - `seenSalePrice(warbondPrices, from, to, saleEvents) -> { cash, at, event: {name,from,to}|null } | null`
    - `event` is the entered sale event whose date range covers `at`.

- [ ] **Step 1: Failing tests** in `test/sale-prices.test.mjs`:
  - A Warbond at 4000 is recorded.
  - A later 3500 replaces it.
  - A later 4500 does not.
  - Standard offers are ignored.
  - `prev` is unchanged (deep-equal before and after).
  - `seenSalePrice` returns `event.name === 'IAE 2956'` for `at: '2026-11-18'` with the suggested event, and `event: null` with no events.
  - An unknown pair gives `null`.
  - Store parity: in `test/view/dev-store.test.mjs` and a cargo test, `warbond-prices.json` is imported and loaded.
- [ ] **Step 2: Run, expect FAIL.** `node --test test/sale-prices.test.mjs`
- [ ] **Step 3: Implement.**
  - At the end of `syncUpgrades`, load planner data from `DATA_DIR`, call `recordWarbondPrices(readJson(file, {pairs:{}}), data.offers, localToday())` and write the result atomically with the existing `writeJson`.
  - Do not run a real sync; the pure function carries the logic.
- [ ] **Step 4: Run, expect PASS.** Run `node --test test/ test/view/` and `cargo test`.
- [ ] **Step 5: Commit** "Record the lowest Warbond price seen per upgrade".

### Task 2: Journey view model and plain texts

**Files:**
- Create: `src/logic/journey.mjs`, `test/journey.test.mjs`
- Modify: `src/logic/describe.mjs` (new texts listed below)

**Interfaces:**
- Consumes:
  - `splitRoute`, `lockReason`, `expectedChanges` (`src/logic/chains.mjs`)
  - `shipAvailability`, `availCtx` (`src/logic/availability.mjs`)
  - `seenSalePrice` (Task 1)
- Produces `journey(route, chain, ctx) -> Journey`, where `ctx = { ships, overrides, expected, avail, warbondPrices, saleEvents }` and `Journey` is:

```js
{
  steps: [{ step, state: 'own'|'now'|'wait', lock: boolean, reason: string|null, alert: string|null, seen: {cash, at, event}|null, value: number|null }],   // alert: the step's expectedChanges text, if any
  groups: [{ kind: 'step', index } | { kind: 'owned-run', from: index, to: index, count }],   // runs of >= 3 consecutive own steps collapse
  bar: { unit: 'value'|'steps', own: number, now: number, wait: number },
  figures: { fullPrice: number|null, today: number, ifSales: number|null, salesSeen: boolean, saveToday: number|null, saveIfSales: number|null },
  done: boolean,
}
```

- **State mapping** (spec decision 1):
  - `owned` → `own`.
  - Each `splitRoute(...).buyNow` step → `now`.
  - The `lockNow` step → `now` with `lock: true` and `reason` from `lockReason`.
  - `later` steps → `wait`.
  - When `chain.mode === 'finish'`, every non-owned step → `now` (spec decision 2).
- **Figures:**
  - `fullPrice` = msrp(target) − msrp(base); it is null if either is unknown.
  - `today` is the sum of `cash` over `now` and `wait` steps.
  - `ifSales` = `today` − Σ over `wait` steps of max(0, `cash` − `seen.cash`).
    - It is null if no `wait` step has a `seen` price lower than its `cash`, or if the chain is a finish goal.
    - `salesSeen` is true when `ifSales` is not null.
  - `saveToday` = `fullPrice` − `today`, and `saveIfSales` = `fullPrice` − `ifSales`. Each is null when an input is null.
- **Bar:**
  - `value` = msrp(to) − msrp(from) per step.
  - If any step's value is null or ≤ 0, `unit` is `'steps'` and each step counts 1.
- **`done`** is true when every step is `own`.
- **`journey(null, …)`** returns `{ steps: [], groups: [], bar: {unit:'steps',own:0,now:0,wait:0}, figures: {fullPrice, today: 0, ifSales: null, salesSeen: false, saveToday: null, saveIfSales: null}, done: false }`.
- **New texts in `describe.mjs`** (exact strings):
  - `STATE_LABEL = { own: 'You own this', now: 'Buy now', wait: 'Wait for a sale' }`
  - `LOCK_LABEL = 'Buy now · locks the price'`
  - `waitReasonText(kind, { event, seen, cash })`:
    - `'normal'` → `Only at the normal price right now ($X). Warbonds for it show up during sales.`
    - `'off-store'` → `Not in the store right now. It usually comes back during sales.`
    - `'event-only'` → `Only known on sale during ${event.name}. Buy before ${shortDay(event.to)} or it may be gone.`
    - `'seen'` → `Seen for $Y during ${event?.name ?? 'an earlier sale'}.`
  - `FIGURE_HELP`:
    - `fullPrice` → `Upgrading straight to the target at the normal store price.`
    - `today` → `The cheapest way with what you own and what is in the store today.`
    - `ifSales` → `If each waiting step gets the lowest sale price seen so far. Not guaranteed.`
  - `NO_SALES_SEEN = 'Sale prices not seen yet; keep syncing during sales'`
  - `ownedRunText(n) = \`${n} steps you already own\``

- [ ] **Step 1: Failing tests** in `test/journey.test.mjs`. Use small synthetic ships and routes, following `test/chains.test.mjs` style.
  - **Watch route** with [owned, Warbond, Standard later]: states are `own`, `now`, `wait`.
    - `today` = Warbond cash + Standard cash.
    - With a seen price 1000 below the Standard cash, `ifSales === today - 1000` and `salesSeen === true`.
  - **Finish goal:** every non-owned step is `now`, and `ifSales === null`.
  - **Lock:** a concept target with lock auto puts the last Standard step as `now` with `lock: true` and a non-empty `reason`.
  - **Alert:** an `expected` price rise on a step's target gives that step a non-null `alert`; other steps have `alert: null`.
  - **Unknown msrp:** `bar.unit === 'steps'` and `figures.fullPrice === null`, with no NaN anywhere (check `JSON.stringify` has no `null` where a number is expected except the documented nullable fields).
  - **All owned:** `done === true` and the bar has `own` only.
  - **Owned runs:** 5 consecutive owned steps produce one `owned-run` group with `count: 5`; 2 consecutive owned steps stay individual `step` groups.
  - **Null route:** `journey(null, …)` returns the empty shape.
  - **Texts:** each new `describe.mjs` text returns the exact string for a sample input.
- [ ] **Step 2: Run, expect FAIL.** `node --test test/journey.test.mjs`
- [ ] **Step 3: Implement** `journey` in `src/logic/journey.mjs` and the texts in `describe.mjs`.
- [ ] **Step 4: Run, expect PASS.** `node --test test/ test/view/`
- [ ] **Step 5: Commit** "Add the journey view model and plain-language texts".

### Task 3: Today view model

**Files:**
- Modify: `app/src/lib/view/today.mjs`, `test/view/today.test.mjs`

**Interfaces:**
- Consumes:
  - `journey` (Task 2)
  - `proposeChain`, `diffRoutes`
  - `meltView` (`app/src/lib/view/hangar.mjs`)
  - `ongoingEvent`
- Produces `todayView(app, today = localToday()) -> TodayView`. It replaces `todaySummary`; update its two callers.

```js
{
  empty: boolean,                         // no goals at all
  hero: { goalId, shipId, buyCount, buyCash, goalsTouched: [goalId], nothing: boolean, nothingWhy: 'all-owned'|'waiting'|'no-route'|null },
  buys: [{ goalId, step, lock, reason, differs }],   // all `now` steps of every goal (watch and finish), in goal priority order
  waiting: { count, goals: [goalId], event: {name,to}|null, eventOnly: [{ goalId, step, event }], alerts: [{ goalId, step, text }] },   // alerts: every journey step with a non-null alert
  melt: { count, credit } | null,         // null when there are no melt candidates
  goals: [{ goalId, name, targetId, journey, status: 'done'|'buy'|'wait'|'no-route', buyCount, waitCount }],
  catalogAt, hangarAt,
}
```

- **Hero goal** (spec decision 7): the highest-priority goal (`PRIORITY`, then name) with at least one `now` step; if none has one, the highest-priority goal.
- **`nothingWhy`:**
  - `'all-owned'` when every goal is done;
  - `'no-route'` when no goal has a route;
  - `'waiting'` otherwise.
- **`differs`** reuses `bestDiffers(chain.accepted, route, diffRoutes)`.

- [ ] **Step 1: Failing tests** in `test/view/today.test.mjs`. Rewrite the existing `todaySummary` tests to the new shape and keep their cases.
  - Zero chains → `empty: true`, and `hero.nothing` is true.
  - A finish goal's purchases appear in `buys` and in `hero.buyCount`.
  - The hero picks the high-priority goal with a `now` step over a high-priority goal with only `wait` steps.
  - The goal statuses `done`, `buy`, `wait` and `no-route` each appear for a matching synthetic goal.
  - `melt` is null with no candidates.
  - `eventOnly` lists a later Standard step into an event-only target while an event is ongoing (this case was in the old tests).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Memoise per `(plans.rev, overrides.rev, saleEvents.rev, today)` in a capped non-reactive Map, following `meltView`'s pattern.
- [ ] **Step 4: Run, expect PASS.** `node --test test/ test/view/`
- [ ] **Step 5: Commit** "Build the Today view from journeys".

### Task 4: Design system and new shell

**Files:**
- Create:
  - `app/src/lib/ui/tokens.css`
  - `app/src/lib/ui/GlassPanel.svelte`, `StateChip.svelte`, `JourneyBar.svelte`, `MoneyFigure.svelte`, `ShipHero.svelte`, `Hint.svelte`, `SectionNav.svelte`
  - `app/src/lib/view/nav.mjs`, `test/view/nav.test.mjs`
- Modify: `app/src/main.js` (import tokens and the font), `app/package.json` (`@fontsource-variable/inter`, exact version), `app/src/lib/state.svelte.js` (`ui.section`, `ui.advanced`), `app/src/lib/Shell.svelte`

**Interfaces:**
- **Components:**
  - `StateChip {state, lock?}`: the label comes from `STATE_LABEL` / `LOCK_LABEL`.
  - `JourneyBar {bar}`: three segments proportional to `own`/`now`/`wait`, each with a title giving its label and value. It shows "Done ✓" when only `own` is present.
  - `MoneyFigure {label, value, help, tone: 'full'|'now'|'wait'|'muted', strike?}`: the value uses `usd`, `null` reads "unknown", and a "?" button toggles `help`.
  - `ShipHero {ship, height}`: the large `-l` picture with a dark gradient overlay. With no picture it is a plain gradient with initials.
  - `Hint {id, text}`: shows once per id until dismissed. It is stored in `localStorage` under `ccu.hints.<id>`; read and write go through try/catch, and it shows when storage is unavailable.
- **Nav (pure, `nav.mjs`):**
  - `SECTIONS = ['today','goals','hangar','store']`
  - `ADVANCED = [['graphs','Graphs'],['explorer','Plan explorer'],['prices','Prices & sale events']]`
  - `sectionFor(oldTab)` maps the old `ui.tab` values to the new sections:
    - chain → goals
    - hangar, melt → hangar
    - prices, warbonds → store
    - graph → graphs
    - plan → explorer
- **Shell layout:**
  - Top bar: app name, `SectionNav`, "Advanced ▾" menu, data timestamps (small, right), and a "?" that reopens the explainer (wired in Task 9; until then it is inert).
  - The body renders the section. Until Tasks 5–8 land, each section renders the existing components so nothing is lost:
    - Today → the old `TodayBanner` and `ChainList`
    - Goals → `ChainList` + `Workspace` + `FleetPlan`
    - Hangar → `HangarTab` + `MeltTab`
    - Store → `WarbondsTab`
    - Advanced → `GraphTab`, `PlanExplorer`, `PricesTab`
  - The background is the cockpit gradient, and the base text and panel colours come from the tokens.

- [ ] **Step 1: Failing tests** in `test/view/nav.test.mjs`:
  - `sectionFor` maps all 7 old tabs as listed.
  - `SECTIONS` and `ADVANCED` match the values listed.
  - Missing pictures (Review Focus 5): a view helper `heroSource(ship)` exported from `nav.mjs` returns `{ kind: 'image', file }` with the `-l` file, `{ kind: 'image', file }` with `-s` when only that exists, and `{ kind: 'initials', text }` with none.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the tokens (Global Constraints values), the components and the shell.
  - Install the font with `npm i -E @fontsource-variable/inter` in `app/`.
  - Check that the CSP still allows the bundled font: fonts are served from the app origin.
- [ ] **Step 4: Verify.**
  - Run `node --test test/ test/view/` and `cd app && npx vite build`, expecting success.
  - Run the dev server on the scratch data (`CCU_DATA=<scratch> npx vite --port 5179`; the controller supplies the path). Each section and Advanced entry opens without console errors. Take one screenshot per section.
- [ ] **Step 5: Commit** "Add the cockpit design system and the four-section shell".

### Task 5: Today page

**Files:**
- Create: `app/src/lib/TodayPage.svelte`, `app/src/lib/ui/GoalCard.svelte`
- Modify: `app/src/lib/Shell.svelte` (Today renders `TodayPage`). Delete `TodayBanner.svelte` once nothing imports it.

**Interfaces:**
- Consumes `todayView` (Task 3), `JourneyBar`, `ShipHero`, `StateChip`, `MoneyFigure`, `Hint`, and `RsiLink`.
- Produces `GoalCard {goal, onOpen}`, which Task 6 reuses. It shows the picture, name, `JourneyBar` and a status chip:
  - "Buy N today"
  - "N wait"
  - "Done ✓"
  - "No route": in plain words, with the `noRouteMessage` text as a title.

**Layout (the spec's Today section):**
- **Hero:** `ShipHero` of the hero goal's target with an overlay.
  - The title is "Your next move: buy N upgrades today · $X" and the subline names the goals touched. Otherwise the title is "Nothing to buy today" with a subline by `nothingWhy`:
    - all-owned → "All your goals are done."
    - waiting → "Everything left waits for a sale."
    - no-route → "None of your goals has a route right now."
  - "Show me" expands an inline list of `buys`. Each row has the from→to thumbnails, a `StateChip`, the price and an `RsiLink` to the upgrade tool, and lock rows show their reason.
- **Waiting panel:** "N steps wait for a sale across M goals"; the event line "IAE 2956 ends Nov 27" when one is ongoing; one plain line per `eventOnly` entry, using `waitReasonText('event-only')`; one line per `alerts` entry.
- **Melt tip:** shown only when `melt`. It reads "N CCUs you don't need: melt for $X store credit" and its button opens the Hangar section's Worth melting group.
- **Goal strip:** a `GoalCard` per goal; clicking one opens it in Goals.
- **Hint id `today`:** "This page tells you what to do now. Green = buy today, purple = wait for a sale, grey = you already own it."
- **Empty (`todayView.empty`):** a big "Pick your first goal ship" button that opens Goals with Add goal open. Task 9 adds the explainer here.

- [ ] **Step 1:** Implement `TodayPage` and `GoalCard`. The logic is already tested in Task 3; the components only render it.
- [ ] **Step 2: Verify in the browser pane** on the scratch data:
  - The hero shows a goal picture and a sentence.
  - "Show me" lists buys with links.
  - The Carrack → Odyssey card shows "No route".
  - A temporary empty data folder shows the empty state; remove that folder afterwards.
  - Screenshot each state. There are no console errors.
- [ ] **Step 3:** Run `node --test test/ test/view/` and `npx vite build`.
- [ ] **Step 4: Commit** "Add the Today page".

### Task 6: Goals page and the journey

**Files:**
- Create: `app/src/lib/GoalsPage.svelte`, `app/src/lib/GoalDetail.svelte`, `app/src/lib/ui/JourneyStep.svelte`
- Modify: `AddChain.svelte`, `Proposals.svelte`, `Staircase.svelte`, `FleetPlan.svelte` and `WouldHelp.svelte`, restyled to tokens and the "goal" wording. Their behaviour is unchanged, and their tests keep passing. Then `Shell.svelte`, where Goals renders `GoalsPage`. Delete `Workspace.svelte`, `Steps.svelte` and `ChainList.svelte` once nothing imports them, along with tests that only cover deleted code; keep `groupSteps` if anything still uses it, otherwise delete it with its test.

**Interfaces:**
- Consumes `journey` (Task 2), `GoalCard` (Task 5), `todayView().goals` for the card list, the existing `dispatch` actions (`setMode`, `setPriority`, `setLock`, `setObjective`, `accept`, `release`, `removeChain`; keep the existing names in `state.mjs`), and `wantedMemo`.
- **`JourneyStep {item, ships, onExpand}`:** one row with from-thumbnail → to-thumbnail, ship names, `StateChip`, price and an action.
  - The action is an `RsiLink` (upgrade tool) for `now`, a hangar link for `own`, and "What to wait for ▾" for `wait`.
  - A step with `alert` shows it as a warn-coloured line under the row.
  - Expanding a `wait` step shows:
    - the wait reason via `waitReasonText`: use `'event-only'` when availability says so; `'off-store'` when the target has no Standard SKU today (`ships.get(to).standard === false`); otherwise `'normal'`;
    - the `'seen'` line when `item.seen`;
    - the would-help thresholds for this pair from `WouldHelp`'s data, in plain words: "A Warbond below $X would make this cheaper".

**Layout (the spec's Goals section):**
- **Top:** `GoalCard`s, a "+ New goal" button that opens the restyled `AddChain`, and a "Plan all goals together" button that opens the restyled `FleetPlan`.
- **Detail header:** `ShipHero` and "Base → Target", then three `MoneyFigure`s:
  - Full price (struck through);
  - Today (tone now);
  - If the sales come back (tone wait). When `salesSeen` is false it shows `NO_SALES_SEEN` instead.

  Under each figure, a save line: "save $X today" / "save up to ≈ $Y if the sales come back".
- **`JourneyBar`, then the journey:** groups from `journey.groups`. An `owned-run` renders as one row "N steps you already own ▸" that expands to its steps.
- **Settings (collapsed by default):**
  - The mode as two radio cards with the exact plain labels from Global Constraints.
  - Priority.
  - "Lock the price of the last step": auto / always / never.
  - "More settings" holds the objective (cash vs all-in, labelled "Count only new money" / "Count what you already paid too") and the all-in figure.
  - Remove goal (with a confirm).
- **"Other ways (N)"** (collapsed): the restyled `Proposals` with accept and the differs-from-accepted note.
- **"Price chart"** (collapsed): the restyled `Staircase`.
- **No route:** the header shows the `noRouteMessage` text in a panel instead of the figures, and settings stay available.
- **Hint id `goals`:** "Each row is one upgrade. Buy the green ones now; the purple ones are cheaper during sales, so wait for them."

- [ ] **Step 1: Failing test** for the wait-reason selection. Export a pure `waitReasonKind(step, ships, avail)` from `src/logic/journey.mjs` and test it in `test/journey.test.mjs`. It returns `'event-only'` for an event-only target during an event, `'off-store'` when `standard === false`, and `'normal'` otherwise.
- [ ] **Step 2:** Run it and expect FAIL. Implement it, run it and expect PASS.
- [ ] **Step 3:** Implement the components and the page.
- [ ] **Step 4: Verify in the browser pane** on the scratch data:
  - Pulse → Galaxy shows the three figures and its collapsed owned runs, and a wait step expands with its reasons.
  - Accepting a proposal and changing the mode both save. The conflict notice still works when `plans.json` is changed from the CLI while the page is open.
  - Carrack → Odyssey shows its no-route panel.
  - Restore the scratch data afterwards: put the mode and accepted routes back as they were.
  - Screenshot each state.
- [ ] **Step 5:** Run `node --test test/ test/view/` and `npx vite build`.
- [ ] **Step 6: Commit** "Add the Goals page with the own / buy now / wait journey".

### Task 7: Hangar with Worth melting

**Files:**
- Modify: `HangarTab.svelte`, `PledgeDetail.svelte` and `MeltTab.svelte` (restyled to tokens; MeltTab becomes the "Worth melting" group inside Hangar); `Shell.svelte`

**Interfaces:**
- Consumes the existing `hangarRows`, `pledgeOverview`, `meltView`, and `describe.mjs` melt texts.
- Melt reasons are reworded for display only, through a new `meltReasonPlain(keepReason)` in `describe.mjs`, which maps each `KEEP` value to one plain sentence. The CLI keeps the existing strings.

**Layout:**
- Category chips stay.
- The "Worth melting" group sits first when there are candidates. It shows the total credit, the candidates with their plain reason, and "Kept (N)" collapsed with plain reasons.
- The melt bar chart is restyled.
- Today's melt tip (Task 5) links here.

- [ ] **Step 1: Failing test:** `meltReasonPlain` returns a non-empty plain sentence for every `KEEP` value. Iterate `Object.values(KEEP)`; no value may return its input unchanged.
- [ ] **Step 2:** Run it and expect FAIL. Implement it, run it and expect PASS.
- [ ] **Step 3: Restyle and merge.**
- [ ] **Step 4: Verify in the browser pane:** the Hangar shows its categories and the melt group, with no console errors. Take screenshots.
- [ ] **Step 5: Commit** "Restyle the Hangar and fold melting into it".

### Task 8: Store and Advanced

**Files:**
- Modify: `WarbondsTab.svelte` (becomes the Store's "On sale now"), `PricesTab.svelte` (split into a "Sale events" panel shown in Store and "Prices & sale events" under Advanced), `GraphTab.svelte`, `DecisionGraph.svelte` and `PlanExplorer.svelte` (restyled to tokens; behaviour unchanged), `Shell.svelte`

**Layout:**
- **Store:**
  - The "Sale events" panel on top: the list, the "Add IAE 2956" suggestion and the no-events notice.
  - Then "On sale now" (Warbonds grouped by target, with pictures and links).
  - A link "Expected prices and ship availability → Advanced".
- **Advanced:** Graphs (Network/Decision switch kept), Plan explorer, and Prices & sale events.
- **ECharts colours** use the token values: own, now and wait map onto the owned, warbond and standard kind colours, all read from CSS variables at render time.
- **Hint id `store`:** "Warbonds are cheaper upgrades that mostly appear during sales. Enter the current sale here so the planner knows what is only on sale for now."

- [ ] **Step 1: Restyle and split.** The existing tests cover the logic, so no new test is needed unless a helper changes.
- [ ] **Step 2: Verify in the browser pane:**
  - The Store panels work: add the suggested event, then remove it, so the scratch data ends as it started.
  - The Graphs network and decision views render with the new colours.
  - The Plan explorer works.
  - Take screenshots and check the console is clean.
- [ ] **Step 3:** Run `node --test test/ test/view/` and `npx vite build`.
- [ ] **Step 4: Commit** "Restyle the Store and the Advanced views".

### Task 9: First run, explainer, hints, docs and final checks

**Files:**
- Create: `app/src/lib/ui/Explainer.svelte`, `app/src/lib/view/firstRun.mjs`, `test/view/first-run.test.mjs`
- Modify: `ImportScreen.svelte` (restyled), `Shell.svelte` (the "?" opens the explainer), `TodayPage.svelte` and `GoalsPage.svelte` (empty states show the explainer and the first-goal button), `README.md` (Desktop app section: the new sections and terms, plus a sentence on the warbond-prices record)

**Interfaces:**
- `firstRun.mjs`:
  - `EXPLAINER_STEPS`: exactly the three sentences from the spec's "First run and help", in order.
  - `shouldShowExplainer(storage)`: true unless `storage.getItem('ccu.explainer.seen') === '1'`. It returns true when `storage` is null or throws.
  - `markExplainerSeen(storage)`: never throws.
- `Explainer`: a three-step overlay with Next / Back / Done. Done calls `markExplainerSeen`. Escape closes it. Focus is trapped inside while it is open and returns to the "?" afterwards.

- [ ] **Step 1: Failing tests** in `test/view/first-run.test.mjs`:
  - The three exact sentences, in order.
  - `shouldShowExplainer` with a fake storage: unseen → true; seen → false; `null` → true; a throwing storage → true.
  - `markExplainerSeen` does not throw on a throwing storage.
- [ ] **Step 2:** Run them and expect FAIL. Implement, run and expect PASS.
- [ ] **Step 3: Wire up:**
  - After the import's Continue, and on first open with data, the explainer shows when `shouldShowExplainer`.
  - The empty states in Today and Goals show the explainer inline above the button.
- [ ] **Step 4: Full checks.**
  - Run `node --test test/ test/view/`, `cd app/src-tauri && cargo test`, `cd app && npx vite build` and `npm run tauri build -- --debug`; the last must produce `CCU Planner.app`.
  - Browser pane on an empty dev data folder: the import screen, then the explainer, then Today with 4 goals. Delete the folder afterwards.
  - Browser pane on the scratch data: walk every section once, take screenshots, check the console is clean, and check that a 1024 px width doesn't overflow.
- [ ] **Step 5: Commit** "Add the first-run explainer and hints; document the new UI".

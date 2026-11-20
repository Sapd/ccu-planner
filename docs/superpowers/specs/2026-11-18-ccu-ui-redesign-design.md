# CCU planner: UI redesign

Date: 2026-11-18. Status: draft for approval.
Builds on: `2026-11-18-ccu-desktop-app-design.md` (the desktop app this redesign restyles).

## Why

The desktop app works, but it reads like an expert tool: seven dense tabs, several money figures side by side ("$60 cash · 14 owned ($105) · all-in $165"), and terms like watch/finish mode.

The biggest pain point with the old CCU Game extension was the difference between "long-term saving" and "current highest saving". Beginners don't understand two things:
- the cheapest way to a ship usually means **waiting**;
- not every upgrade is in the store all the time. Warbond upgrades and some Standard ones appear only during sales such as IAE or Invictus.

Goal: the app should look modern and feel like it belongs to Star Citizen. Someone who barely knows CCUs should understand on first use:
- what they own;
- what to buy today;
- what to wait for;
- what waiting is likely to save.

## Goals

- **One way of explaining every route.** A route is a journey of steps, and each step is in one of three states:
  - **You own this** (grey): an upgrade already in your hangar.
  - **Buy now** (green): on sale today at a price worth taking.
  - **Wait for a sale** (purple): currently only at the normal price, or not in the store at all; cheaper during sales.

  A bar over each journey shows how the total splits across the three states.
- **"Today" is the home screen.** It answers "what should I do right now?" in one sentence, then shows what's waiting and any CCUs worth melting.
- **Fewer places.** Today, Goals, Hangar and Store are the four top sections. The expert views move under Advanced.
- **Plain words.** "Goal" replaces "chain". Each money figure has one clear meaning.
- **A modern look in the "space cockpit" style** (the user picked it):
  - a dark background with a deep blue radial glow;
  - large ship pictures behind headline text;
  - frosted-glass panels;
  - green, grey and purple used only for buy now, own and wait.
- **Beginner help.** A first-run explainer, "How CCUs work", in three short steps; short inline hints the user can dismiss; a "?" next to every money figure.

## Non-goals

- No change to planner logic, the Rust store or the CLI. This is a presentation rework. There are two exceptions:
  - small pure helpers that compute the new view models;
  - the `warbond-prices.json` record (decision 3 below), which the CLI sync writes and both stores load and import.
- No new RSI traffic. The phase-3 items (sync buttons, login, EUR) stay in phase 3.
- No predictions of future sales or prices beyond what the data has seen (see Money figures).
- No light theme.

## Anti-goals (a failure even if it technically works)

- A single guessed "you'd pay" number shown as if it were certain.
- Beginners still facing a wall of numbers on first open.
- Expert features lost. Everything in today's seven tabs must still be reachable, under Advanced if need be.
- A look that comes from a generic UI kit and doesn't match the cockpit style.

## Money figures

These definitions are fixed and used everywhere: Today, Goals, the CLI wording is unchanged.

- **Full price:** target MSRP minus base MSRP, the cost of upgrading straight to the target at the normal store price.
- **Today:** the cheapest way using only what is buyable right now plus what you own. This is the existing "finish" proposal: cash for today's purchases plus the normal store price of every step that waits. It is the honest upper bound.
- **If the sales come back:** the same journey, with each waiting step priced at the lowest Warbond price seen for that exact pair in the offer history. Steps never seen on sale keep the normal price.
  - Shown as "as low as ≈ $X", with a "?" that says which sale each price comes from (for example "seen for $20 during IAE 2956").
  - When no waiting step has a seen sale price, the line reads "Sale prices not seen yet; keep syncing during sales" instead of a number.
- **You save:** full price minus the figure it sits next to. It is always labelled, as "save $60 today" or "save up to ≈ $120 if the sales come back".
- **Already own:** the paid value of the owned CCUs the journey uses. It appears in the bar's grey part, not in the total you pay.
- **All-in** (including what you already paid) stays available in the goal's details and under Advanced, not on the main cards.

The watch/finish modes and the all-in objective are kept as they are. In the UI they become one plain choice per goal:
- "Wait for sales when it saves money" (the default, which is watch);
- "Get it as soon as possible" (finish).

## Screens

### Shell

- A top bar holds the app name, the four sections (Today · Goals · Hangar · Store) and an "Advanced ▾" menu. The menu leads to Graph, Decision graph, Plan explorer and Prices & sale events.
- The data timestamps ("Store data from 18 Nov, hangar from 18 Nov") sit small at the right of the top bar.
- The background is the cockpit gradient everywhere. Content goes in glass panels.

### Today (home)

- **Hero box.** It sits over the picture of the most important goal ship and says one thing:
  - "Your next move: buy N upgrades today · $X", with one line on what they save and for which goals;
  - or "Nothing to buy today", with why (everything owned, or waiting for a sale).

  It has a "Show me" button that lists the purchases with their RSI buy links. The existing link rules still apply: links open RSI pages only, and the app never touches the cart.
- **Waiting for a sale:** how many steps wait, across which goals, and the current sale event if one is entered (for example "IAE 2956 ends Nov 27").
  - The 8f availability warnings appear here in plain words: "Only known to be on sale during IAE: buy before Nov 27".
- **Hangar tip:** CCUs worth melting, with the total store credit. It is shown only when there are candidates.
- **Goal strip:** a small card per goal with its picture, name, three-colour bar and status ("Buy 1 today", "3 wait", "Done ✓").

### Goals

- A list of goal cards at the top (picture, name, bar, status), plus "+ New goal".
- **Selected goal:**
  - **Header:** large ship picture, "Pulse → Galaxy", and the three figures (full price, today, if the sales come back) as described above.
  - **The journey:**
    - One row per step: from-ship thumbnail → to-ship thumbnail, its state chip and price, and an action (buy link, hangar link, or "what to wait for").
    - A wait step expands to show the would-help information in plain words, for example "A Warbond below $60 would make this cheaper".
    - Long journeys collapse runs of owned steps ("8 steps you already own").
  - **Settings, folded away:** the plain choice (wait for sales / as soon as possible), priority, and the target lock and concept notes, phrased plainly.
  - **Other routes:** today's proposals and alternatives, as "Other ways (2)", collapsed.

### Hangar

- Today's Hangar tab (pledges by category, CCUs, standalone ships, other items, detail panel) restyled.
- Melt merges in as a "Worth melting" group with today's reasons in plain words, including the IAE availability reasons.

### Store

- On sale now: today's Warbonds tab, restyled.
- **Sale events:** the 8f list with the "Add IAE 2956" suggestion.
- **Prices:** expected prices and ship availability. Prices may instead sit under Advanced if the Store page gets crowded; the builder decides, keeping one reachable place.

### Advanced

- Graph (network and decision) and Plan explorer, as they are, restyled to the cockpit tokens.

### First run and help

- After the import screen (restyled), a three-step "How CCUs work" overlay:
  1. "A CCU upgrades one ship to a more expensive one; you pay the difference."
  2. "Chaining small upgrades is often cheaper than one big one."
  3. "The cheapest upgrades (Warbonds) mostly appear during sales, so the best price usually means waiting."
- The overlay can be reopened from a "?" in the top bar.
- The Today, Goals and Store pages each have one dismissible hint line on first visit. A small local settings flag remembers dismissals; it is not RSI data.

## Visual system

- **Design tokens** as CSS custom properties in one file:
  - colours: background gradient, panel glass, text, muted, line, own, now, wait, warn;
  - radii, spacing scale, type scale.
- **Font:** Inter, bundled locally. There is no network font loading; the CSP stays strict.
- **Shared components:** `GlassPanel`, `StateChip` (own/now/wait), `JourneyBar`, `JourneyStep`, `ShipHero` (large picture with gradient overlay), `MoneyFigure` (value, label and "?" explanation), `SectionNav`, `Hint`, `Explainer`.
- **Pictures:** the local WebP files from Task 8e. Large (`-l`) for heroes, small (`-s`) for steps and cards, with the initials placeholder when missing.
- **Motion:** subtle only, such as the bar filling on load and panel fade. Respects reduced-motion.
- **Contrast:** text on the glass panels meets WCAG AA. Colour is never the only signal: every state chip carries words.
- **Window size:** works from 1024 px wide upward. Below that, panels stack.

## Approaches considered

1. **Restyle the current app (chosen by the user).** Keep `src/logic`, the stores and the backend; replace the shell, every screen and the styles; build a small in-house design system. No new dependencies besides the bundled font.
2. **Rebuild the screens on a UI kit** (Tailwind plus a component set). Faster polished parts, but new dependencies, and the kit's look fights the cockpit style.
3. **New app, port the logic.** Most freedom, but it redoes working, tested plumbing.

## Constraints

- Existing rules stay in force:
  - The app makes no RSI requests.
  - Links open only `https://robertsspaceindustries.com/` pages in the system browser.
  - The CSP stays strict.
  - The Rust store and the dev store keep parity.
  - Saves are rev-checked.
  - Shared wording lives in `src/logic/describe.mjs`, and new plain-language texts go there too.
- The existing tests stay green. New view helpers (money figures, journey states, the Today summary) are pure and tested.
- The scratch-data browser check and the native app build (`tauri build --debug`) must both work at the end.

## Decisions from the builder check (designer's calls, check them)

1. **Step states, mapped from the existing groups.** These are `splitRoute` / `groupSteps`:
   - Owned steps → **own**.
   - Steps that are bought today, i.e. `buyNow` (a Warbond on sale now), become **buy now**. A `lockNow` step also becomes **buy now**, with the chip "Buy now · locks the price" and its reason (concept ship, expected price rise, or only known on sale during the event).
   - A `later` step is a watch-mode Standard step that the planner leaves for a possible Warbond. It becomes **wait**.
   - "Worth taking" is the planner's own decision. There is no new threshold.
2. **Finish goals** ("Get it as soon as possible").
   - Every step is bought now, so they have no wait state.
   - Their purchases count in the Today hero ("buy N upgrades today"), and their bars show only own and buy now.
   - They show no "if the sales come back" figure.
3. **Seen sale prices need a small new record.**
   - Today `offer-history.jsonl` stores only changes, and without the SKU kind, so it can't tell a past Warbond from a Standard offer.
   - Each upgrade sync therefore also writes `warbond-prices.json`: for every from→to pair, the lowest Warbond price seen, the date and the SKU id. Today's IAE offers count as seen, so the first sync fills it.
   - The sale-event name comes from matching the date against `sale-events.json`.
   - Like all data files, it is loaded and imported by both stores, in parity.
   - This is the one data change in this redesign.
4. **The bar measures value, not cash.** Each step's width is its normal store price (the MSRP difference), so own, now and wait are in the same unit, "how much of the way". If the prices are unknown, the bar falls back to step counts. A fully owned journey shows a full grey bar with "Done ✓".
5. **Where today's Chain-tab features go:**
   - Proposals, accepting a route and the "differs from your accepted route" diff go in the goal's "Other ways" section.
   - The staircase price chart moves into the goal's details ("Price chart").
   - Fleet plan becomes a "Plan all goals together" button on the Goals page.
   - The expected-change alerts are shown on the affected steps and in Today's waiting section.
   - The all-in objective and the all-in figure go in the goal's settings under "More settings".
6. **First-run and hint flags** live in the webview's `localStorage`. They are per-device UI preferences, not planner data, so there is no store change. If the flags are missing, the explainer shows again, which is harmless.
7. **Hero ship picture and empty states.**
   - The hero ship is the highest-priority goal that has a buy-now step. If no goal has one, it is the highest-priority goal.
   - With no goals (for example right after import), Today shows the explainer and a big "Pick your first goal ship" button. Goals shows the same button.
8. **Wait step action, "What to wait for".**
   - It expands to the existing would-help content in plain words, the seen sale price (decision 3), and the availability or lock reason where one applies.
   - New wording covers four cases: normal price only, not in the store now, only during events, and locked.
9. **Smaller calls.**
   - "Show me" on the hero expands inline.
   - The Advanced menu has one "Graphs" entry, keeping today's Network/Decision switch.

## Left to the builder

- Exact spacing, sizes, gradients and animation timings within the cockpit direction shown in the mockups (`.superpowers/brainstorm/…/style.html`, option 1).
- Component internals and file layout under `app/src/lib/`.
- Whether Prices lives in Store or under Advanced.
- How the "8 steps you already own" collapsing groups steps.

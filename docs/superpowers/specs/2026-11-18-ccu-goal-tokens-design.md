# CCU planner: goals start from LTI tokens, shared planning, CCU Game import

Date: 2026-11-18. Status: draft for approval.
Builds on: `2026-11-18-ccu-ui-redesign-design.md` (merged to main as 4e6677e).

## Why

A goal today is a fixed pair, "Pulse → Galaxy". That isn't how the user plans. A goal is **the ship I want**, and you reach it by upgrading **any cheap LTI ship you own**: a "token". Upgrading keeps the highest insurance, so an LTI token gives the target ship LTI.

Each token can be used for only one goal. In CCU Game, each saved chain therefore starts from a different Pulse or Cutter Rambler pledge. Today the planner neither knows this nor plans goals together by default.

## Goals

1. **The goal model:**
   - A goal is a target ship plus a start.
   - The start is either **any LTI token** (the default) or **a fixed start ship** (the exception, for example "upgrade this Carrack to an Odyssey").
2. **Tokens:**
   - **Default pool:** owned standalone ship pledges that come with Lifetime Insurance, for a ship whose normal store price (MSRP) is at most **$80** (user decision 2026-11-18).
   - The $80 limit is a setting.
   - **Overrides on each pledge in the Hangar:**
     - "Use as token" (also for a bigger ship);
     - "Never use as token" (for a ship you want to keep).
   - **Overrides on a goal:**
     - choose a specific token;
     - or switch to a fixed start ship.
3. **The planner picks tokens:**
   - It picks the token that gives the cheapest route. When routes cost the same, the cheaper token wins (less of your hangar value spent).
   - A token is used by only one goal, and so is each CCU copy. Accepted routes keep their token.
4. **Shared planning is the default:**
   - Goals are planned together, by priority.
   - Accepted routes keep their CCUs, credit and token. The other goals are planned on what is left.
   - Today and Goals show this shared result.
   - The "Share CCUs between goals" button and the separate Fleet plan view are removed. The Fleet plan's total moves into the Goals page header.
5. **No free token:** the goal shows "No free LTI token". It offers to raise the limit, mark another ship "Use as token", or pick a fixed start ship. There are no store guesses: the app has no data on which ships the store currently sells with LTI.
6. **The UI:**
   - The **target ship is the headline** on goal cards, the goal page and the Today strip.
   - The start ship is a small line under it: "from your Cutter Rambler · LTI" for a token, "from Carrack (fixed)" for a fixed start.
   - The journey's first step names the token used.
7. **Importing goals from CCU Game:**
   - In Goals, "Import from CCU Game" reads CCU Game's Saved Chains download (`saved_chains_<date>.json`).
   - **Fields used** from each chain: `name`, `fromShipName`, `toShipName` and `options.optimizationTarget`.
   - **Matching:** ship names are matched exactly against the catalog plus aliases. A name that doesn't match is shown so you can pick the ship by hand.
   - **Start:** a chain whose start ship is in the token pool becomes a token goal. Any other start becomes a fixed start, so Carrack → Odyssey stays fixed.
   - **Mode:** `longTerm` maps to "Wait for sales when it saves money". Anything else maps to "Get it as soon as possible".
   - **Skipped:** a goal for the same target, with the same kind of start, that already exists.
   - **Preview:** new, skipped and needs-a-ship rows are shown first; nothing is saved until you confirm.
   - **Not imported:** CCU Game's step lists and prices.
8. **Existing goals:** those whose start ship is in the token pool become token goals, which covers today's three Pulse goals. Carrack → Odyssey stays fixed. An accepted route keeps its CCUs; its start pledge is recorded as its token when the hangar shows one.

## Non-goals

- No new RSI traffic and no RSI write actions. Melt, gift, buyback, apply and the cart stay untouched.
- No guess about which ships the store sells with LTI.
- No change to how routes between ships are priced. Watch/finish modes and the all-in objective stay as they are.
- No CCU Game account linking. The import is a file you download.

## Anti-goals

- Two goals silently counting on the same token or the same CCU.
- A ship you fly being used as a token without being marked.
- Showing a goal as reachable when no token is free.

## How it gets built (approach)

**Chosen: tokens are owned copies on a virtual start node.**
- The route search gets a virtual source ("any token"), with one edge per token ship type.
- Each edge carries that type's token pledges as copies. Each copy has copyId `token:<pledgeId>`, costs $0 cash, and its basis is its paid value.
- This reuses the existing copy machinery: `excludeCopies`, `reservations`, `proposeFleet`'s `used` set and accepted-route storage. One-token-per-goal and accepted-route reservations then work the same way as for CCU copies.
- A fixed-start goal searches from its ship exactly as today.

Alternatives considered:
1. **One search per token type, take the best.** Simple, but slower: up to N searches per goal. It also needs separate reservation logic for tokens.
2. **Assign tokens first, then plan each goal from its token.** Greedy: a goal can get a token that makes its route worse than another free one would.

## Data

- **Goals:** each goal in `plans.json` gets `start: {kind: 'token'} | {kind: 'token', pledgeId} | {kind: 'ship', ship}`.
  - The old `base` field is migrated on load (rule in Goals 8), in both stores' readers.
  - The Rust store treats plans as opaque JSON with rev checks, so only the JS reader migrates. A test pins it.
- **Token settings:** `plans.json` `profile.tokens = {limitCents: 8000, use: [pledgeId…], never: [pledgeId…]}`. These are user settings, saved rev-checked like the rest of plans.
- **Source of tokens:** read from `hangar.json`: ship pledges (not packages) whose insurance item is "Lifetime Insurance". The ship comes from `pledgeView`, and MSRP from the catalog.
- **CLI:** `add`/`propose` accept `--start token|<ship>`. The default for `add` becomes `token`. The CLI's wording stays the same except for the new start line.

## Checks

- Unit tests:
  - token pool, including overrides and the limit;
  - multi-source search picks the cheapest route, and the cheaper token on ties;
  - one token per goal across the fleet;
  - accepted routes keep their token;
  - "no free token";
  - migration of `base`;
  - the import parser on a trimmed copy of the real export: 9 chains, giving 4 skipped, 5 new and 1 fixed.
- Existing tests stay green; proposeFleet and Today tests are updated where shared planning changes the results.
- A browser check on a scratch copy of the data and a `tauri build --debug`.

## Left to the builder

Exact UI layout of the override controls and the import preview, and file split under `app/src/lib/`.

## Facts from the user's data (2026-11-18)

- **Owned LTI ships:** 3× Pulse ($30), 4× Cutter Rambler ($50), MPUV Tractor ($40), UTV ($40), Ursa Medivac ($60), Polaris (upgraded), F8C Lightning and Odin (not in the catalog).
- **Default pool at $80:** 3 Pulse, 4 Rambler, MPUV Tractor, UTV and Ursa Medivac, 10 tokens. 8 token goals need tokens.
- Ground vehicles stay in the pool; if no CCU leads from them, the search simply never picks them.

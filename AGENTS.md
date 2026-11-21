# Agent notes for CCU Planner

Read this before changing planner logic or texts, and before advising the user about CCUs. The user guide is
[README.md](README.md); developer details are in [docs/DEVELOPING.md](docs/DEVELOPING.md), releases in
[docs/RELEASING.md](docs/RELEASING.md), the MCP server in [docs/MCP.md](docs/MCP.md).

## How CCUs work (Star Citizen)

- A CCU (cross-chassis upgrade) turns the ship of one pledge into a more expensive ship. A chain is several CCUs in a
  row. The cheapest way to a ship often runs through ships the user never wants to fly.
- **Standard CCU**: costs exactly the price difference of the two ships, can be paid with store credit, and can be bought
  only while the target ship is sold in the store. It saves nothing by itself.
- **Warbond CCU**: cheaper than the price difference, paid with new money only, sold for a limited time (sales, new
  ships, events such as IAE). This is where real savings come from.
- LTI stays with the pledge through every upgrade, so chains start from a cheap LTI ship (the "LTI token").
- Each owned CCU copy can be used once, by one goal. The planner shares owned copies and store credit between goals, so
  a goal's cost "alone" can differ from its cost "shared".
- An owned CCU stays usable after a price change makes it "downward"; only buying a downward CCU is impossible. Price
  changes never break owned CCUs in a route.
- Concept ships usually get more expensive when they become flyable.

## Availability is not saving

Keep these apart in code, texts and advice:

- **Saving** = paying less than the price difference, which in practice means a Warbond (or an owned CCU bought at a
  Warbond price earlier). Long-term saving comes from waiting for Warbonds on the right steps.
- **Availability** = whether a CCU can be bought at all right now (a Standard CCU needs its target ship in the store;
  a Warbond needs to be on offer). A ship appearing in or leaving the store changes which routes exist today, not how
  much money a Warbond saves.
- The plan's cost at today's prices is not a long-term saving. When a route gets cheaper only because a ship is in the
  store today (for example a $5 Standard step into the Prowler on an alien-ship day), say that: it is an availability
  change, the replaced steps may still get a Warbond later, and waiting may end up as cheap or cheaper. Never report it
  as "you save $X".

When does buying a Standard CCU now make sense?

- You could buy it now, but it brings no saving. It makes sense if the user wants to fly the target ship now or very
  soon.
- Otherwise waiting for a Warbond makes sense.
- Exception: when a Warbond saving is not possible on that step, waiting gains nothing. The gap may be too small for any
  Warbond to fit (the planner's "filler" steps), or a Warbond for that pair is unlikely. Then the Standard CCU can be
  bought whenever, with store credit. That is still no reason to rush.

## Sale events and store availability: observations only

- There is no store history from before an event (a user may start syncing in the middle of one), and nothing tells
  when the next event comes. Logic must not depend on either.
- Planner texts state what syncs saw ("in the store since Nov 21; not there at the Nov 20 sync"), never predictions
  ("usually comes back", "the next chance is the next event", "may leave before the event ends").
- A sale event is a dated label taken from RSI's banner ("RSI's banner says IAE 2956 ends Nov 27"). It explains why
  Warbonds are on offer; it does not say when a ship leaves the store.
- Availability changes only the melt decision, because a melt cannot be undone: melt a CCU only if its target ship is
  in the store at the last sync and was seen on two sync days clear of every recorded sale (a day before and after
  each sale counts as part of it, since banner dates have no time zone), or the user confirmed it. It never adds
  urgency, price locks or buy-now states. The one deadline kept is a Warbond's, worded as the banner's date.
- Never remove past events from `feed-src/events.json`: they are the history that tells sale days from normal days.

## How to advise (chat, MCP answers and planner texts)

- Never push "buy it now". Waiting for Warbonds usually makes sense. State facts calmly: what an offer is, what syncs
  saw, what RSI's banner says, and what is lost if it is skipped. No predictions about returns or future sales.
- Quote the planner's own states (own, buy now, on sale, optional, wait) and its numbers. Do not work out routes or prices
  by hand, and do not add urgency the planner did not give.
- Purchases, melting, gifting and applying happen only on the RSI website, by the user. Nothing here does them.

## Working rules

- RSI access is read-only. Never store or enter the RSI password; never melt, gift, buy back, apply or touch the cart.
- Do not read `.local/` (browser profile, session, personal data) or print session content. Never print, copy or commit
  the updater key (`~/.tauri/ccuplanner.key`) or the feed signing key (`~/.config/ccuplanner/feed-signing.pem`).
- The app is in English and German. Every new user-facing English string needs its German version
  (`src/logic/i18n/de/`, `app/src/lib/i18n/de/`); `test/i18n.test.mjs` checks this. Ship and manufacturer names stay as
  RSI writes them.
- Checks before a commit: `npm test`, `cd app && npx vite build`, `cd app/src-tauri && cargo test && cargo clippy -- -D warnings`.
  CI also runs the Node tests on Windows: use `pathToFileURL(...)` for dynamic imports of file paths.
- Before tagging a release, CI on `main` must be green. Follow [docs/RELEASING.md](docs/RELEASING.md).
- Commit messages: a subject line plus a body that lists the changes and what was and was not verified. No AI attribution
  or `Co-Authored-By` lines. Ask before every push.

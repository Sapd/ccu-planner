# Developing the CCU planner

The user guide is the [README](../README.md). This page is for developers: setup, tests, the CLI and its
sections, the desktop app's internals, the RSI endpoints used and the safety rules. Related docs:
[privacy](PRIVACY.md), [releasing](RELEASING.md). MCP server: see docs/MCP.md.

Personal Star Citizen CCU planner. The CLI is a read-only RSI client plus the planner on top of it.

## Setup

```bash
npm install
npm run login      # opens Chrome; you log in to RSI yourself (incl. 2FA)
```

The login is kept in `.local/profile`. `npm run session` refreshes the session
(cookies + CSRF token) from that profile without a window; the client does this
by itself when RSI answers 401/403.

## Sync

```bash
npm run sync -- catalog            # 243 ships, msrp, account currency
npm run sync -- upgrades           # every valid upgrade target + offers per source ship (~4 min)
npm run sync -- upgrades --from 234,266
npm run sync -- hangar             # incremental: page 1 only if nothing changed
npm run sync -- hangar --full      # all pages; marks pledges that disappeared
npm run sync -- buyback [--full]
```

A full hangar/buyback sync runs automatically when the last one is older than 7
days. RSI ignores `pagesize` and always returns 10 entries per page.

Output: the shared app data folder (see below) (`catalog.json`, `upgrades/<fromShipId>.json`,
`hangar.json`, `buyback.json`).

## Plan

```bash
npm run sync -- details             # once: offer titles + item IDs for exact CCU mapping (~2 min)
node tools/plan.mjs --status      # data freshness, CCUs needing review
node tools/plan.mjs --from Pulse --to "600i Explorer" [--credit 50] [--k 3] [--max-steps 25]
npm test                              # node --test "test/**/*.test.mjs": planner tests incl. brute-force comparison
```

The planner (`src/logic/planner.mjs`) is pure: ships are nodes, edges are owned CCUs
($0, one copy per route), standard offers (credit allowed) and Warbond offers
(cash only). It minimizes new cash = warbond + max(0, standard - credit), then
prefers reusing owned copies, fewer steps and fewer purchases. Hangar CCUs are
mapped to ships by exact item ID (offer details), reviewed aliases
(`src/logic/aliases.json`) or exact name; anything else is listed for review.

## Chains and reservations

```bash
node scripts/chain.mjs add --to "600i Explorer" --priority high   # start: any LTI token (default)
node scripts/chain.mjs add --to Odyssey --start Carrack            # fixed start ship (--from is an alias)
node scripts/chain.mjs show c1          # proposals vs accepted route
node scripts/chain.mjs accept c1        # reserves the route's CCU copies
node scripts/chain.mjs list             # status (OK / REPRICED / BLOCKED), start line, diffs, "$X more than on its own: <goal> uses ..."
node scripts/chain.mjs fleet [--accept] # plan all chains by priority (same priority: cheapest total), sharing CCUs and credit
node scripts/chain.mjs changes          # what changed since the last sync (plan-snapshots.json, written by sync)
node scripts/chain.mjs credit 50        # store credit pool for planning
node scripts/chain.mjs release c1 | remove c1
```

A goal is a target ship plus a start. By default the start is **any LTI
token**: an owned standalone ship pledge with Lifetime Insurance whose store
price is at most $80 (`profile.tokens.limitCents`, default 8000). Upgrading
keeps the highest insurance, so the target gets LTI. Each token serves one
goal; the planner picks the token that gives the cheapest route, and the
cheaper token on a tie. In the Hangar you can mark a pledge "Use as token" or
"Never use as token". A fixed start ship is the exception (Carrack → Odyssey).

Goals are always planned together, by priority: accepted goals keep their
CCUs, credit and token, and the others are planned on what is left. Goals with
the same priority are ordered so that the total stays low (most goals with a
route first, then least cash, then least all-in; the creation order stays unless
another order is strictly better).

Every goal also has a cost **alone**: its best route if no other goal took
anything. When the shared plan costs more, the goal says by how much and which
goals hold the CCUs, token or credit its alone route would use, and the buy
steps that exist only for that reason say "Needed because ...".
Each sync stores the shared plan in `plan-snapshots.json` (newest 30); Today
shows "Since last sync" with the total change and the cause per goal.

State lives in `<data>/plans.json`. Each owned copy belongs to at most one
accepted chain; proposals for other chains plan around it and say what a
release would save. Credit is one pool: accepted chains commit what they use.
Accepting re-checks claims (conflict instead of overwrite), and a write is
refused if the file changed during the command. `--data <dir>` on any `chain`
command uses another data directory for that run (same as `CCU_DATA`).

### Waiting for Warbonds (`watch`, the default) vs `finish`

```bash
node scripts/chain.mjs mode c1 finish   # or watch
npm run sync -- upgrades                # daily during sales: records offers that appeared/disappeared
node scripts/chain.mjs refresh          # what changed per chain since the last refresh
node scripts/chain.mjs warbonds [--hours 24] [--gone]   # new Warbonds and which chains use them
```

Warbonds are sale offers and disappear; Standard upgrades stay available at
the msrp difference. So a `watch` chain splits its best route into "buy now"
(the Warbond steps of that route) and "later" (Standard bridges a future
Warbond may replace). Each upgrades sync appends to
`<data>/offer-history.jsonl` and fetches titles only for available SKUs with a new
appeared event and no known title. History uses whole-line O_APPEND writes and
fsync before recording a resume checkpoint. A crash can leave a torn final line;
the loader skips it, and the next append separates it from new complete lines.

Most Warbonds stay on sale for weeks, so "buy now" is split by urgency
(`src/logic/urgency.mjs`). **Buy now** is a step whose offer may end soon: the
SKU is a limited-time offer (ignored while RSI flags half of all offers or more,
which it does during event sales), it first appeared today or yesterday during a sale
event, the sale event ends within 2 days, or waiting would cost money (a "buy
before the price changes" alert with a saving). **On sale** (no rush) is every
other Warbond; it shows "on sale since" (first seen in the offer history) and
the sale's end when an event is entered. **Optional** is a price lock: a bet,
shown with its trade. Tell the planner what you know about one offer with
`chain offer <from> <to> <YYYY-MM-DD|soon|clear>` (or on Today): a day more than
2 days ahead moves it to no rush, "soon" to Buy now; it is stored per pair in
`price-overrides.json` (`pairs`). `chain list` prints the three groups per goal.

### Which Warbonds would help (`wanted`)

```bash
node scripts/chain.mjs wanted [c1] [--top 12] [--slack 10]
```

Which Warbonds RSI offers next cannot be known, so this predicts nothing. It
lists, per watch chain, pairs A -> B without a Warbond today and the price
below which one would make the chain cheaper: "any discount helps" (it would
replace a Standard bridge of an equally good route) and "needs N% off" (a
bigger step that skips part of the route). During a sale, compare new
Warbonds against this list. Each threshold is exact for the chain as planned
(objective, credit, CCUs reserved by other chains): the planner is re-run with
the pair added at $0. A Dijkstra estimate only picks which pairs get checked.

It also lists Warbonds on sale today that are not on the best route but on one
costing at most `--slack` more. They vanish when the sale ends; an unused one
melts back to its price as store credit, which the chain's later Standard
steps can use, so holding one mostly costs flexibility, not money.

### Concept ships

RSI's catalog marks ships as `Concept` (23 today; 9 of them, like the Odyssey,
are not on sale at all). Their price rises before release, by an amount nobody
knows yet. Without an expected price from you (`chain price`), the planner:

- never offers a CCU into a concept ship for melting;
- flags a Standard step into one as "buy before the price rises";
- for a target RSI sells no upgrade into, `wanted` lists the upgrades that
  would create a route (up to today's msrp difference, Standard included);
- `chain warbonds` lists any upgrade into a concept ship that appeared, and
  what is on sale now into concept targets of your chains.

### Locking the target while waiting

```bash
node scripts/chain.mjs lock c4 auto   # default; or on / off
```

A CCU fixes the price difference when you buy it, so a later rise of the
target does not reach you. With `lock` a waiting chain buys its last step into
the target now instead of later: `auto` does this when the target is a concept
ship or you set a higher expected price, `on` always. A last step that is a
CCU you own or a Warbond already locks it. A Standard last step can be paid
with store credit, and `melt` counts it as Standard spend, so CCUs that save
nothing can be melted to pay for it without new money. Locking fixes the ship
the last step starts from; the bridges before it still wait for Warbonds.

### Melting unused CCUs

```bash
node scripts/chain.mjs melt [--protect 123,456] [--all]
```

Candidates: not reserved, meltable, no saving against today's Standard price
for the exact pair, rebuyable today, no extras (insurance, paint). The plan
only melts to cover the Standard purchases of `finish` chains beyond the
credit pool, keeps one copy per pair where possible, and counts the credit
once. Warbond steps always need new money. Melting itself is done on RSI.

### Expected prices and the all-in objective

```bash
node scripts/chain.mjs price Prospector 175 --note "announced increase"
node scripts/chain.mjs prices                 # overrides and how many Standard offers they change
node scripts/chain.mjs price Prospector --clear
node scripts/chain.mjs objective c1 allin     # or cash (default)
node tools/plan.mjs --from Pulse --to Galaxy --objective allin
```

An expected price is your assumption, stored in `<data>/price-overrides.json`
and never mixed into the synced RSI data. Standard upgrades touching that ship
are recomputed as the msrp difference; Warbonds keep their quoted price. It
changes three things: a CCU that would save money after the change is never a
melt candidate; `list`/`show` warn "buy before the price change" for Standard
steps that get more expensive (or disappear) and only while waiting really costs
that goal money: the goal is planned again at the expected prices, once without
and once with all the route's affected steps bought now (cash, or all-in cost for an `allin`
goal), and the warning shows the difference ("waiting
costs $X more", or "waiting leaves no route"); when another path costs the same,
there is no warning; the "later" Standard amount is shown at both prices. Routes themselves are still planned at today's prices.

`cash` minimizes new money and uses owned CCUs freely. `allin` minimizes new
money + what the owned CCUs it consumes cost you (their melt value), so it
keeps an expensive CCU when a cheaper purchase does the same job. All-in
excludes the base ship; CCU Game's "melt" figure includes it.

Not yet: buyback offers, insurance requirements, pack slots, pinned steps,
fleet rebalance that weighs both sides of a release, scheduled daily sync.

## Desktop app

`app/` is a Tauri 2 + Svelte 5 desktop app on the same planner logic
(`src/logic/`). The desktop app signs in and syncs directly without Node,
Chrome, Playwright or sharp. The CLI remains available for development.

```bash
cd app
npm install
npm run tauri dev                  # development window
npm run tauri build -- --debug     # src-tauri/target/debug/bundle/macos/CCU Planner.app
npm run dev                        # browser-only UI on a data folder: CCU_DATA=/path npm run dev
```

**Sections.** The top bar has four sections plus an Advanced menu:

- **Today** answers "what should I buy today" without a click: a headline
  ("Today: buy 1 upgrade · $5" or "Nothing to buy today", counting only the
  Buy-today group), then the buy list in three groups, always open: **Buy
  today** (green), **On sale, no rush** (blue) and **Optional** (price locks,
  with the trade in one line and a one-click "Don't lock this goal"). One row per
  upgrade across all goals: "For Orion → · Warbond", the pair, "$5" with "Standard is
  $20" under it and a "Buy on RSI" link; a pair two goals need says "buy 2" (a
  single copy says nothing).
  Warbonds are cash only, Standard upgrades accept store credit (your credit is
  shown). A row has "Runs until…" and "Ends soon" for what you know about the
  offer. When nothing is urgent the list ends with "That's everything on offer. None
  of it has to be bought today." (or "No goal needs a purchase today."), or "That's all for today.". Below it: what
  waits for a sale; its heading opens the same compact goal list the Goals tab
  shows (the full table lives only there). When no sale price has been seen yet, a
  goal shows an estimate range from your own Warbond history.
- **Goals** are the ships you want. Each goal shows its upgrade steps with a
  state: **own** (grey, you already have it), **buy now** (green; blue when it is on sale with no rush) or **wait**
  (purple, usually cheaper during a sale). The target ship is the headline;
  the small line under it names the start ("from your Cutter Rambler · LTI"
  or "from Carrack (fixed)"). Goals are planned together by priority (goals with the same priority are ordered so that the total stays low), so two
  goals never count on the same CCU or token; goals are listed in planning order under a heading per priority level, one row
  per goal (picture, name with its start, new cash left, one bar and one chip for its most urgent state), the header shows the total for
  all goals today with its change since the last sync, and "Reserve all chains". A goal's own view shows its picture strip, one
  money line, the next step, the chain (each row opens its details) and one "More" fold with how the total adds up, the
  reservation, the settings and the other ways. A cheaper chain for a reserved goal is one banner with Compare and Switch. "Import from CCU Game" reads the
  Saved Chains file you download from CCU Game (name, start and target ship
  only), shows new / already a goal / needs a ship, and adds nothing until
  you confirm.
- **Quick search:** long lists (Hangar, Worth melting, Store, Prices, and
  Goals with more than six goals) have one search box. Press `/` to jump to
  it, Esc to clear it; every word must match.
- **Hangar** lists your pledges and what melting them would give.
- **Store** holds the current sale events and Warbond prices.
- **Advanced** has the Upgrade map (the graphs), Compare routes (the plan
  explorer) and Price assumptions (expected prices and ship availability).
- **Help** (top bar) has "How CCUs work" (the three-step tour) and
  "Look up a term" (the glossary).

Each goal leads with **New cash still needed** (the money left to pay at
today's prices, after the upgrades you own and any store credit) and shows
**Direct upgrade at list value** in the goal's "More" fold as a comparison only. When sale
prices were seen, **New cash if the sales come back** follows; otherwise an
estimate is labelled as such and explained under "How this estimate works".
The "?" in the top bar reopens the short "How CCUs work" explainer shown on
first start.

**Sign in and sync.** Open **Sync → Sign in to RSI**. Sign in yourself, including
2FA, in the separate private RSI window. The app does not read your password. Once the
session is verified, the window closes and the cookies are kept in your OS
keychain (service `eu.sapd.ccuplanner`, account `rsi-session`), never passed
to JavaScript. Only RSI-namespace and Cloudflare access cookies are retained;
other webview cookies, including analytics and preferences, are discarded. Large sessions are split into
keychain records of at most 1,200 UTF-16 units to fit Windows Credential Manager.
Unchanged credentials are not rewritten; save failures are logged without hiding
the RSI response. **Sign out** deletes that session and clears the login webview's
browsing data. If RSI rejects the session, the app shows **Sign-in expired** and
offers sign-in again. A 403 alone reports “RSI refused the request (403)”; it marks
the session expired only when a separate hangar probe redirects to sign-in.

Choose **Hangar (fast)** for your pledges, **Buyback** for buyback entries, or
**Store (about 4–5 min)** for catalog, upgrades, offer details and sale/Warbond
history. Progress and **Cancel** appear in the top bar. Cancellation finishes
the current request; the next Store sync resumes after the last completed
source ship, within the same local day and 24 hours of its start. Older checkpoints
are discarded. The progress text reports where a resumed sync starts. CLI `--full`
starts again. A second Ctrl-C exits immediately. Data reloads automatically on completion.
For a full hangar sync, when at least 10 active pledges were known, a result below
half that count asks “RSI returned N of M pledges. Overwrite anyway?”. Declining
keeps the saved file. CLI `--force` explicitly allows the replacement. Smaller
hangars skip this check. Buyback has no size floor: redemption and expiry can
legitimately remove most or all entries. After opening a Buy on RSI link,
the notice offers **Bought it? Sync hangar**. No app action buys anything on RSI.
The always-visible Store/Hangar timestamps turn amber when Store data predates
today. A fresh installation can use Sync above the optional import screen.

**One data folder.** Desktop and CLI now use the same default:

- macOS: `~/Library/Application Support/eu.sapd.ccuplanner/data`
- Windows: `%APPDATA%\eu.sapd.ccuplanner\data`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/eu.sapd.ccuplanner/data`

`CCU_DATA` overrides the folder; use an absolute path. The Vite dev server
requires `CCU_DATA` and runs the Node CLI as a child process, with progress
polling and graceful cancellation (stdin control messages on Windows). Its Sign in action uses the existing CLI
Chrome/Playwright login; its session remains separate from the desktop keychain.
No Node executable or sidecar is used for desktop sync.

**Move old data yourself.** If `<repo>/.local/data` exists and the default folder
does not, the CLI stops and tells you where to move it. It never moves or copies
anything automatically. Close the app and other CLI processes, create the
parent folder, and move the entire old `data` folder into the location above.
For example on macOS, from the old checkout:

```bash
mkdir -p "$HOME/Library/Application Support/eu.sapd.ccuplanner"
# Only if the destination data folder does not already exist:
mv .local/data "$HOME/Library/Application Support/eu.sapd.ccuplanner/data"
```

Alternatively set `CCU_DATA` to the existing folder. If both folders already
exist, choose the one to keep and back them up before merging anything manually.
The optional import screen copies only the files you explicitly select by
folder and preserves editable documents already present in the destination.
CLI goal commands also accept `--data <dir>`.

Saves are revision-checked. When the CLI changed a file while the app was
open, the app's next save is refused, it reloads and says "Changed outside the
app; reloaded. Do it again."

**Signed data feed.** `.github/workflows/feed.yml` runs hourly (`17 * * * *`, also by hand) and publishes
`https://sapd.github.io/ccu-planner/feed/` with `actions/deploy-pages` (an artifact deployment: nothing is committed). The Pages
site is a project site with build type "workflow" (`gh api -X POST repos/Sapd/ccu-planner/pages -f build_type=workflow`).
`node scripts/build-feed.mjs --out DIR --key PEM [--cache DIR] [--events FILE] [--no-catalog] [--no-images]` builds it (src/feed-build.mjs):
`feed/events.json` from `feed-src/events.json` (the hand-maintained sale events: edit that file and push; dates are YYYY-MM-DD,
validated strictly), `feed/store-catalog.json` from the anonymous catalog sync (the same code as `sync-catalog`, only new pictures
downloaded because `--cache` keeps the last run's catalog and `images/catalog/*.webp`; the workflow keeps that folder with
`actions/cache`), `feed/images/catalog/<id>.webp`, and `feed/manifest.json` (schema, generatedAt, sha256 and size of every file) with
`manifest.json.sig` = base64 ed25519 over the exact manifest bytes. If RSI fails or answers much smaller, the previous catalog is
published again; without one the feed just has no catalog that hour. The cache is untrusted (it is restored from `actions/cache`, and what
is in it gets signed): `src/feed-cache.mjs` deletes everything that is not a decodable WebP of at most 480 px or a valid public catalog
whose picture names are `catalog/<its id>.webp`, `src/feed-build.mjs` checks every picture again before signing, and the cache key carries
a hash of the workflow and of that code. The private key is the secret `FEED_SIGNING_KEY` of the GitHub environment `feed` (deployments
from `main` only), in the env of the one build step; it is PEM, not the updater key, and the build refuses a key that does not match
`src/feed-public-key.json`, which both the Node and the Rust code embed. Rotation: see docs/RELEASING.md, "Rotating a key".
Replay: a client refuses a manifest older than `src/feed-floor.json` (moved by `npm run version`), older than the newest one it ever accepted
(`<data dir>/feed-seen.json`, kept outside `feed/` so wiping the cache does not reset it) or older than the saved copy; a feed more than 30 days old is
shown as stale (a note on the Store page's sale events, `stale` in the refresh result) and its data is still used. Clients: `src/feed.mjs` (Node: dev server, MCP, `node scripts/feed.mjs [--force] [--images]`) and
`app/src-tauri/src/feed.rs` (desktop; the webview only calls `feed_refresh`, `feed_images`, `feed_read` and never fetches the feed
itself, so the CSP stays closed). Both verify the signature, then every file's sha256, write atomically into `<data dir>/feed/`
(manifest last) and keep the last good copy; pure rules (manifest shape, merging sale events, choosing the catalog) are in
`src/logic/feed.mjs`. Test a feed locally: `node scripts/build-feed.mjs --out /tmp/site --key ~/.config/ccuplanner/feed-signing.pem`,
`python3 -m http.server -d /tmp/site 8099`, then run the dev server, or `node scripts/feed.mjs --dev`, with
`CCU_FEED_URL=http://localhost:8099/feed` and an empty `CCU_DATA`. `CCU_FEED_URL` counts only in the dev server, with `--dev` and under
`NODE_ENV=test`, and only for `http://localhost` / `127.0.0.1`; the CLI without `--dev` and the MCP server ignore it, and release builds of the
app never read it.

**Store catalog.** `npm run sync-catalog` (`node scripts/sync-catalog.mjs [--anonymous | --signed-in] [--dry-run] [--no-images] [--data DIR]`)
reads RSI's store listings for the Store page's Browse store tab with the one pinned browse query
(`src/sync/catalog-query.mjs` + `catalog-query.json`, allowlisted in `src/sync/policy.mjs` and in Rust `validate_request`).
RSI returns the Subscriber store, Concierge (`isVip`) items and the account's full ship/paint listings only to a signed-in
account, so the script uses the saved session when there is one (RsiClient, sync lock) and otherwise the public path (no
cookies); `--anonymous` forces the public one. A saved signed-in catalog is never replaced by a public one. Output
`store-catalog.json` (atomic) with `signedIn`, per listing `{ expected: totalCount, got }`, and the dropped entries; an
empty, much smaller (under 70 %) or category-less result keeps the saved file. Pictures: one small WebP per item in
`images/catalog/<id>.webp`, anonymous, RSI hosts only. The public listing is smaller than the signed-in one (193 vs 212
ships, 395 vs 463 paints on 2026-11-20): that is RSI's own `totalCount`, not dropped entries. The desktop app runs the same
reading code (`src/sync/catalog-fetch.mjs`, core command `store-catalog`) through its session (Rust attaches the cookies,
allowlist mirrored in `rsi.rs`) and caches pictures with `rsi_cache_catalog_image` as `images/catalog/<id>.<format>`.

**Pictures.** `node scripts/sync-images.mjs` downloads each ship's public
store picture once and stores small and large WebP copies in
`<data>/images/`; the app shows only these local files. In the desktop app,
**Sync → Ship pictures** instead downloads the public originals from RSI's image
host as `<id>-original.<format>`, without sharp or image conversion. These larger
files are cached once and used for both picture sizes. Public image requests
carry no session cookies and refuse redirects to other hosts.

**Sale events.** Melt suggestions and "buy later" steps treat a ship as
regularly on sale only after syncs saw it on sale on at least 2 days, 7 or
more days apart, outside every sale event you entered on the Store page (for
example IAE). Enter the current event, or mark ships regular yourself.

**Sample data.** "See an example first" runs the planner on `app/src/lib/sample-data.json` through an in-memory
backend (`view/sample.mjs`); it never reads or writes the data folder. Rebuild the file from the test fixture with
`node scripts/build-sample.mjs` (a test fails when it is stale). The Glossary text is `src/logic/glossary.mjs`.
Money text comes from `money()` in `src/logic/format.mjs`, driven by the catalog's `app.pricing`; accounts that pay
in a currency other than USD are refused (app banner, CLI exit code 1). The desktop sync records the same plan
snapshots as the CLI (`app/src/lib/plan-snapshot.js`).

## RSI endpoints used

| Data | Endpoint |
| --- | --- |
| Ships, msrp, currency | `POST /pledge-store/api/upgrade/v2/graphql` `initShipUpgrade` |
| Upgrade targets + Standard/Warbond offers | same, `filterShips(fromId)` |
| Offer details (insurance, limited) | same, `getShipDetails(id, fromShipId)` |
| Upgrade tool context | `POST /api/ship-upgrades/setContextToken` (header `x-rsi-token` = `Rsi-Token` cookie) |
| Hangar | `GET /en/account/pledges?page=N` (HTML; CCUs carry `js-upgrade-data` JSON with exact item IDs) |
| Buy back | `GET /en/account/buy-back-pledges?page=N` (HTML) |

GraphQL calls need the `x-csrf-token` header from `<meta name="csrf-token">`.

## Safety

- Read-only: the client only allows GET on hangar/buy-back pages and
  allowlisted GraphQL queries; mutations (cart, apply, gift, melt) are refused.
- No password is stored anywhere. `.local/` (profile, session, data, captures)
  is gitignored; `session.json` is mode 600.
- Requests are spaced 1 s apart.

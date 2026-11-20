# Privacy

Not affiliated with Cloud Imperium Games or Roberts Space Industries. Star Citizen® is a trademark
of Cloud Imperium Rights LLC. This is an unofficial fan tool.

The planner keeps everything on your own computer. It has no account system, no server of its own
and no telemetry: it does not send usage data, crash reports or analytics anywhere. The only
network traffic it causes is requests to `robertsspaceindustries.com`, made by the sync commands
you run yourself, and, in the desktop app, the update check and the data feed check (both below). This document describes the state of the code today.

## What is stored, and where

### Planner data (the "data folder")

JSON files: the ship catalog and prices, your hangar and buy-back pledges, upgrade offers, your
plans, your price overrides, sale history, and the downloaded ship pictures in `images/`
(`<id>-s.webp`, `<id>-l.webp`). Your hangar includes pledge names and IDs from your RSI account.

- **Desktop app:** the `data` folder inside the app's data directory, named after the app
  identifier (`eu.sapd.ccuplanner`; builds before 0.1.1 used `com.ccuplanner.desktop`, and the app moves that folder on first start when the new one has no planner data; if both hold planner data nothing is moved, the new one is used and a one-time note names both paths):
  - macOS: `~/Library/Application Support/eu.sapd.ccuplanner/data`
  - Windows: `%APPDATA%\eu.sapd.ccuplanner\data`
  - Linux: `~/.local/share/eu.sapd.ccuplanner/data`
  The app reads and writes this folder only (`app/src-tauri/src/store.rs`). The app itself does not
  talk to RSI.
- **Command-line sync and dev server:** the same app folder as above by default (with the same one-time
  move from the old folder), or the folder in the `CCU_DATA` environment variable, which is never moved
  (`src/data.mjs`); an old `<checkout>/.local/data` is reported, not moved. `.local/` is git-ignored. This is a different folder from the
  app's one until you import it (the app's first-run screen copies an allowlist of files from a
  checkout folder; it never copies session files).

### RSI session (command-line sync only)

Syncing from RSI is done by the Node scripts (`npm run login`, `npm run session`, `npm run sync`).
Today these keep their session **inside the checkout**, in `.local/`, not in the app's folder:

- `.local/session.json`: your RSI session cookies (including `Rsi-Token`), the CSRF token and the
  browser user agent, saved with file mode `0600` (`src/session.mjs`).
- `.local/profile/`: a Chrome profile (opened by Playwright) in which you log in to RSI yourself.
  It holds everything a browser profile holds for that site: cookies, cache and local storage.

Anyone who can read those files can act as you on RSI until the session expires or you sign out on
the RSI website. The planner never sees or stores your RSI password; you type it into RSI's own
login page. Do not share or commit `.local/` (it is git-ignored) and do not zip a checkout with it
to send to someone.

### Small interface flags

The app's web view keeps two or three flags in its local storage (for example "the intro has been
shown": key `ccu.explainer.seen`, and which one-time hints you dismissed). They contain no account
data. They live in the web view's storage for the app, outside the data folder.

## What leaves your machine

Only read-only requests to `https://robertsspaceindustries.com`, from the sync commands you run:

- Page and image downloads (GET): the pledge, buy-back and ship pages, and ship pictures. Only
  allowlisted paths are requested.
- The upgrade tool's queries: a few POSTs to RSI's ship-upgrade endpoints, to set the tool's context
  token and to run its GraphQL queries to read offers and prices. The client refuses any GraphQL
  mutation and any query not on its allowlist. Nothing is bought, changed or melted.
- Requests go at most about one per second. Your session cookies are sent with them.

The desktop app also checks for updates, about 10 seconds after it starts and every 6 hours (and when you
choose "Check for updates" in Help). It makes one HTTPS GET to
`https://github.com/Sapd/ccu-planner/releases/latest/download/latest.json` (GitHub Releases), a small public file with the newest version number, its
notes and a download link. The address is fixed and carries no version,
system or user information (the app compares versions itself); GitHub sees only what any web request
carries, such as your IP address and a generic client name. No account, no cookies, none of your planner
data. If a newer signed version exists, the app downloads it from GitHub Releases. The browser version and the
command-line tools never do this.

### The data feed (sale events and a store catalog snapshot)

The desktop app, the dev server and the MCP server also fetch a small public data feed from
`https://sapd.github.io/ccu-planner/feed/` (GitHub Pages of this project, rebuilt hourly by
`.github/workflows/feed.yml`): `manifest.json` and `manifest.json.sig`, then the files the manifest lists
(`events.json`: sale events such as IAE with their dates; `store-catalog.json`: a snapshot of RSI's public store
catalog; and its pictures under `images/catalog/`, copies of RSI's own store pictures, fetched only while the app
shows the feed's catalog). The app checks on start and then at most every 6 hours; offline it just keeps what it
has and says nothing. Only plain GET requests are made, and only to that exact address (the desktop app's Rust code
refuses every other address, and the web view itself is not allowed to connect anywhere). A request carries
nothing but the file path: no cookies, no account, no version, no ids and none of your planner data; the host sees
what any web request carries, such as your IP address and a generic client name (`CCUPlanner/<version>`).

The feed is signed: the manifest has an ed25519 signature made with a key of its own (not the update key) whose
public half is built into the app (`src/feed-public-key.json`). A manifest with a wrong signature, a file that does
not match its signed sha256, a feed older than the saved copy, than the newest one this machine ever accepted or than
the release itself (a replay), or a name outside a short allowlist is refused and the last good copy stays. A feed more
than 30 days old is shown as out of date but still used. The saved copy lives in the `feed/` folder of the data folder
(`manifest.json`, `manifest.json.sig`, `events.json`, `store-catalog.json`, `images/catalog/`, `state.json` with the
time of the last check; next to the folder, `feed-seen.json` holds the date of the newest feed accepted). Delete that folder to forget the feed. Your own sale events (`sale-events.json`) are never
changed by it: the feed's events are merged in when the app starts or reads them, and yours win when they share a
name or the same dates. A signed-in store catalog of your own always wins over the feed's public one.
`CCU_FEED_URL` redirects the check to a local test server (only the dev server, the CLI with `--dev` and debug
builds; a release build of the desktop app ignores it).

Nothing else is sent to anyone else. The desktop app's web view is configured to connect only to its own
backend (see the content security policy in `app/src-tauri/tauri.conf.json`).

## How to delete everything

1. Delete the data folder (paths above). For the command-line tools also delete `.local/`
   in the checkout (this removes the session file, the Chrome profile and the checkout's data).
2. Remove the app's web-view storage, if you want the interface flags gone too: delete the
   app's folders named after the identifier under your user data and cache locations
   (macOS: `~/Library/WebKit/eu.sapd.ccuplanner` and `~/Library/Caches/eu.sapd.ccuplanner`;
   Windows: `%LOCALAPPDATA%\eu.sapd.ccuplanner`; Linux: `~/.local/share/eu.sapd.ccuplanner`
   and `~/.cache/eu.sapd.ccuplanner`). The exact web-view location is chosen by the operating
   system, so check these paths exist before deleting.
3. Uninstall the app.
4. To end the RSI session itself, sign out on robertsspaceindustries.com (this invalidates the
   saved cookies even if a copy remains).

Deleting your data does not change anything on your RSI account.

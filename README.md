# CCU Planner

A desktop app that plans your Star Citizen CCU (Cross-Chassis Upgrade) purchases. Tell it which ships
you want; it reads the RSI store and your hangar and shows the cheapest chain of upgrades, what to buy
today, and what is better to wait for.

Not affiliated with Cloud Imperium Games or Roberts Space Industries. Star Citizen® is a trademark of
Cloud Imperium Rights LLC. This is an unofficial fan tool.

The planner only reads your account. It never buys, melts, gifts or applies anything, never asks for
your RSI password and never touches your cart. You do every purchase yourself on the RSI website.

## About this project

CCU Planner is an experiment. It is meant above all for people new to CCUs: it explains each step in
plain words and tells you what to buy now and what can wait. When several goals share your CCUs and
store credit, it tries different orders of planning them to find the combination that costs least
overall. If you want, it also picks a cheap LTI ship from your hangar as the starting ship by itself.
In my own hangar it found real savings compared with the plans I had made before with the CCU Game
extension. It is open source, so you can read exactly what it does with your account, and improve it.

It is not yet clear whether I will maintain it over the long term the way the CCU Game extension is
maintained; I want to see first how much work keeping it current takes. Until then, please check its
plans against the [CCU Game](https://ccugame.app/) extension as well, especially before larger purchases.

## Install

Download the installer for your system from the project's releases page and run it (macOS, Windows or
Linux). The installers are not signed yet, so your system may warn you the first time: on macOS
right-click the app and choose Open, on Windows choose "More info", then "Run anyway". The steps for
building the installers yourself are in [docs/RELEASING.md](docs/RELEASING.md).

## First start

The first screen leads you through three steps:

1. **Sign in to RSI.** A separate window opens on the RSI website. Sign in there yourself, including
   two-factor if you use it. The app never sees your password; the session is kept in your system
   keychain.
2. **Sync store and hangar.** The planner reads the current upgrade prices (a few minutes the first time)
   and the CCUs in your hangar.
3. **Pick your first goal.** Choose the ship you want.

Want to look around first? Choose **See an example first**. It shows a few made-up ships, keeps
everything in memory and leaves your own data alone; **Leave sample data** takes you back.

## Daily use

- **Today** tells you what to buy now, what can wait for a sale, and what is optional. Each row has a
  **Buy on RSI** link that opens the RSI website; the app buys nothing.
- **Goals** are the ships you want. Each shows its chain of upgrades step by step: own, buy now, or wait.
  A waiting step either waits for a Warbond into any ship in its price range, or is a filler no Warbond
  can make cheaper (buy it whenever, store credit works). An opened owned step lists which goals use your
  other copies of that CCU. A goal's settings can make it route through a ship you pick.
- **Hangar** lists your pledges and which unused CCUs are worth melting. Under Upgrades you can mark a CCU
  "Don't use in plans", and add **virtual CCUs**: upgrades you expect to get outside the store (from a
  friend, a trade or a coming sale) at a price you give; plans use them like cash-only Warbonds.
- **Store** holds the current sale events and Warbond prices. Enter a running sale there so the planner
  knows an offer is only around for now. Its **Browse store** tab lists RSI's whole public store (Pledge,
  Subscriber, Concierge) with filters. Sync → Store catalog (or the tab's Refresh) fills it; signed in, it also
  gets the Subscriber store and Concierge items, which RSI shows only to a signed-in account.
- **Advanced** has the Upgrade map, Compare routes and Price assumptions.
- **Help** has "How CCUs work" and "Look up a term".
- Use **Sync** in the top bar to refresh the hangar (fast) or the store (about 4 to 5 minutes). Prices
  change, so sync before you decide. After you buy something, use **Bought it? Sync hangar**.
- The **?** in the top bar explains how CCUs work and opens the **Glossary** (CCU, Standard and Warbond,
  store credit, LTI, melt and the other words the app uses).
- Press `/` to search long lists.

Your data stays on your computer; see [docs/PRIVACY.md](docs/PRIVACY.md) for exactly what is stored and
which requests are made. The planner currently supports store accounts that pay in USD only.

## Ask Claude about your plan (MCP)

**Claude Desktop.** Download `ccu-planner.mcpb` from the [latest release](https://github.com/Sapd/ccu-planner/releases/latest) and open it. Turn on **Let Claude change my plan** if you want Claude to edit goals or settings. Leave **Data folder** empty to use the planner app’s data.

**Claude Code.** Download the executable for your system from the same release and save it somewhere permanent. Choose `macos-arm64` for Apple silicon, `macos-x64` for an Intel Mac, `windows-x64.exe` for Windows, or `linux-x64` for Linux. On macOS and Linux, run `chmod +x <file>` with the path to the download. The executable is unsigned. If macOS blocks your download from the release, run `xattr -d com.apple.quarantine <file>`. Windows SmartScreen may show an unknown-publisher warning.

Register it with the full path to your executable. For example, on an Apple silicon Mac:

```sh
claude mcp add -s user ccu-planner -- "/path/to/ccu-planner-mcp-macos-arm64"
```

Append `--allow-writes` to allow plan changes. By default Claude can read your goals, compare routes and try what-ifs in memory. No tool can buy, melt, gift or apply anything on RSI.

Sync in the planner app first, then ask Claude “What should I buy today?” or “What would this offer save me?” The release packages read the app’s saved data and do not sync from RSI.

**From source.** With Node.js 22 or newer, clone this repository and run `npm ci` in the checkout. Register it with `claude mcp add -s user ccu-planner -- node /path/to/ccu-planner/scripts/mcp.mjs`. Run `npm run login` there if you want the source server’s read-only RSI sync tools. See the [MCP guide](docs/MCP.md) for all tools and settings.

## For developers

Setup, tests, the command line, how the planner works, the RSI endpoints used and the safety rules are in
[docs/DEVELOPING.md](docs/DEVELOPING.md).

## Licence

GPL-3.0-only. See [LICENSE](LICENSE).

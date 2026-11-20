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

The planner comes with an [MCP](https://modelcontextprotocol.io) server, so Claude can answer questions
from your own plan: "What should I buy today?", "Why does my Liberator chain cost that much?", "Is this
Warbond in the sale worth it for me?" (paste the offer), or "What if I bought two Prowler to Carrack
upgrades for $20?". It uses the same data folder and the same planning code as the app, so its answers
match what the app shows. Sync in the app first; the server reads what the app saved.

**What you need:** [Node.js](https://nodejs.org) 22 or newer and a copy of this repository:

```bash
git clone https://github.com/Sapd/ccu-planner.git
```

```bash
cd ccu-planner && npm install
```

**Claude Code:** register the server once (use the full path to your copy; `-s user` makes it available
in every project):

```bash
claude mcp add -s user ccu-planner -- node /full/path/to/ccu-planner/scripts/mcp.mjs
```

**Claude Desktop:** open Settings → Developer → Edit Config and add this to `claude_desktop_config.json`,
then restart Claude Desktop:

```json
{
  "mcpServers": {
    "ccu-planner": {
      "command": "node",
      "args": ["/full/path/to/ccu-planner/scripts/mcp.mjs"]
    }
  }
}
```

On Windows write the path with double backslashes, for example `"C:\\Users\\you\\ccu-planner\\scripts\\mcp.mjs"`.

By default Claude can only read: it can look at your plan and goals and try what-ifs in memory. Syncing
is easiest in the app. If you want Claude to sync your hangar or the store too (read-only), sign in once
for the server with `npm run login` in your copy; the app's own sign-in is separate. To let it also change your plan the
way the app does (goals and their settings, reserved chains, store credit, virtual CCUs, LTI tokens, sale events and the other
settings), add `--allow-writes` after `mcp.mjs`. Either way it can
never buy, melt, gift or apply anything on RSI, and it never sees your password. The full list of tools and
safety rules is in [docs/MCP.md](docs/MCP.md).

## For developers

Setup, tests, the command line, how the planner works, the RSI endpoints used and the safety rules are in
[docs/DEVELOPING.md](docs/DEVELOPING.md).

## Licence

GPL-3.0-only. See [LICENSE](LICENSE).

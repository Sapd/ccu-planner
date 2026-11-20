# CCU Planner

A desktop app that plans your Star Citizen CCU (Cross-Chassis Upgrade) purchases. Tell it which ships
you want; it reads the RSI store and your hangar and shows the cheapest chain of upgrades, what to buy
today, and what is better to wait for.

Not affiliated with Cloud Imperium Games or Roberts Space Industries. Star Citizen® is a trademark of
Cloud Imperium Rights LLC. This is an unofficial fan tool.

The planner only reads your account. It never buys, melts, gifts or applies anything, never asks for
your RSI password and never touches your cart. You do every purchase yourself on the RSI website.

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
  other copies of that CCU.
- **Hangar** lists your pledges and which unused CCUs are worth melting.
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

## For developers

Setup, tests, the command line, how the planner works, the RSI endpoints used and the safety rules are in
[docs/DEVELOPING.md](docs/DEVELOPING.md).

## Licence

GPL-3.0-only. See [LICENSE](LICENSE).

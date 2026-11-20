# MCP server

`scripts/mcp.mjs` is a stdio [MCP](https://modelcontextprotocol.io) server. It lets Claude (or another MCP client) answer questions
from your own plan: what to buy today, what a goal costs alone and shared, what an offer in the CCU Game Discord means for you,
without digging through the CLI. It reads the same data folder as the app (`CCU_DATA` overrides it) and uses the same planning
code, so its answers match the app's wording.

## Safety

- **No tool buys, melts, gifts or applies anything on RSI.** The server has no such code, and it never touches the cart or buyback.
- `sync_hangar` and `sync_store` only read from RSI, through the same read-only client and request allowlist as `npm run sync`
  and the app. They need a stored RSI session (sign in once in the app or with `npm run login`); without one they say so. The
  server never asks for or accepts a password and never returns session or cookie values.
- Tools that change your plans exist **only** when the server is started with `--allow-writes`. Without the flag they are not
  listed and cannot be called. Each one saves through the same revisioned save as the app: if another app or session saved
  first, the tool returns an error and writes nothing.
- `compare_ccugame` reads only the one file you name: an absolute `.json` path of at most 5 MB. The resolved real path must not be
  inside the planner data folder or any `.local` folder. Errors are generic ("Could not read that file").
- Argument limits: text arguments at most 200 characters (the path 1024, pasted offer text 20000); amounts at most $100,000.
- The server logs to stderr only (stdout is the protocol).

## Tools

Always available, read-only:

| Tool | What it answers |
| --- | --- |
| `today` | Buy now / on sale (no rush) / optional, with counts, prices, payment and the goals each is for |
| `goals` | Every goal: status, new money to go (alone vs shared), what is to buy or wait for |
| `goal` | One goal by name or id: route step by step with the reason for each step, cost alone vs shared, who holds what it would use |
| `changes_since_sync` | How each goal's cost changed since the last sync with different data, and why |
| `what_if` | Plan again in memory with one change: `add_goal`, `remove_goal`, `buy` (N copies at a price) or `price` (a ship at a new price). Nothing is saved |
| `check_offer` | What a CCU offer means for you: `from`, `to`, `price`, `kind`, or pasted text in `text` |
| `compare_ccugame` | Your goals against a CCU Game Saved Chains `.json` file (`path`) |
| `hangar_ccus_into` | The CCUs you own into a ship and what each copy is used for |

Always listed, they only read RSI. RSI code (and with it playwright, a dev dependency) is loaded only when a sync runs, so
the other tools work without it; a sync without playwright says so.

**One sync at a time.** A sync takes `sync.lock` in the data folder (pid and start time, created exclusively; stale after 2 hours
or when its process is gone). The CLI (`npm run sync`, also the dev server's child sync), this server and the desktop app (its Rust side takes the same
file with the same rules when a sync begins and releases it when it ends) honour it; a second sync reports
"Another sync is running (started ...)". Saving a plan, overrides or sale events takes a short `.write.lock` in the same
folder (stale after 30 s, a waiter retries for about 2 s), so two processes never lose each other's revision. A cancel sent during the headless sign-in check
answers "Cancel requested; waiting for the sign-in check to finish" at once; the sync stops as soon as that check ends and
sends no further requests.

| Tool | What it does |
| --- | --- |
| `sync_hangar` | Reads your hangar (`full: true` re-reads every pledge) |
| `sync_store` | Reads the upgrade store and updates prices and offers; sends progress notifications and can take minutes (`full: true` starts over instead of resuming) |

Only with `--allow-writes`:

| Tool | What it changes |
| --- | --- |
| `add_goal` | Adds a goal (target, optional fixed start ship, priority, mode) |
| `remove_goal` | Removes a goal |
| `accept` | Reserves a goal's current best chain (holds its owned CCUs for that goal). The tool keeps its old name, `accept`, so existing setups keep working; the app and its messages say "reserve" |
| `lock` / `unlock` | Lock the price of the last step (`on` or `auto`), or never lock (`off`) |
| `set_credit` | Sets your store credit |
| `price_override` | Sets or clears the expected price of a ship (stored apart from the synced catalog) |

Ships and goals are given by name (or numeric ship id; goals also by id such as `c3`). Money in and out is US dollars. Every
result has readable text and the same data as `structuredContent`, with ship names next to ids.

`what_if` plans the whole account again and can take seconds on a big hangar; it honours request cancellation between its two
plans and allows at most 5 copies per `buy`.

## Register it in Claude Code

```sh
claude mcp add ccu-planner -- node /absolute/path/to/ccu-planner/scripts/mcp.mjs
# with plan changes allowed:
claude mcp add ccu-planner -- node /absolute/path/to/ccu-planner/scripts/mcp.mjs --allow-writes
# another data folder:
claude mcp add ccu-planner -e CCU_DATA=/path/to/data -- node /absolute/path/to/ccu-planner/scripts/mcp.mjs
```

(`claude mcp add <name> [options] -- <command> [args...]`; add `-s user` to register it for every project.) Run
`npm install` in the planner folder first. `npm run mcp` starts the same server by hand.

## Tests

`test/mcp-tools.test.mjs` calls each handler on in-memory worlds built from the shared test ladder; `test/mcp-server.test.mjs`
runs a real MCP client over an in-memory transport (tool list with and without `--allow-writes`, `today`, progress
notifications) and the real data-folder code on a temporary folder written from `test/fixtures/raw-small.json`.

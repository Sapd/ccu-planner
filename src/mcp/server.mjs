// Registers the tools of tools.mjs on an MCP server. No planner logic here.
import { McpServer } from '@modelcontextprotocol/server';
import { toolsFor, ToolError } from './tools.mjs';

// What a model needs to know before it advises: how CCUs work, what the planner's words mean, and how to use the tools.
export const INSTRUCTIONS = `CCU planner: answers from the user's own plan (goals, owned CCUs, store prices). Ship names are official names; money is US dollars, and every tool refuses to answer for a store account in another currency (or with tax added on top) instead of showing wrong prices. Tools never buy, melt, gift or apply anything on RSI. sync_* tools only read from RSI.

How CCUs work (Star Citizen):
- A CCU (cross-chassis upgrade) turns the ship of one pledge into a more expensive ship. A chain is several CCUs in a row (A → B → C); the cheapest way to a ship often runs through ships the user never wants to fly.
- Standard CCUs cost the price difference of the two ships and can be paid with store credit. Warbond CCUs are cheaper but sold only for a while (sales, new ships) and must be paid with new money, never store credit. "New money" is what the user actually pays.
- LTI (lifetime insurance) stays with the pledge through every upgrade, so chains usually start from a cheap LTI ship, the "LTI token". Without a fixed start the planner picks a suitable LTI ship from the hangar itself.
- Each owned CCU copy can be used once, by one goal. The planner shares owned copies and store credit between goals and tries different orders to find the cheapest combination, so a goal's cost "alone" can differ from its cost "shared".

The planner's words:
- Goal: a ship the user wants, with an optional fixed start ship, a priority (high, normal, low) and a mode: watch waits for Warbond sales when that saves money, finish gets the ship as soon as possible.
- Step states: own (a copy is in the hangar), buy now, on sale (available now, no rush unless the sale ends), optional (a bet: buying now may save money later, but waiting is fine too), wait (no offer yet; a later Warbond may make it cheaper, or it is a Standard filler that can be bought any time).
- Reserve (the accept tool): keeps a goal on its current chain and holds the owned CCUs it uses for it. Steps of a reserved chain that the user then buys count as owned.
- Lock: buy the last step now at today's price, before an announced price rise.
- Virtual CCUs (upgrades the user expects from outside the store) can be managed with set_virtual_ccu and remove_virtual_ccu. Use set_via for a route-through ship and exclude_copy to control whether plans can use a specific owned copy.

How to answer:
- Data is only as fresh as the last sync. Prices and sales change often: if the user is about to buy, or the data looks old, suggest syncing first (in the app, or with sync_* when they ask).
- Use the tools for every number and route: today for what to buy, goals and goal for costs and reasons, check_offer for a specific offer, what_if for "what if I…" questions, changes_since_sync for "why did my plan change". Never work out routes or prices yourself, and quote amounts as the tools give them.
- Write tools (available with --allow-writes) change the user's saved plan: use them only when the user asks, and say what changed.
- Purchases, melting, gifting and applying a CCU happen only on the RSI website, by the user; no tool can do them. melt_advice only says what is worth melting. Say so instead of pretending a tool did it.`;

/** @param {object} deps see tools.mjs  @param {{ allowWrites?: boolean, version?: string }} options */
export function createServer(baseDeps, { allowWrites = false, version = '0.1.0' } = {}) {
  // Defense in depth: the write helpers check this flag too. (Object.create keeps later changes of baseDeps visible.)
  const deps = Object.assign(Object.create(baseDeps), { allowWrites: allowWrites === true });
  const server = new McpServer({ name: 'ccu-planner', version }, { instructions: INSTRUCTIONS });
  for (const tool of toolsFor({ allowWrites })) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, async (args, ctx) => {
      const token = ctx.mcpReq?._meta?.progressToken;
      let n = 0;
      // A monotonic counter, with the phase text as the message.
      const progress = token === undefined ? undefined : async (e) => {
        n++;
        const where = e.total ? ` ${e.done ?? ''} of ${e.total}` : '';
        try {
          await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: n, message: e.message ?? `${e.phase ?? 'sync'}${where}` } });
        } catch { /* the client went away: the sync notices through the abort signal */ }
      };
      try {
        const r = await tool.handler(deps, args ?? {}, { signal: ctx.mcpReq?.signal, progress });
        return { content: [{ type: 'text', text: r.text }], structuredContent: r.data };
      } catch (e) {
        if (e instanceof ToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
        return { content: [{ type: 'text', text: `${tool.name} failed: ${e?.message ?? e}` }], isError: true };
      }
    });
  }
  return server;
}

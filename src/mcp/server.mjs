// Registers the tools of tools.mjs on an MCP server. No planner logic here.
import { McpServer } from '@modelcontextprotocol/server';
import { toolsFor, ToolError } from './tools.mjs';

const INSTRUCTIONS = 'CCU planner: answers from the user\'s own plan (goals, owned CCUs, store prices). Ship names are official names; money is US dollars, and every tool refuses to answer for a store account in another currency (or with tax added on top) instead of showing wrong prices. '
  + 'Tools never buy, melt, gift or apply anything on RSI. sync_* tools only read from RSI.';

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

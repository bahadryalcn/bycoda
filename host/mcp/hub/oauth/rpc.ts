import { z } from "zod";
import type { McpHub } from "../hub";

const INPUT = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  cwd: z.string().max(4096).optional(),
});
const STATUS_INPUT = z.object({ cwd: z.string().max(4096).optional() });

export const isOAuthMethod = (method: string) => method.startsWith("mcp.oauth.");

/** Owner RPCs. The server URL always comes from the Host inventory, never from the caller. */
export async function oauthRpc(hub: McpHub, method: string, input: Record<string, unknown>) {
  if (method === "mcp.oauth.status") {
    const parsed = STATUS_INPUT.safeParse(input);
    if (!parsed.success) throw new Error("Invalid MCP sign-in request.");
    const http = (await hub.inventory(parsed.data.cwd)).filter((def) => def.kind === "http");
    const states = await hub.oauth.status(http.map((def) => ({ name: def.name, url: def.url! })));
    return { servers: states };
  }
  const parsed = INPUT.safeParse(input);
  if (!parsed.success) throw new Error("Invalid MCP sign-in request.");
  const def = (await hub.inventory(parsed.data.cwd)).find(
    (item) => item.kind === "http" && item.name === parsed.data.name,
  );
  if (!def) throw new Error("Unknown MCP server.");
  const server = { name: def.name, url: def.url! };
  if (method === "mcp.oauth.start") return await hub.oauth.start(server);
  if (method === "mcp.oauth.signOut") {
    await hub.oauth.signOut(server);
    return { signedOut: true };
  }
  throw new Error("Unsupported sign-in operation.");
}

import { z } from "zod";
import type { McpHub } from "../hub";
import { HubExternalMcpTools } from "../external-tools";

const NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const INPUT = z.object({
  name: NAME,
  cwd: z.string().max(4096).optional(),
});
const STATUS_INPUT = z.object({
  cwd: z.string().max(4096).optional(),
  profileFor: NAME.optional(),
});
const START_INPUT = z.object({ callbackPort: z.number().int().min(1024).max(65535).optional() });
const STATE_INPUT = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/) });
const COMPLETE_INPUT = z
  .object({
    ...STATE_INPUT.shape,
    code: z.string().min(1).max(8192).optional(),
    error: z.string().min(1).max(128).optional(),
  })
  .refine(({ code, error }) => Boolean(code) !== Boolean(error));

export const isOAuthMethod = (method: string) => method.startsWith("mcp.oauth.");

/** Owner RPCs. The server URL always comes from the Host inventory, never from the caller. */
export async function oauthRpc(hub: McpHub, method: string, input: Record<string, unknown>) {
  if (method === "mcp.oauth.status") {
    const parsed = STATUS_INPUT.safeParse(input);
    if (!parsed.success) throw new Error("Invalid MCP sign-in request.");
    const { cwd, profileFor } = parsed.data;
    const http = (await hub.inventory(cwd)).filter((def) => def.kind === "http");
    const states = await hub.oauth.status(http.map((def) => hub.oauthServerRef(def, cwd)));
    const selected = http.find((def) => def.name === profileFor);
    const state = states.find((entry) => entry.name === profileFor);
    if (
      selected &&
      state?.state === "signed-in" &&
      !(await hub.projectCredentialsFor(cwd, selected))
    ) {
      const reader = new HubExternalMcpTools({ hub, httpAuth: (ref) => hub.httpAuth(ref) });
      const profile = await reader.accountProfile(selected, cwd);
      if (profile)
        return {
          servers: states.map((entry) => (entry === state ? { ...entry, profile } : entry)),
        };
    }
    return { servers: states };
  }
  const parsed = INPUT.safeParse(input);
  if (!parsed.success) throw new Error("Invalid MCP sign-in request.");
  const def = (await hub.inventory(parsed.data.cwd)).find(
    (item) => item.kind === "http" && item.name === parsed.data.name,
  );
  if (!def) throw new Error("Unknown MCP server.");
  const server = hub.oauthServerRef(def, parsed.data.cwd);
  if (method === "mcp.oauth.start") {
    const start = START_INPUT.safeParse(input);
    if (!start.success) throw new Error("Invalid MCP callback port.");
    return await hub.oauth.start(server, start.data.callbackPort);
  }
  if (method === "mcp.oauth.complete") {
    const completion = COMPLETE_INPUT.safeParse(input);
    if (!completion.success) throw new Error("Invalid MCP sign-in callback.");
    return { status: await hub.oauth.completeRelay(server, completion.data) };
  }
  if (method === "mcp.oauth.cancel") {
    const cancellation = STATE_INPUT.safeParse(input);
    if (!cancellation.success) throw new Error("Invalid MCP sign-in callback.");
    return { cancelled: hub.oauth.cancelSignIn(server, cancellation.data.state) };
  }
  if (method === "mcp.oauth.signOut") {
    await hub.oauth.signOut(server);
    return { signedOut: true };
  }
  throw new Error("Unsupported sign-in operation.");
}

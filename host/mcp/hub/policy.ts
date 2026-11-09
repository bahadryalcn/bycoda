/** Which inherited MCP servers may share one child across sessions. Everything else
 * (desktop control, unknown, stateful servers) gets one child per session. */
export type HubMode = "shared" | "perSession";

export const SHARED_SERVER_NAMES = /^(dokploy|rea|rea-agents|blender|mem0.*|node_repl)$/;
export const SHARED_COMMAND_MARKERS = ["dokploy", "rea.mjs", "mcp-for-blender"] as const;

export const MCP_HUB_IDLE_MS = { shared: 30 * 60_000, perSession: 15 * 60_000 } as const;

export type HubDefinitionLike = {
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
};

export function hubMode(name: string, definition: HubDefinitionLike): HubMode {
  if (definition.kind === "http") return "shared";
  if (SHARED_SERVER_NAMES.test(name)) return "shared";
  const launch = [definition.command ?? "", ...(definition.args ?? [])].join(" ").toLowerCase();
  return SHARED_COMMAND_MARKERS.some((marker) => launch.includes(marker)) ? "shared" : "perSession";
}

export function hubIdleMs(mode: HubMode): number {
  return MCP_HUB_IDLE_MS[mode];
}

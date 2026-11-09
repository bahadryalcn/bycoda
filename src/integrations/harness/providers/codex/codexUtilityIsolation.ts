import type { JsonRpcWriterView } from "../turnWriter";
/** Verified installed 0.166.0 feature names/config.read; utility process only.
 * No all-builtins tool_choice exists in ThreadStart/TurnStart. This configuration
 * is not a claim that notifications can prevent provider-owned effects. */
export const CODEX_UTILITY_DISABLED_FEATURES = Object.freeze([
  "shell_tool",
  "unified_exec",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "code_mode",
  "code_mode_host",
  "apps",
  "plugins",
  "hooks",
  "goals",
  "memories",
]);
export const CODEX_UTILITY_CONFIG = Object.freeze({
  web_search: "disabled",
  ...Object.fromEntries(CODEX_UTILITY_DISABLED_FEATURES.map((name) => [`features.${name}`, false])),
});
export function codexUtilitySpawnArgs(): string[] {
  return [
    "app-server",
    ...Object.entries(CODEX_UTILITY_CONFIG).flatMap(([key, value]) => [
      "-c",
      `${key}=${JSON.stringify(value)}`,
    ]),
  ];
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const denied = () =>
  new Error("Codex utility isolation could not be verified; no reasoning prompt was sent.");
/** Empty mcp_servers={} merges with inherited entries. Explicitly disable each
 * effective server using nested values so dots/quotes in names stay literal.
 * Verified with installed app-server config/read + thread/start (no turns).
 * https://learn.chatgpt.com/docs/config-file/config-reference */
export async function codexUtilityConfig(
  writer: JsonRpcWriterView,
  cwd: string,
): Promise<Record<string, unknown>> {
  const response = record(
      await writer.request("config/read", { cwd, includeLayers: false }, 45000),
    ),
    config = record(response?.config);
  if (!config) throw denied();
  const features = record(config.features);
  if (
    config.web_search !== "disabled" ||
    !features ||
    CODEX_UTILITY_DISABLED_FEATURES.some((name) => features[name] !== false)
  )
    throw denied();
  const servers = config.mcp_servers === undefined ? {} : record(config.mcp_servers);
  if (!servers || Object.keys(servers).length > 200) throw denied();
  return {
    ...CODEX_UTILITY_CONFIG,
    mcp_servers: Object.fromEntries(Object.keys(servers).map((name) => [name, { enabled: false }])),
  };
}
/** Inspect every page of this exact thread's effective inventory before a turn.
 * Missing/older runtime-status evidence is unknown, never disabled. */
export async function assertCodexUtilityIsolation(
  writer: JsonRpcWriterView,
  threadId: string,
): Promise<void> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const result = record(
      await writer.request(
        "mcpServerStatus/list",
        { threadId, limit: 100, ...(cursor ? { cursor } : {}) },
        45000,
      ),
    );
    if (!result || !Array.isArray(result.data) || result.data.length > 100) throw denied();
    for (const value of result.data) {
      const server = record(value),
        tools = record(server?.tools);
      if (
        !server ||
        server.runtimeStatus !== "disabled" ||
        !tools ||
        Object.keys(tools).length ||
        !Array.isArray(server.resources) ||
        server.resources.length ||
        !Array.isArray(server.resourceTemplates) ||
        server.resourceTemplates.length
      )
        throw denied();
    }
    if (result.nextCursor === null || result.nextCursor === undefined) return;
    if (typeof result.nextCursor !== "string" || !result.nextCursor || seen.has(result.nextCursor))
      throw denied();
    cursor = result.nextCursor;
    seen.add(cursor);
  }
  throw denied();
}

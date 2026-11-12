/** Codex's native multi-agent features; names verified against the installed 0.166.0 config. */
const NATIVE_SUBAGENT_FEATURES = ["multi_agent", "multi_agent_v2"] as const;

/**
 * Thread config for thread/start and thread/resume. Codex's native subagents
 * inherit the main model, so they cannot be held to the owner's subagent
 * selection: `nativeSubagents: "off"` removes them and selected models run
 * through the Host agents tools, which enforce the selection.
 */
export function codexThreadConfig(
  base: Record<string, unknown> | undefined,
  modelSettings: Readonly<Record<string, string>> | undefined,
): Record<string, unknown> | undefined {
  const policy = modelSettings?.nativeSubagents;
  if (policy !== "off" && policy !== "on") return base;
  return {
    ...base,
    ...Object.fromEntries(
      NATIVE_SUBAGENT_FEATURES.map((name) => [`features.${name}`, policy === "on"]),
    ),
  };
}

import { codexAutoCompactConfig } from "./codexCompaction";

/**
 * Thread config for thread/start and thread/resume. Codex's native subagents
 * inherit the main model, so they cannot be held to the owner's subagent
 * selection: `nativeSubagents: "off"` removes them and selected models run
 * through the Host agents tools, which enforce the selection. 0.167.2 removes the
 * agent tools with `agents.enabled`; 0.166.x needs the feature flags too.
 */
export function codexThreadConfig(
  base: Record<string, unknown> | undefined,
  modelSettings: Readonly<Record<string, string>> | undefined,
): Record<string, unknown> | undefined {
  const policy = modelSettings?.nativeSubagents;
  const compact = codexAutoCompactConfig(modelSettings);
  if (policy !== "off" && policy !== "on") return compact ? { ...base, ...compact } : base;
  return {
    ...base,
    ...compact,
    "agents.enabled": policy === "on",
    "features.multi_agent": policy === "on",
    // Off by default in Codex: "on" restores the default tools, it never opts into v2.
    "features.multi_agent_v2": false,
  };
}

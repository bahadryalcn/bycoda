export const TOOL_IDS = [
  "servers",
  "social",
  "tasks",
  "automations",
  "crews",
  "live-stream",
  "inbox",
  "notes",
  "conversation-tools",
  "terminal",
  "assistant",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export type WorkspaceToolId = ToolId;
export type AuxiliaryToolId = "conversation-tools" | "terminal" | "assistant";
export type ToolWindow = { active: ToolId; cwd: string; grouped: boolean };

export function readToolWindow(
  search = typeof window === "undefined" ? "" : window.location.search,
): ToolWindow | null {
  const params = new URLSearchParams(search);
  const active = params.get("tool");
  // Crews and Live streaming stay in the main window.
  if (active === "crews" || active === "live-stream" || !TOOL_IDS.some((id) => id === active))
    return null;
  return {
    active: active as ToolId,
    cwd: params.get("cwd") || "~",
    grouped: params.get("tools") === "all",
  };
}

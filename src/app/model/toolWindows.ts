export const TOOL_IDS = ["social", "tasks", "automations", "inbox", "notes"] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export type ToolWindow = { active: ToolId; cwd: string; grouped: boolean };

export function readToolWindow(
  search = typeof window === "undefined" ? "" : window.location.search,
): ToolWindow | null {
  const params = new URLSearchParams(search);
  const active = params.get("tool");
  if (!TOOL_IDS.some((id) => id === active)) return null;
  return {
    active: active as ToolId,
    cwd: params.get("cwd") || "~",
    grouped: params.get("tools") === "all",
  };
}

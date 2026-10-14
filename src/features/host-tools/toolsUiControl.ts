export type ToolsTab = "devices" | "browser" | "servers" | "logs" | "resources";
export type ToolsPlacement = "left" | "right" | "top" | "bottom";
export type ToolsUiContext = { cwd: string; sessionId: string; title: string };
export type ToolsUiAction =
  | "ui.tools.status"
  | "ui.tools.open"
  | "ui.tools.place"
  | "ui.tools.close";
export type ToolsUiInput = { tab?: ToolsTab; placement?: ToolsPlacement; machineId?: string };
export type ToolsUiState = {
  open: boolean;
  placement: ToolsPlacement;
  panels: { id: string; tab: ToolsTab; machine: string; mounted: boolean }[];
};
type Handler = (
  context: ToolsUiContext,
  action: ToolsUiAction,
  input: ToolsUiInput,
) => Promise<ToolsUiState>;
let handler: Handler | undefined;

/** One workspace executor per window. Registration does not grant app/CLI access. */
export function registerToolsUiControl(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

export async function requestToolsUi(
  context: ToolsUiContext,
  action: string,
  input: Record<string, unknown>,
): Promise<ToolsUiState> {
  if (
    !context.cwd ||
    !context.sessionId ||
    !["ui.tools.status", "ui.tools.open", "ui.tools.place", "ui.tools.close"].includes(action)
  )
    throw new Error("Unsupported tools UI request.");
  const allowed =
    action === "ui.tools.open"
      ? ["tab", "placement", "machineId"]
      : action === "ui.tools.place"
        ? ["placement"]
        : [];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unknown or protected tools UI field.");
  if (
    input.tab !== undefined &&
    !["devices", "browser", "servers", "logs", "resources"].includes(String(input.tab))
  )
    throw new Error("Invalid tools tab.");
  if (
    (action === "ui.tools.place" || input.placement !== undefined) &&
    !["left", "right", "top", "bottom"].includes(String(input.placement))
  )
    throw new Error("Invalid tools placement.");
  if (
    input.machineId !== undefined &&
    (typeof input.machineId !== "string" || !input.machineId.trim() || input.machineId.length > 300)
  )
    throw new Error("Invalid tools machine.");
  if (!handler) throw new Error("Conversation Tools workspace is not mounted in this window.");
  return handler(context, action as ToolsUiAction, input as ToolsUiInput);
}

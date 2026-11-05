export type ToolsTab = "devices" | "browser" | "servers" | "logs" | "resources";
export type ToolsPlacement = "left" | "right" | "top" | "bottom";
export type SessionToolsUiContext = {
  kind?: "session";
  cwd: string;
  sessionId: string;
  title: string;
};
export type RoomToolsUiContext = {
  kind: "room";
  cwd: string;
  threadId: string;
  projectId: string;
  environmentId: string;
  title: string;
  valid: () => boolean;
};
export type ToolsUiContext = SessionToolsUiContext | RoomToolsUiContext;
export type ToolsUiAction =
  | "ui.tools.status"
  | "ui.tools.open"
  | "ui.tools.place"
  | "ui.tools.close";
export type ToolsUiInput = {
  tab?: ToolsTab;
  placement?: ToolsPlacement;
  machineId?: string;
  projectHost?: boolean;
};
export type ToolsUiState = {
  open: boolean;
  placement: ToolsPlacement;
  visible?: boolean;
  presentation?: "docked" | "detached";
  panels: {
    id: string;
    tab: ToolsTab;
    machine: string;
    mounted?: boolean;
    presentationKnown?: boolean;
    visible?: boolean;
  }[];
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
    (context.kind === "room"
      ? !context.threadId || !context.projectId || !context.environmentId || !context.valid()
      : !context.sessionId) ||
    !["ui.tools.status", "ui.tools.open", "ui.tools.place", "ui.tools.close"].includes(action)
  )
    throw new Error("Unsupported tools UI request.");
  if (
    context.kind === "room" &&
    (!["ui.tools.open", "ui.tools.status"].includes(action) ||
      (action === "ui.tools.open" &&
        (input.tab !== "browser" || input.projectHost !== true || input.machineId !== undefined)))
  )
    throw new Error("Room tools support only the project Host browser.");
  const allowed =
    action === "ui.tools.open"
      ? ["tab", "placement", "machineId", "projectHost"]
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
  if (input.projectHost !== undefined && typeof input.projectHost !== "boolean")
    throw new Error("Invalid project Host selection.");
  if (input.projectHost === true && input.machineId !== undefined)
    throw new Error("Choose either the project Host or an explicit machine.");
  if (!handler) throw new Error("Conversation Tools workspace is not mounted in this window.");
  return handler(context, action as ToolsUiAction, input as ToolsUiInput);
}

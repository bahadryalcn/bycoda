/** Finite navigation contract shared with host discovery. No settings writes or arbitrary commands. */
export const APP_UI_VIEWS = [
  "conversation",
  "notes",
  "inbox",
  "automations",
  "tasks",
  "social",
  "search",
  "settings",
  "files",
  "terminal",
] as const;
export const APP_UI_SETTINGS = [
  "notifications",
  "workspace",
  "general",
  "policies",
  "connections",
  "appearance",
  "keybindings",
  "terminal",
  "chat",
  "providers",
  "usage",
  "mcp",
  "skills",
  "inbox",
  "worktrees",
  "groupLock",
  "archive",
] as const;
export type AppUiView = (typeof APP_UI_VIEWS)[number];
export type AppUiInput = { view?: AppUiView; section?: (typeof APP_UI_SETTINGS)[number] };
export type AppUiContext = { cwd: string; sessionId: string; title: string };
export type AppUiAction =
  | "ui.workspace.list"
  | "ui.workspace.status"
  | "ui.workspace.open"
  | "ui.workspace.close";
type Handler = (context: AppUiContext, action: AppUiAction, input: AppUiInput) => Promise<unknown>;
let handler: Handler | undefined;
let queue: Promise<unknown> = Promise.resolve();
export function registerAppUiControl(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}
export function requestAppUi(
  context: AppUiContext,
  action: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (
    !context.cwd ||
    !context.sessionId ||
    ![
      "ui.workspace.list",
      "ui.workspace.status",
      "ui.workspace.open",
      "ui.workspace.close",
    ].includes(action)
  )
    return Promise.reject(new Error("Unsupported workspace UI request."));
  const allowed =
    action === "ui.workspace.open"
      ? ["view", "section"]
      : action === "ui.workspace.close"
        ? ["view"]
        : [];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    ((action === "ui.workspace.open" || action === "ui.workspace.close") &&
      !APP_UI_VIEWS.includes(input.view as AppUiView)) ||
    (input.section !== undefined &&
      (input.view !== "settings" ||
        !APP_UI_SETTINGS.includes(input.section as AppUiInput["section"] & string)))
  )
    return Promise.reject(new Error("Invalid or protected workspace UI field."));
  const selected = handler;
  if (!selected)
    return Promise.reject(new Error("Application workspace is not mounted in this window."));
  const result = queue
    .catch(() => undefined)
    .then(() => {
      if (handler !== selected) throw new Error("Application window changed before navigation.");
      return selected(context, action as AppUiAction, input as AppUiInput);
    });
  queue = result;
  return result;
}

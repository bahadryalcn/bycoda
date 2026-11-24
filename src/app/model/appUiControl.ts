/** Finite workspace view contract shared with host discovery. No settings writes or arbitrary commands. */
export const APP_UI_VIEWS = [
  "conversation",
  "servers",
  "notes",
  "inbox",
  "automations",
  "tasks",
  "social",
  "search",
  "settings",
  "files",
  "terminal",
  "crews",
  "assistant",
  "conversation-tools",
] as const;
export const APP_UI_NAVIGATION_VIEWS = APP_UI_VIEWS;
/** Views that need no project: the global Room can open and close exactly these. */
export const APP_UI_GLOBAL_VIEWS = ["settings", "search", "inbox", "assistant"] as const;
/**
 * Settings sections a navigation request may name: every rail section that `SETTINGS_SECTIONS`
 * lists. Tool tabs open through `tools`; retired aliases (`inbox`, `models`, `work`) are not routes.
 * `appUiControl.test.ts` fails when this drifts from the settings registry.
 */
export const APP_UI_SETTINGS = [
  "general",
  "appearance",
  "notifications",
  "permissions",
  "keybindings",
  "groupLock",
  "archive",
  "chat",
  "voice",
  "providers",
  "decisionModels",
  "usage",
  "mcp",
  "skills",
  "secrets",
  "tools",
  "workspace",
  "terminal",
  "worktrees",
  "connections",
  "integrations",
  "policies",
  "account",
] as const;
export type AppUiView = (typeof APP_UI_VIEWS)[number];
export type AppUiInput = {
  view?: AppUiView;
  section?: (typeof APP_UI_SETTINGS)[number];
  requestId?: string;
  terminalId?: string;
};
export type AppUiContext = { cwd: string; sessionId: string; title: string; deadline?: number };
/**
 * Voice navigation from a window with no active conversation but with an unlocked project. It
 * carries the window's visible project and no session identity, so it can only open, close, list
 * and read application views; it never focuses, reads or acts on a conversation.
 */
export type AppUiWindowContext = { cwd: string; window: true; title: string; deadline?: number };
/**
 * The global Room: no conversation and no unlocked project in this window. It carries no project
 * and no identity, so it only reaches the views in `APP_UI_GLOBAL_VIEWS` and the view reads.
 */
export type AppUiGlobalContext = { global: true; title: string; deadline?: number };
export type AppUiRequestContext = AppUiContext | AppUiWindowContext | AppUiGlobalContext;
export const APP_UI_WINDOW_ACTIONS = [
  "ui.workspace.list",
  "ui.workspace.status",
  "ui.workspace.open",
  "ui.workspace.close",
] as const;
export type AppUiAction =
  | "ui.workspace.list"
  | "ui.workspace.status"
  | "ui.workspace.open"
  | "ui.workspace.close"
  | "ui.workspace.acknowledge"
  | "terminals.create"
  | "terminals.interrupt"
  | "terminals.close"
  | "terminals.pty.guard";
type Handler = (
  context: AppUiRequestContext,
  action: AppUiAction,
  input: AppUiInput,
) => Promise<unknown>;
let handler: Handler | undefined;
let queue: Promise<unknown> = Promise.resolve();
export function registerAppUiControl(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}
export function requestAppUi(
  context: AppUiRequestContext,
  action: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const globalScope = "global" in context;
  const windowScope = "window" in context;
  const projectless = globalScope || windowScope;
  const cwd = "cwd" in context ? context.cwd : "";
  if (
    (!globalScope && !cwd) ||
    (!projectless && !(context as AppUiContext).sessionId) ||
    (projectless && !(APP_UI_WINDOW_ACTIONS as readonly string[]).includes(action)) ||
    ![
      "ui.workspace.list",
      "ui.workspace.status",
      "ui.workspace.open",
      "ui.workspace.close",
      "terminals.create",
      "terminals.interrupt",
      "terminals.close",
      "terminals.pty.guard",
    ].includes(action)
  )
    return Promise.reject(new Error("Unsupported workspace UI request."));
  const allowed =
    action === "ui.workspace.open"
      ? ["view", "section"]
      : action === "ui.workspace.close"
        ? ["view"]
        : action === "terminals.create"
          ? ["requestId"]
          : action === "terminals.close" || action === "terminals.interrupt"
            ? ["terminalId"]
            : [];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (action === "terminals.create" &&
      (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId))) ||
    ((action === "terminals.close" || action === "terminals.interrupt") &&
      (typeof input.terminalId !== "string" ||
        !input.terminalId ||
        input.terminalId.length > 400)) ||
    ((action === "ui.workspace.open" || action === "ui.workspace.close") &&
      !APP_UI_NAVIGATION_VIEWS.includes(input.view as (typeof APP_UI_NAVIGATION_VIEWS)[number])) ||
    (globalScope &&
      (action === "ui.workspace.open" || action === "ui.workspace.close") &&
      !APP_UI_GLOBAL_VIEWS.includes(input.view as (typeof APP_UI_GLOBAL_VIEWS)[number])) ||
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

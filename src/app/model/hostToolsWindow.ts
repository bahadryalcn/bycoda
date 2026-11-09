import type { BrowserDraftTransfer } from "../../features/host-tools/browserDraftTransfer";
import type { ToolsTab } from "../../features/host-tools/toolsUiControl";

/** The window role is data only: reading it must not load any tool or workspace UI. */
export type HostToolsWindow = {
  browserDraft?: BrowserDraftTransfer;
  transferRequestId?: string;
  cwd: string;
  sessionId: string;
  title: string;
  projectName?: string;
  branch?: string;
  worktreeCwd?: string;
  model?: string;
  status?: string;
  composerSessionId?: string;
  composerWindow?: string;
  onlyTab?: "logs";
  initialMachine?: string;
  initialTab?: ToolsTab;
  initialUrl?: string;
};

function readBrowserDraft(value: unknown): BrowserDraftTransfer | undefined {
  if (!value || typeof value !== "object") return;
  const draft = value as Record<string, unknown>;
  if (typeof draft.comment !== "string") return;
  const capture = (input: unknown): { id: string; comment: string } | undefined => {
    if (!input || typeof input !== "object") return;
    const item = input as Record<string, unknown>;
    return typeof item.id === "string" && typeof item.comment === "string"
      ? { id: item.id.slice(0, 200), comment: item.comment.slice(0, 4000) }
      : undefined;
  };
  const annotation = draft.annotation as Record<string, unknown> | undefined;
  return {
    comment: draft.comment.slice(0, 4000),
    annotation:
      annotation && typeof annotation.id === "string" && typeof annotation.navigationId === "string"
        ? { id: annotation.id.slice(0, 200), navigationId: annotation.navigationId.slice(0, 200) }
        : undefined,
    captures: Array.isArray(draft.captures)
      ? draft.captures
          .slice(0, 8)
          .map(capture)
          .filter((item): item is { id: string; comment: string } => !!item)
      : undefined,
    current: capture(draft.current),
    uncertainDelivery: draft.uncertainDelivery === true,
  };
}

export function readHostToolsWindow(
  search = typeof window === "undefined" ? "" : window.location.search,
): HostToolsWindow | null {
  const input = new URLSearchParams(search).get("hostTools");
  if (!input) return null;
  try {
    const value = JSON.parse(input);
    if (
      !value ||
      typeof value.cwd !== "string" ||
      !value.cwd.trim() ||
      typeof value.sessionId !== "string" ||
      typeof value.title !== "string"
    )
      return null;
    return {
      browserDraft: readBrowserDraft(value.browserDraft),
      transferRequestId:
        typeof value.transferRequestId === "string" ? value.transferRequestId : undefined,
      cwd: value.cwd,
      sessionId: value.sessionId,
      title: value.title,
      ...Object.fromEntries(
        ["projectName", "branch", "worktreeCwd", "model", "status"]
          .filter((field) => typeof value[field] === "string")
          .map((field) => [field, value[field]]),
      ),
      composerSessionId:
        typeof value.composerSessionId === "string" ? value.composerSessionId : undefined,
      composerWindow: typeof value.composerWindow === "string" ? value.composerWindow : undefined,
      onlyTab: value.onlyTab === "logs" ? "logs" : undefined,
      ...(["devices", "browser", "servers", "logs", "resources"].includes(value.initialTab)
        ? { initialTab: value.initialTab as ToolsTab }
        : {}),
      ...(typeof value.initialUrl === "string" && /^https?:\/\//i.test(value.initialUrl)
        ? { initialUrl: value.initialUrl }
        : {}),
      initialMachine:
        typeof value.initialMachine === "string" &&
        (value.initialMachine === "local" || value.initialMachine.startsWith("machine:"))
          ? value.initialMachine
          : "project",
    };
  } catch {
    return null;
  }
}

/** Inject loaders so role dispatch can be checked without evaluating either UI graph. */
export function loadWindowSurface<Workspace, Tools>(
  role: HostToolsWindow | null,
  loadWorkspace: () => Promise<Workspace>,
  loadTools: () => Promise<Tools>,
): Promise<Workspace> | Promise<Tools> {
  return role ? loadTools() : loadWorkspace();
}

/** The window role is data only: reading it must not load any tool or workspace UI. */
export type HostToolsWindow = {
  cwd: string;
  sessionId: string;
  title: string;
  composerSessionId?: string;
  composerWindow?: string;
  onlyTab?: "logs";
  initialMachine?: string;
  initialTab?: "browser";
  initialUrl?: string;
};

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
      cwd: value.cwd,
      sessionId: value.sessionId,
      title: value.title,
      composerSessionId:
        typeof value.composerSessionId === "string" ? value.composerSessionId : undefined,
      composerWindow: typeof value.composerWindow === "string" ? value.composerWindow : undefined,
      onlyTab: value.onlyTab === "logs" ? "logs" : undefined,
      ...(value.initialTab === "browser" ? { initialTab: "browser" as const } : {}),
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

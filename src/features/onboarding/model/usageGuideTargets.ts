/** Controls inside the focused chat pane's composer. */
type PaneTarget =
  | "composer"
  | "composer-plus"
  | "model-controls"
  | "access-mode"
  | "send-controls"
  | "queue"
  | "queue-button"
  | "stop-button";

/** Workspace controls that exist once for the whole window. */
type GlobalTarget =
  | "changes"
  | "files-tab"
  | "sidebar-tabs"
  | "new-session"
  | "project-navigation"
  | "project-add"
  | "group-pin"
  | "terminal-toggle"
  | "rail-inbox"
  | "rail-notes"
  | "rail-automations"
  | "rail-tasks"
  | "rail-tools"
  | "rail-settings";

export type UsageGuideTarget = PaneTarget | GlobalTarget;

const GLOBAL_TARGETS: ReadonlySet<string> = new Set<GlobalTarget>([
  "changes",
  "files-tab",
  "sidebar-tabs",
  "new-session",
  "project-navigation",
  "project-add",
  "group-pin",
  "terminal-toggle",
  "rail-inbox",
  "rail-notes",
  "rail-automations",
  "rail-tasks",
  "rail-tools",
  "rail-settings",
]);

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]'))
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0
  );
}

/** Prefer the focused chat pane; never spotlight controls in another session. */
export function findUsageGuideTarget(names: readonly UsageGuideTarget[]): HTMLElement | null {
  const composers = Array.from(
    document.querySelectorAll<HTMLElement>('[data-usage-guide="composer"]'),
  ).filter(visible);
  const composer =
    composers.find((element) => element.closest('[data-usage-guide-active="true"]')) ??
    composers[0];
  const pane = composer?.closest<HTMLElement>("[data-usage-guide-active]") ?? composer;
  for (const name of names) {
    const selector = `[data-usage-guide="${name}"]`;
    if (name === "composer") {
      if (composer) return composer;
      continue;
    }
    const scope = GLOBAL_TARGETS.has(name) ? document : pane;
    const candidate = scope
      ? Array.from(scope.querySelectorAll<HTMLElement>(selector)).find(visible)
      : undefined;
    if (candidate) return candidate;
  }
  return null;
}

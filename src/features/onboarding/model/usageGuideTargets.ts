export type UsageGuideTarget =
  | "composer"
  | "model-controls"
  | "send-controls"
  | "queue"
  | "queue-button"
  | "stop-button"
  | "changes"
  | "project-navigation";

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
    const globalTarget = name === "changes" || name === "project-navigation";
    const scope = globalTarget ? document : pane;
    const candidate = scope
      ? Array.from(scope.querySelectorAll<HTMLElement>(selector)).find(visible)
      : undefined;
    if (candidate) return candidate;
  }
  return null;
}

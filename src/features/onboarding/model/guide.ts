import { canOpenTerminalIn, looksLikeProject } from "../../projects/model/recents";

export const GUIDE_ACTION_EVENT = "bycoda:guide-action";

/** Workspace surfaces the guide can reveal through the application's own openers. */
export type GuideAction =
  | "open-project"
  | "new-session"
  | "changes"
  | "files"
  | "command-palette"
  | "terminal"
  | "inbox"
  | "social"
  | "notes"
  | "automations"
  | "tasks"
  | "connections"
  | "keybindings"
  | "workspace-settings";

export function runGuideAction(action: GuideAction) {
  window.dispatchEvent(new CustomEvent<GuideAction>(GUIDE_ACTION_EVENT, { detail: action }));
}

export type GuideBlocker = "project" | "local-project" | "notes-disabled";

/** Mirrors the openers' own gates so a guide action never silently does nothing. */
export function guideActionBlocker(
  action: GuideAction,
  { cwd, notesEnabled }: { cwd: string; notesEnabled: boolean },
): GuideBlocker | null {
  switch (action) {
    case "terminal":
      return canOpenTerminalIn(cwd) ? null : "local-project";
    case "changes":
    case "files":
    case "inbox":
    case "social":
      return looksLikeProject(cwd) ? null : "project";
    case "notes":
      return notesEnabled ? null : "notes-disabled";
    default:
      return null;
  }
}

const SEEN_KEY = "bycoda.guide.seen.v1";

export function loadSeenGuideTopics(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markGuideTopicSeen(id: string): string[] {
  const seen = loadSeenGuideTopics();
  if (seen.includes(id)) return seen;
  const next = [...seen, id];
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Progress marks are optional; the guide still works without storage.
  }
  return next;
}

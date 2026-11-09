import {
  canOpenTerminalIn,
  loadPinnedProjects,
  loadRecents,
  looksLikeProject,
} from "../../projects/model/recents";
import { getSessions } from "../../sessions/model/sessionsStore";
import { loadGuideActivity, type GuideActivity } from "./guideActivity";

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

const DONE_KEY = "bycoda.guide.done.v1";

/** Facts the app can read synchronously, so a step is finished before the user asks. */
export type GuideSignal =
  | "project-open"
  | "project-many"
  | "project-pinned"
  | "session-started"
  | GuideActivity;

export function guideSignals(cwd: string): ReadonlySet<GuideSignal> {
  const signals = new Set<GuideSignal>();
  const projects = loadRecents().filter((item) => looksLikeProject(item.path));
  if (looksLikeProject(cwd) || projects.length > 0) signals.add("project-open");
  if (projects.length > 1) signals.add("project-many");
  if (loadPinnedProjects().length > 0) signals.add("project-pinned");
  // Any conversation in this window that already has a message from the user.
  if (getSessions().some((session) => session.blocks.some((block) => block.role === "user")))
    signals.add("session-started");
  // Recorded by the app when the user opens a terminal or a diff.
  for (const activity of loadGuideActivity()) signals.add(activity);
  return signals;
}

export function loadDoneGuideSteps(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Records (or clears) a step the user finished by doing it or by ticking it off. */
export function setGuideStepDone(id: string, done: boolean): string[] {
  const current = loadDoneGuideSteps();
  if (current.includes(id) === done) return current;
  const next = done ? [...current, id] : current.filter((entry) => entry !== id);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(next));
  } catch {
    // Progress marks are optional; the guide still works without storage.
  }
  return next;
}

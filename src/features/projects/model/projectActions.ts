import { pathKey } from "../../../shared/lib/paths";
import { canonicalShortcut } from "../../quick-composer/model/quickComposerShortcut";
import { validateKeybindingShortcut } from "../../settings/model/settings";

export const ACTION_ICONS = ["play", "terminal", "code", "globe", "wrench"] as const;
export type ProjectAction = {
  id: string;
  name: string;
  icon: (typeof ACTION_ICONS)[number];
  command: string;
  url: string;
  shortcut?: string;
  openUrlOnRun?: boolean;
  devServer?: boolean;
};
const KEY = "bycoda.projectActions.v1";
export const PROJECT_ACTIONS_CHANGED = "bycoda:project-actions-changed";

export function validActionUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function projectActionShortcutError(
  shortcut: string,
  actions: ProjectAction[],
  id: string,
): string {
  if (!shortcut) return "";
  try {
    validateKeybindingShortcut(`project-action:${id}`, shortcut);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const other = actions.find(
    (action) =>
      action.id !== id && canonicalShortcut(action.shortcut ?? "") === canonicalShortcut(shortcut),
  );
  return other ? `Already used by “${other.name}” in this project.` : "";
}

function readStore(): Record<string, ProjectAction[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, ProjectAction[]>)
      : {};
  } catch {
    return {};
  }
}

export function loadProjectActions(cwd: string): ProjectAction[] {
  const values = readStore()[pathKey(cwd)];
  return Array.isArray(values)
    ? values.filter(
        (action) =>
          action &&
          typeof action.id === "string" &&
          typeof action.name === "string" &&
          ACTION_ICONS.includes(action.icon) &&
          typeof action.command === "string" &&
          typeof action.url === "string" &&
          validActionUrl(action.url) &&
          (action.shortcut === undefined ||
            (typeof action.shortcut === "string" &&
              (!action.shortcut || canonicalShortcut(action.shortcut) !== null))) &&
          (action.openUrlOnRun === undefined || typeof action.openUrlOnRun === "boolean") &&
          (action.devServer === undefined || typeof action.devServer === "boolean"),
      )
    : [];
}

export function saveProjectActions(cwd: string, actions: ProjectAction[]): void {
  const store = readStore();
  store[pathKey(cwd)] = actions;
  localStorage.setItem(KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(PROJECT_ACTIONS_CHANGED));
}

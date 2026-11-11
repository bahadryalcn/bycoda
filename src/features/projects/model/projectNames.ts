import { useSyncExternalStore } from "react";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import { collectRailProjects, loadRecents } from "./recents";

/** The name a project's rail row shows: its label, else its folder name. */
export function projectDisplayName(
  path: string,
  labels: Record<string, string> = loadTabGroupLabels(),
): string {
  return projectDisplayNameFrom(path, labels);
}

/** `projectDisplayName` with the labels given (see `useProjectLabels`), so render reads no store. */
export function projectDisplayNameFrom(path: string, labels: Record<string, string>): string {
  return resolveTabGroupLabel(projectKey(path), labels, projectName(path));
}

let labelsCache: { json: string; labels: Record<string, string> } | null = null;

/** The labels, with one object identity for as long as their content is unchanged. */
function labelsSnapshot(): Record<string, string> {
  const labels = loadTabGroupLabels();
  const json = JSON.stringify(labels);
  if (labelsCache?.json !== json) labelsCache = { json, labels };
  return labelsCache.labels;
}

const NO_LABELS: Record<string, string> = {};

/** The project labels for render: re-renders the caller when any label changes. */
export function useProjectLabels(): Record<string, string> {
  return useSyncExternalStore(subscribeTabGroupLabels, labelsSnapshot, () => NO_LABELS);
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** The other rail project that already shows `candidateName`, if any. */
export function findNameConflict(
  path: string,
  candidateName: string,
  allRailPaths: readonly string[],
  nameOf: (path: string) => string = projectDisplayName,
): string | undefined {
  const wanted = nameKey(candidateName);
  if (!wanted) return undefined;
  const self = projectKey(path);
  return allRailPaths.find(
    (other) => projectKey(other) !== self && nameKey(nameOf(other)) === wanted,
  );
}

/** `base (hint)` when a hint is given, numbered (`base 2`, `base 3`…) until free. */
export function suggestUniqueName(
  base: string,
  takenNames: Iterable<string>,
  hint?: string,
): string {
  const taken = new Set<string>();
  for (const name of takenNames) taken.add(nameKey(name));
  const stem = hint?.trim() ? `${base.trim()} (${hint.trim()})` : base.trim();
  if (stem !== base.trim() && !taken.has(nameKey(stem))) return stem;
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

export function railProjectPaths(): string[] {
  return [...collectRailProjects(loadRecents(), "").values()].map((item) => item.path);
}

/** Display names need not be unique: full paths identify projects. */
export function projectNameError(
  _path: string,
  _name: string,
  _allRailPaths?: readonly string[],
): string | null {
  return null;
}

export type AutoNamedProject = { path: string; name: string; suggested: string };

/**
 * Compatibility for import callers: identical display names are allowed.
 */
export function autoNameOnConflict(
  _path: string,
  _hint?: string,
  _allRailPaths?: readonly string[],
): AutoNamedProject | null {
  return null;
}

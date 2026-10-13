import { basename } from "../../../platform/tauri/fs";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  saveAutoTabGroupLabel,
} from "../../workspace/model/tabGroups";
import { collectRailProjects, loadRecents } from "./recents";

/** The name a project's rail row shows: its label, else its folder name. */
export function projectDisplayName(
  path: string,
  labels: Record<string, string> = loadTabGroupLabels(),
): string {
  return resolveTabGroupLabel(projectKey(path), labels, projectName(path));
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

/** Why `name` cannot be this project's name, or null. An empty name means the folder name. */
export function projectNameError(
  path: string,
  name: string,
  allRailPaths: readonly string[] = railProjectPaths(),
): string | null {
  const candidate = name.trim() || basename(path);
  const labels = loadTabGroupLabels();
  const conflict = findNameConflict(path, candidate, allRailPaths, (other) =>
    projectDisplayName(other, labels),
  );
  return conflict
    ? `A project named "${candidate}" already exists. Choose a different name.`
    : null;
}

export type AutoNamedProject = { path: string; name: string; suggested: string };

/**
 * Gives a just-added project a unique automatic name when the one it would show
 * is already on the rail. A project that has a label is left alone, and the
 * project that had the name first is never renamed.
 */
export function autoNameOnConflict(
  path: string,
  hint?: string,
  allRailPaths: readonly string[] = railProjectPaths(),
): AutoNamedProject | null {
  const key = projectKey(path);
  const labels = loadTabGroupLabels();
  if (labels[key]?.trim()) return null;
  const nameOf = (other: string) => projectDisplayName(other, labels);
  const name = basename(path);
  if (!findNameConflict(path, name, allRailPaths, nameOf)) return null;
  const suggested = suggestUniqueName(
    name,
    allRailPaths.filter((other) => projectKey(other) !== key).map(nameOf),
    hint,
  );
  saveAutoTabGroupLabel(key, suggested);
  return { path, name, suggested };
}

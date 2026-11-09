import { listSkills, type DiscoveredSkill } from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/public/recents";

/**
 * Last skill list read for each project folder on this computer. The Skills page shows it the
 * moment it opens again while the list is re-read, instead of an empty page and a spinner on
 * every return. A remote project lists this computer's own skills without the project folder.
 */
const lastLists = new Map<string, DiscoveredSkill[]>();

const scopeOf = (cwd: string) => (isRemoteProjectPath(cwd) ? "" : cwd);

/** The previous list for this project, or `null` before the first successful read. */
export function cachedLocalSkills(cwd: string): DiscoveredSkill[] | null {
  return lastLists.get(scopeOf(cwd)) ?? null;
}

/** Reads this computer's skills and remembers a successful result. Failures are not cached. */
export async function loadLocalSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const scope = scopeOf(cwd);
  const next = await listSkills(scope);
  lastLists.set(scope, next);
  return next;
}

export function clearLocalSkillsCache() {
  lastLists.clear();
}

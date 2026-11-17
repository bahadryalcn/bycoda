import { canonicalHostPath } from "../../../src/features/sync/model/syncProjectId";

/**
 * Whether a desktop `organization.read` page lists the Host project folder. The desktop reports
 * paths with forward slashes while a Host row may keep backslashes, a trailing slash or another
 * drive-letter case, so both sides compare by the same canonical key the desktop uses.
 */
export function organizationPageListsProject(
  items: ReadonlyArray<{ cwd?: string }>,
  projectCwd: string,
): boolean {
  const key = canonicalHostPath(projectCwd);
  return items.some((item) => typeof item.cwd === "string" && canonicalHostPath(item.cwd) === key);
}

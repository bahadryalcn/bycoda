/**
 * Short identity context for project rows. Display names are not unique (the stored name or id is never
 * changed), so rows that would read the same get one short extra hint from their path.
 */

const nameKey = (name: string) => name.trim().toLowerCase();

/** The name of the folder that holds the project ("work" for `C:\code\work\app`), or "" without one. */
export function parentFolderLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return "";
  const parent = parts[parts.length - 2];
  // A Windows drive ("C:") is a root, not a folder name worth showing.
  return /^[A-Za-z]:$/.test(parent) ? "" : parent;
}

/**
 * The display names that more than one project row shares (compared trimmed, case-insensitively). Rows of
 * the same project path, however it is spelled, count once.
 */
export function duplicateProjectNames(
  projects: readonly { path: string; name: string }[],
  samePath: (a: string, b: string) => boolean = (a, b) => a === b,
): ReadonlySet<string> {
  const seen = new Map<string, string[]>();
  const duplicates = new Set<string>();
  for (const project of projects) {
    const key = nameKey(project.name);
    if (!key) continue;
    const paths = seen.get(key) ?? [];
    if (!paths.some((path) => samePath(path, project.path))) {
      paths.push(project.path);
      seen.set(key, paths);
      if (paths.length > 1) duplicates.add(key);
    }
  }
  return duplicates;
}

/** Whether `name` is one of the shared display names from `duplicateProjectNames`. */
export function isDuplicateProjectName(duplicates: ReadonlySet<string>, name: string): boolean {
  return duplicates.has(nameKey(name));
}

/**
 * The full identity for a tooltip or accessible name, one line: "name · where · detail". Empty parts drop
 * out, so a local project reads "name · /path" and a remote one "name · /path on machine (state)".
 */
export function identityLine(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

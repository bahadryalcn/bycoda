import { parentPath, pathKey, prettyCwd } from "../../../shared/lib/paths";

export type ProposedProjectGroup = {
  /** Group name: the folder the projects sit in. */
  name: string;
  /** The shared parent folder, as the first member spelled it. */
  parent: string;
  /** Members, ordered by path. */
  paths: string[];
};

function isRootOrHome(path: string): boolean {
  const key = pathKey(path);
  return (
    key === "/" ||
    /^[a-z]:\/?$/.test(key) ||
    /^\/\/[^/]+(\/[^/]+)?$/.test(key) ||
    prettyCwd(path) === "~"
  );
}

function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/**
 * Which folders deserve a rail group, going by the folder each project sits in.
 *
 * Projects that share a parent folder are grouped under that folder's name
 * (`G:/Projects/Acme/*` becomes "Acme"). The rule is deliberately
 * conservative, because it runs on a pile of newly imported projects:
 *
 * - a parent needs at least `minMembers` of the given projects, unless the user
 *   already has a group of that name for them to join, so a lone project never
 *   gets a group of its own;
 * - drive roots and the home folder are not containers worth a group;
 * - projects the user already placed in a group are never touched or counted;
 * - parents are matched case-insensitively the way Windows paths are, so
 *   `g:\Projects` and `G:\Projects` are one folder;
 * - two different parents with the same folder name are told apart by their
 *   location rather than merged.
 */
export function proposeProjectGroups(input: {
  paths: readonly string[];
  /** `pathKey`s of projects already assigned to a group. */
  grouped: ReadonlySet<string>;
  /** Names of the groups the user already has. */
  existingGroupNames?: readonly string[];
  minMembers?: number;
}): ProposedProjectGroup[] {
  const minMembers = input.minMembers ?? 2;
  const existing = new Set(
    (input.existingGroupNames ?? []).map((name) => name.toLocaleLowerCase()),
  );

  const seen = new Set<string>();
  const buckets = new Map<string, { parent: string; paths: string[] }>();
  for (const path of input.paths) {
    const key = pathKey(path);
    if (seen.has(key) || input.grouped.has(key)) continue;
    seen.add(key);
    const parent = parentPath(path);
    if (isRootOrHome(parent)) continue;
    const bucket = buckets.get(pathKey(parent));
    if (bucket) bucket.paths.push(path);
    else buckets.set(pathKey(parent), { parent, paths: [path] });
  }

  const kept = [...buckets.values()].filter(
    (bucket) =>
      bucket.paths.length >= minMembers ||
      existing.has(baseName(bucket.parent).toLocaleLowerCase()),
  );

  const byName = new Map<string, number>();
  for (const bucket of kept) {
    const name = baseName(bucket.parent).toLocaleLowerCase();
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  return kept
    .map((bucket) => {
      const base = baseName(bucket.parent);
      const clash = (byName.get(base.toLocaleLowerCase()) ?? 0) > 1;
      return {
        name: clash ? `${base} (${prettyCwd(parentPath(bucket.parent))})` : base,
        parent: bucket.parent,
        paths: [...bucket.paths].sort((a, b) => pathKey(a).localeCompare(pathKey(b))),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

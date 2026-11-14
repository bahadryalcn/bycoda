import { pathKey } from "../../../shared/lib/paths";
import {
  ModelRoutingScopeSchema,
  type ModelRoutingScope,
} from "../../../shared/model/host-contracts/model-routing";
import { modelRoutingProjectKey } from "../../../shared/model/modelRoutingPools";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupIdsToExpand,
  type ProjectGroup,
} from "./projectGroups";
import { knownProjectPaths, notifyProjectPathsChanged } from "./recents";

// Device-local: a project's folder differs per machine, so the tag is not synced. A group's tag is.
const KINDS_KEY = "bycoda.projectKinds";

function loadKinds(): Record<string, ModelRoutingScope> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KINDS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const kinds: Record<string, ModelRoutingScope> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const kind = ModelRoutingScopeSchema.safeParse(value);
      if (kind.success) kinds[key] = kind.data;
    }
    return kinds;
  } catch {
    return {};
  }
}

/** The project's own tag; `undefined` when untagged (it may still inherit its group's). */
export function projectKind(path: string): ModelRoutingScope | undefined {
  return loadKinds()[pathKey(path)];
}

/** Tags a project, or clears its own tag with `undefined`. */
export function setProjectKind(path: string, kind: ModelRoutingScope | undefined): boolean {
  const kinds = loadKinds();
  if (kind) kinds[pathKey(path)] = kind;
  else delete kinds[pathKey(path)];
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(kinds));
  } catch {
    return false;
  }
  notifyProjectPathsChanged();
  return true;
}

/** The tag a project inherits from its group (nearest tagged group first). */
export function inheritedProjectKind(
  path: string,
  groups: readonly ProjectGroup[] = loadProjectGroups(),
  assignments: Record<string, string> = loadProjectGroupAssignments(),
): ModelRoutingScope | undefined {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return projectGroupIdsToExpand(path, groups, assignments)
    .map((id) => byId.get(id)?.kind)
    .find((kind) => kind !== undefined);
}

/**
 * Every tagged project's scope: its own tag, else its group's, keyed the way the Host reads it
 * (`modelRoutingProjectKey`). Untagged projects are absent.
 */
export function effectiveProjectKinds(): Record<string, ModelRoutingScope> {
  const own = loadKinds();
  const assignments = loadProjectGroupAssignments();
  const groups = loadProjectGroups();
  const paths = new Map<string, string>();
  for (const path of [...knownProjectPaths(), ...Object.keys(assignments), ...Object.keys(own)])
    paths.set(pathKey(path), path);
  const out: Record<string, ModelRoutingScope> = {};
  for (const [key, path] of paths) {
    const kind = own[key] ?? inheritedProjectKind(path, groups, assignments);
    if (kind) out[modelRoutingProjectKey(path)] = kind;
  }
  return out;
}

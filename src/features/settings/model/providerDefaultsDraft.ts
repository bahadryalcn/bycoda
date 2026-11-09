import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { pathKey } from "../../../shared/lib/paths";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupWorkspaceRoot,
  type ProjectGroup,
} from "../../projects/public/projectGroups";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";

/**
 * Providers > Defaults edits a change set, not a stored scope. Each field holds the value the
 * owner picked (`null` clears it back to inheritance); Save writes the set to the chosen target.
 * The same change set can be applied to Global, one project, or every project of a group or
 * workspace, so the target is picked at save time.
 */
export type DraftValue = string | null;

export type ProviderDefaultsChange = {
  model?: DraftValue;
  effort?: DraftValue;
  runtimeMode?: DraftValue;
  extras?: Record<string, DraftValue>;
  /** Project and group targets: keep the provider out of the picker there. */
  hidden?: boolean;
};

export type DefaultsDraft = {
  defaultProvider?: HarnessId;
  providers: Partial<Record<HarnessId, ProviderDefaultsChange>>;
  /** Account overrides are machine-wide whatever the target. Keyed by `accountDraftKey`. */
  accounts: Record<string, ProviderDefaultsChange>;
};

export type DefaultsTarget =
  | { kind: "global" }
  | { kind: "project"; path: string }
  | { kind: "group"; id: string; workspace: boolean };

export const EMPTY_DRAFT: DefaultsDraft = { providers: {}, accounts: {} };

const GROUP_PREFIX = "group:";
const PROJECT_PREFIX = "project:";

export function targetValue(target: DefaultsTarget): string {
  if (target.kind === "global") return "global";
  return target.kind === "group"
    ? `${GROUP_PREFIX}${target.id}`
    : `${PROJECT_PREFIX}${target.path}`;
}

export function parseTargetValue(value: string, groups: readonly ProjectGroup[]): DefaultsTarget {
  if (value.startsWith(PROJECT_PREFIX))
    return { kind: "project", path: value.slice(PROJECT_PREFIX.length) };
  if (value.startsWith(GROUP_PREFIX)) {
    const group = groups.find((entry) => entry.id === value.slice(GROUP_PREFIX.length));
    if (group) return { kind: "group", id: group.id, workspace: Boolean(group.workspaceFile) };
  }
  return { kind: "global" };
}

export function accountDraftKey(harness: HarnessId, accountId: string): string {
  return `${harness}\n${accountId}`;
}

export function parseAccountDraftKey(key: string): { harness: HarnessId; accountId: string } {
  const split = key.indexOf("\n");
  return { harness: key.slice(0, split) as HarnessId, accountId: key.slice(split + 1) };
}

/**
 * Project keys a group target writes to: the group's own projects plus the projects of
 * workspaces nested in it. Projects added to the group later do not inherit.
 * shortcut: copies values into each member project; upgrade to a stored group layer in
 * new-session resolution if groups must stay live for future members.
 */
export function groupProjectKeys(
  groupId: string,
  groups: readonly ProjectGroup[] = loadProjectGroups(),
  assignments: Record<string, string> = loadProjectGroupAssignments(groups),
): string[] {
  const out = new Set<string>();
  const visit = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const [key, owner] of Object.entries(assignments)) if (owner === id) out.add(key);
    for (const group of groups) {
      const root = projectGroupWorkspaceRoot(group);
      if (group.id !== id && root && assignments[pathKey(root)] === id) visit(group.id, seen);
    }
    // A workspace root is a project of its own only when the workspace file lists it.
    const self = groups.find((group) => group.id === id);
    const root = self ? projectGroupWorkspaceRoot(self) : null;
    if (root && self?.workspaceFolders?.some((path) => pathKey(path) === pathKey(root))) {
      out.add(pathKey(root));
    }
  };
  visit(groupId, new Set());
  return [...out];
}

/** Stored values with the pending change applied on top. */
export function overlaySessionDefaults(
  base: ProviderSessionDefaults,
  change: ProviderDefaultsChange | undefined,
): ProviderSessionDefaults {
  if (!change) return base;
  const next: ProviderSessionDefaults = { ...base };
  if (change.effort !== undefined) next.effort = change.effort ?? undefined;
  if (change.runtimeMode !== undefined) {
    next.runtimeMode = (change.runtimeMode ?? undefined) as ProviderSessionDefaults["runtimeMode"];
  }
  if (change.extras) {
    const extras = { ...base.extras };
    for (const [id, value] of Object.entries(change.extras)) {
      if (value == null) delete extras[id];
      else extras[id] = value;
    }
    next.extras = extras;
  }
  return next;
}

const same = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? null) === (right ?? null);

/**
 * Records what the form now shows (`next`) against the stored values (`base`). Fields that
 * match the stored value leave the change set, so undoing an edit by hand clears it.
 */
export function recordSessionDefaults(
  previous: ProviderDefaultsChange | undefined,
  base: ProviderSessionDefaults,
  next: ProviderSessionDefaults,
): ProviderDefaultsChange | undefined {
  const change: ProviderDefaultsChange = {};
  if (previous?.model !== undefined) change.model = previous.model;
  if (previous?.hidden !== undefined) change.hidden = previous.hidden;
  if (!same(base.effort, next.effort)) change.effort = next.effort ?? null;
  if (!same(base.runtimeMode, next.runtimeMode)) change.runtimeMode = next.runtimeMode ?? null;
  const extras: Record<string, DraftValue> = {};
  for (const id of new Set([
    ...Object.keys(base.extras ?? {}),
    ...Object.keys(next.extras ?? {}),
  ])) {
    if (!same(base.extras?.[id], next.extras?.[id])) extras[id] = next.extras?.[id] ?? null;
  }
  if (Object.keys(extras).length > 0) change.extras = extras;
  return changeSize(change) > 0 ? change : undefined;
}

/** Sets or clears one non-session field; a value equal to the stored one leaves the set. */
export function recordField<K extends "model" | "hidden">(
  previous: ProviderDefaultsChange | undefined,
  field: K,
  value: ProviderDefaultsChange[K],
  stored: ProviderDefaultsChange[K] | undefined,
): ProviderDefaultsChange | undefined {
  const change: ProviderDefaultsChange = { ...previous };
  if ((value ?? null) === (stored ?? null)) delete change[field];
  else change[field] = value;
  return changeSize(change) > 0 ? change : undefined;
}

export function changeSize(change: ProviderDefaultsChange | undefined): number {
  if (!change) return 0;
  return (
    Number(change.model !== undefined) +
    Number(change.effort !== undefined) +
    Number(change.runtimeMode !== undefined) +
    Number(change.hidden !== undefined) +
    Object.keys(change.extras ?? {}).length
  );
}

export function draftSize(draft: DefaultsDraft): number {
  return (
    Number(draft.defaultProvider !== undefined) +
    Object.values(draft.providers).reduce((sum, change) => sum + changeSize(change), 0) +
    Object.values(draft.accounts).reduce((sum, change) => sum + changeSize(change), 0)
  );
}

/** Returns the draft with one provider's (or account's) change replaced, dropping empty entries. */
export function withChange(
  draft: DefaultsDraft,
  slot: { harness: HarnessId; accountId?: string },
  change: ProviderDefaultsChange | undefined,
): DefaultsDraft {
  const key = slot.accountId ? accountDraftKey(slot.harness, slot.accountId) : slot.harness;
  const bucket = { ...(slot.accountId ? draft.accounts : draft.providers) } as Record<
    string,
    ProviderDefaultsChange
  >;
  if (change) bucket[key] = change;
  else delete bucket[key];
  return slot.accountId ? { ...draft, accounts: bucket } : { ...draft, providers: bucket };
}

/** Projects a target writes to; empty for Global. */
export function targetProjects(target: DefaultsTarget): string[] {
  if (target.kind === "project") return [target.path];
  if (target.kind === "group") return groupProjectKeys(target.id);
  return [];
}

import { withRoomPrivacyMutation } from "../../group-lock/model/roomPrivacyProjection";
import { listSessionsByProject, type SessionSummary } from "../../sessions/public/sessionStore";

import { getGroupLockView } from "../../group-lock/model/groupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { buildMobileProjectDirectory } from "./mobileProjectDirectory";
import { loadCustomTabGroupLabels, saveTabGroupLabel } from "../../workspace/model/tabGroups";
import {
  loadProjectGroups,
  saveProjectGroups,
  setProjectGroupAssignment,
  updateProjectGroup,
} from "./projectGroups";
import { loadPinnedProjects, loadProjectRailOrder, saveProjectRailOrder } from "./recents";
import {
  addSessionToFolder,
  arrangeFolderSessions,
  canMoveFolder,
  createFolderWithSessions,
  folderDepth,
  loadSessionFolders,
  MAX_FOLDER_DEPTH,
  moveFolder,
  removeSessionFromFolder,
  renameFolder,
  reorderSessionFolders,
  saveSessionFolders,
  type FolderMoveTarget,
  type SessionFolder,
} from "../../sessions/public/sessionFolders";
import {
  loadSessionOrder,
  saveSessionOrder,
  type SessionOrder,
} from "../../sessions/public/sessionOrder";
import {
  executeOrganizationOperation,
  organizationFoldersForProject,
  organizationOrderForProject,
  type OrganizationOperation,
} from "../../sessions/public/sessionOrganizationOperations";
import {
  hydrateSessionOrganization,
  listSessionOrganizationGestures,
  NATIVE_SESSION_ORGANIZATION_ACTIVE,
  reconcileSessionOrganizationReceipt,
} from "../../sessions/public/sessionOrganizationStore";

export type ProjectOrganizationContext = {
  environmentId: string;
  sourceSessionId?: string;
  sourceThreadId?: string;
  projectId?: string;
  projectCwd: string;
  workingCwd: string;
  valid: () => boolean;
  authorize?: () => Promise<boolean>;
  /** Native pending operation holding the privacy permit for this exact write. */
  privacyRequestId?: string;
};
export type ProjectOrganizationSnapshot = {
  environmentId: string;
  sourceSessionId?: string;
  sourceThreadId?: string;
  projectId?: string;
  projectCwd: string;
  workingCwd: string;
  revision: string;
  atomic: false;
  name: string;
  customName: string;
  groupId: string | null;
  groups: { id: string; name: string }[];
  projectPosition: number;
  projectCount: number;
  folders: {
    id: string;
    name: string;
    sessionIds: string[];
    parentId?: string;
    pinned?: boolean;
    collapsed: boolean;
    ordered?: boolean;
  }[];
  sessions: { id: string; title: string }[];
  order: SessionOrder;
};
export type ProjectOrganizationStatus = {
  state: "unknown" | "applied" | "failed";
  snapshot?: ProjectOrganizationSnapshot;
  message?: string;
};
type Change = Record<string, unknown> & { kind: string };
type Deps = {
  sessions: (cwd: string) => Promise<SessionSummary[]>;
  hash: (value: string) => Promise<string>;
  salt: () => string;
};
const defaults: Deps = {
  sessions: listSessionsByProject,
  salt: () => crypto.randomUUID(),
  hash: async (value) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
};
const META_KEYS = [
  "bycoda.projectGroups",
  "bycoda.projectGroupAssignments",
  "bycoda.recentProjects",
  "bycoda.projectRailOrder",
  "bycoda.projectRailPinned",
  "bycoda.archivedProjects",
  "bycoda:tab-group:labels",
  "bycoda:tab-group:auto-labels",
  "bycoda:tab-group:workspace-labels",
  "bycoda.sessionFolders",
  "bycoda.sessionOrder",
];
const ARRAY_KEYS = new Set([
  "bycoda.projectGroups",
  "bycoda.recentProjects",
  "bycoda.projectRailOrder",
  "bycoda.projectRailPinned",
  "bycoda.archivedProjects",
]);
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unsupported organization field");
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\0\r\n]/.test(value);
const name = (value: unknown, empty = false): string => {
  if (
    typeof value !== "string" ||
    value.trim().length > 160 ||
    (!empty && !value.trim()) ||
    /[\0\r\n]/.test(value)
  )
    throw new Error("Invalid display name");
  return value.trim();
};
const ids = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    !value.every(id) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid organization selection");
  return value;
};
/** Reorders a visible subset in place; hidden/private entries keep their slots and metadata. */
function reordered<T>(all: T[], selected: T[], ordered: T[]): T[] {
  let at = 0;
  const members = new Set(selected);
  return all.map((value) => (members.has(value) ? ordered[at++] : value));
}
function move<T>(values: T[], value: T, step: unknown) {
  if (step !== "up" && step !== "down") throw new Error("Invalid order direction");
  const at = values.indexOf(value);
  const to = at + (step === "up" ? -1 : 1);
  if (at < 0 || to < 0 || to >= values.length) throw new Error("This item is already at the edge");
  const next = [...values];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
function rawMetadata() {
  const rows = META_KEYS.map((key) => {
    const raw = localStorage.getItem(key);
    if (raw && raw.length > 2 * 1024 * 1024)
      throw new Error("Organization metadata exceeds the review budget");
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (ARRAY_KEYS.has(key) ? !Array.isArray(parsed) : !record(parsed))
        throw new Error("Organization metadata is invalid");
    }
    return [key, raw];
  });
  const raw = JSON.stringify(rows);
  if (raw.length > 4 * 1024 * 1024)
    throw new Error("Organization metadata exceeds the review budget");
  return raw;
}

async function reviewedMetadata() {
  const raw = rawMetadata();
  if (!NATIVE_SESSION_ORGANIZATION_ACTIVE) return raw;
  const organization = await hydrateSessionOrganization();
  const combined = JSON.stringify([raw, organization.folders, organization.order]);
  if (combined.length > 4 * 1024 * 1024)
    throw new Error("Organization metadata exceeds the review budget");
  return combined;
}

function privacySignature() {
  const lock = getGroupLockView().lock;
  return JSON.stringify([[...lock.lockedGroupIds].sort(), [...lock.lockedProjectKeys].sort()]);
}

/** Optimistic review guard over canonical desktop metadata. This is deliberately not a cross-window CAS store. */
export function createProjectOrganizationControl(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const salt = deps.salt();
  const receipts = new Map<
    string,
    { scope: string; signature: string; status: ProjectOrganizationStatus }
  >();
  const scope = (context: ProjectOrganizationContext) =>
    JSON.stringify([
      context.environmentId,
      context.sourceSessionId,
      context.sourceThreadId,
      context.projectId,
      context.projectCwd,
      context.workingCwd,
    ]);
  const assert = (context: ProjectOrganizationContext) => {
    const lock = getGroupLockView().lock;
    if (
      !context.valid() ||
      !!context.sourceSessionId === !!context.sourceThreadId ||
      (!!context.sourceThreadId && !context.projectId) ||
      context.projectCwd.startsWith("remote://") ||
      isProjectLockedIn(lock, context.projectCwd) ||
      isProjectLockedIn(lock, context.workingCwd)
    )
      throw new Error("Organization source is unavailable or private");
  };
  const capture = async (context: ProjectOrganizationContext) => {
    assert(context);
    const privacy = privacySignature();
    const raw = await reviewedMetadata();
    const nativeOrganization = NATIVE_SESSION_ORGANIZATION_ACTIVE
      ? await hydrateSessionOrganization()
      : undefined;
    const stored = await deps.sessions(context.projectCwd);
    assert(context);
    if (stored.length > 500)
      throw new Error("Project conversations exceed the organization review budget");
    const directory = buildMobileProjectDirectory([context.projectCwd]);
    const project = directory.projects.find(
      (row) => pathKey(row.cwd) === pathKey(context.projectCwd),
    );
    if (!project) throw new Error("Project is unavailable in the desktop directory");
    const sessions = stored
      .filter((row) => !row.orchestrationLeadId && pathKey(row.cwd) === pathKey(context.projectCwd))
      .map((row) => ({ id: row.id, title: row.title.slice(0, 1000) }));
    const ownIds = new Set(sessions.map((row) => row.id));
    const folders = nativeOrganization
      ? organizationFoldersForProject(nativeOrganization, context.projectCwd)
      : loadSessionFolders(context.projectCwd);
    const sessionOrder = nativeOrganization
      ? organizationOrderForProject(nativeOrganization, context.projectCwd)
      : loadSessionOrder(context.projectCwd);
    if (folders.length > 500 || folders.some((folder) => folder.sessionIds.length > 500))
      throw new Error("Project folders exceed the organization review budget");
    const groupIds = new Set(directory.groups.map((row) => row.id));
    const groups = loadProjectGroups();
    if (groups.length > 500)
      throw new Error("Project groups exceed the organization review budget");
    const pinned = new Set(loadPinnedProjects().map(pathKey));
    const peers = directory.projects.filter(
      (row) =>
        row.groupId === project.groupId &&
        pinned.has(pathKey(row.cwd)) === pinned.has(pathKey(context.projectCwd)),
    );
    const revision = await deps.hash(
      JSON.stringify([salt, scope(context), raw, privacy, sessions]),
    );
    assert(context);
    if ((await reviewedMetadata()) !== raw || privacySignature() !== privacy)
      throw new Error("Desktop organization changed while reading; refresh it");
    const snapshot: ProjectOrganizationSnapshot = {
      environmentId: context.environmentId,
      sourceSessionId: context.sourceSessionId,
      sourceThreadId: context.sourceThreadId,
      projectId: context.projectId,
      projectCwd: context.projectCwd,
      workingCwd: context.workingCwd,
      revision,
      atomic: false,
      name: project.name,
      customName: loadCustomTabGroupLabels()[projectKey(context.projectCwd)] ?? "",
      groupId: project.groupId ?? null,
      groups: groups.filter((row) => groupIds.has(row.id)).map(({ id, name }) => ({ id, name })),
      projectPosition: peers.findIndex((row) => pathKey(row.cwd) === pathKey(context.projectCwd)),
      projectCount: peers.length,
      folders: folders.map(({ id, name, sessionIds, parentId, pinned, collapsed, ordered }) => ({
        id,
        name,
        sessionIds: sessionIds.filter((id) => ownIds.has(id)),
        parentId,
        pinned,
        collapsed,
        ordered,
      })),
      sessions,
      order: Object.fromEntries(
        Object.entries(sessionOrder).map(([list, entries]) => [
          list,
          entries.filter((id) => ownIds.has(id)),
        ]),
      ),
    };
    return { snapshot, raw, privacy, folders, sessionOrder, groups, peers, groupIds, ownIds };
  };
  const visibleStatus = async (
    context: ProjectOrganizationContext,
    status: ProjectOrganizationStatus,
  ) => (status.snapshot ? { ...status, snapshot: (await capture(context)).snapshot } : status);
  return async (
    context: ProjectOrganizationContext,
    action: string,
    input: Record<string, unknown>,
  ): Promise<ProjectOrganizationSnapshot | ProjectOrganizationStatus> => {
    assert(context);
    if (action === "organization.read") {
      exact(input, []);
      return (await capture(context)).snapshot;
    }
    if (action === "organization.status") {
      exact(input, ["operationId"]);
      if (!id(input.operationId)) throw new Error("Invalid organization operation");
      const receipt = receipts.get(input.operationId);
      if ((!receipt || receipt.status.state === "unknown") && NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        const saved = (await listSessionOrganizationGestures()).find(
          (entry) => entry.id === input.operationId,
        );
        const descriptor = saved?.descriptor;
        if (
          saved &&
          record(descriptor) &&
          descriptor.kind === "reviewed" &&
          descriptor.authorityScope === scope(context)
        ) {
          if (saved.state === "applied") return { state: "applied" };
          if (saved.state === "rejected") return { state: "failed" };
          const outcome = await reconcileSessionOrganizationReceipt(
            `${saved.id}:effect:${saved.attempt}`,
          );
          return outcome ? { state: outcome.applied ? "applied" : "failed" } : { state: "unknown" };
        }
      }
      return receipt?.scope === scope(context)
        ? visibleStatus(context, receipt.status)
        : { state: "unknown" };
    }
    if (action !== "organization.patch") throw new Error("Unsupported organization action");
    if (context.sourceThreadId && !context.authorize)
      throw new Error("Room effect authority is unavailable");
    exact(input, ["expectedRevision", "operationId", "change"]);
    if (
      !id(input.operationId) ||
      typeof input.expectedRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expectedRevision) ||
      !record(input.change) ||
      typeof input.change.kind !== "string"
    )
      throw new Error("Invalid organization review");
    const signature = JSON.stringify([input.expectedRevision, input.change]);
    const previous = receipts.get(input.operationId);
    if (previous) {
      if (previous.scope !== scope(context) || previous.signature !== signature)
        throw new Error("Organization operation ID was already used");
      return visibleStatus(context, previous.status);
    }
    if (receipts.size >= 128) throw new Error("Organization receipt capacity reached");
    const receipt = {
      scope: scope(context),
      signature,
      status: { state: "unknown" } as ProjectOrganizationStatus,
    };
    receipts.set(input.operationId, receipt);
    let nativeOutcome: "unknown" | "applied" | undefined;
    try {
      const current = await capture(context);
      if (current.snapshot.revision !== input.expectedRevision)
        throw new Error("Desktop organization changed; review it again");
      const change = input.change as Change;
      let save: () => void | Promise<void>;
      let verify: () => boolean | Promise<boolean>;
      const saveNative = async (operation: OrganizationOperation) => {
        const result = await executeOrganizationOperation(input.operationId as string, {
          kind: "reviewed",
          cwd: context.projectCwd,
          authorityScope: scope(context),
          expectedFolders: JSON.stringify(current.folders),
          expectedOrder: JSON.stringify(current.sessionOrder),
          operation,
        });
        if (result.state === "unknown") {
          nativeOutcome = "unknown";
          throw new Error("Organization outcome is unknown.");
        }
        if (result.state === "applied-unavailable") {
          nativeOutcome = "applied";
          throw new Error("Organization was applied, but refresh failed.");
        }
        if (result.state !== "applied")
          throw new Error("Desktop organization changed; review it again.");
        nativeOutcome = "applied";
      };
      const folder = (value: unknown) => {
        if (!id(value)) throw new Error("Invalid folder selection");
        const found = current.folders.find((row) => row.id === value);
        if (!found) throw new Error("Folder is not in this project");
        return found;
      };
      const sessions = (value: unknown) => {
        const chosen = ids(value);
        if (chosen.some((id) => !current.ownIds.has(id)))
          throw new Error("Conversation is not in this project");
        return chosen;
      };
      const saveFolders = (next: SessionFolder[], operation: OrganizationOperation) => {
        save = NATIVE_SESSION_ORGANIZATION_ACTIVE
          ? () => saveNative(operation)
          : () => saveSessionFolders(context.projectCwd, next);
        verify = NATIVE_SESSION_ORGANIZATION_ACTIVE
          ? async () =>
              JSON.stringify(
                organizationFoldersForProject(
                  await hydrateSessionOrganization(),
                  context.projectCwd,
                ),
              ) === JSON.stringify(next)
          : () => JSON.stringify(loadSessionFolders(context.projectCwd)) === JSON.stringify(next);
      };
      switch (change.kind) {
        case "projectName": {
          exact(change, ["kind", "name"]);
          const label = name(change.name, true);
          save = () => saveTabGroupLabel(projectKey(context.projectCwd), label);
          verify = () =>
            (loadCustomTabGroupLabels()[projectKey(context.projectCwd)] ?? "") === label;
          break;
        }
        case "projectGroup": {
          exact(change, ["kind", "groupId"]);
          if (
            change.groupId !== null &&
            (!id(change.groupId) || !current.groupIds.has(change.groupId))
          )
            throw new Error("Group is unavailable or private");
          const groupId = change.groupId as string | null;
          save = () => {
            setProjectGroupAssignment(context.projectCwd, groupId);
          };
          verify = () =>
            buildMobileProjectDirectory([context.projectCwd]).projects.find(
              (row) => pathKey(row.cwd) === pathKey(context.projectCwd),
            )?.groupId === (groupId ?? undefined);
          break;
        }
        case "projectMove": {
          exact(change, ["kind", "step"]);
          const peerPaths = current.peers.map((row) => row.cwd);
          const self = peerPaths.find((path) => pathKey(path) === pathKey(context.projectCwd))!;
          const nextPeers = move(peerPaths, self, change.step);
          const all = [
            ...new Map(
              [
                ...loadProjectRailOrder(),
                ...buildMobileProjectDirectory([context.projectCwd]).projects.map((row) => row.cwd),
              ].map((path) => [pathKey(path), path]),
            ).values(),
          ];
          const positions = new Map(peerPaths.map((path) => [pathKey(path), path]));
          const selected = all.filter((path) => positions.has(pathKey(path)));
          const ordered = nextPeers.map((path) =>
            selected.find((actual) => pathKey(actual) === pathKey(path))!,
          );
          const next = reordered(all, selected, ordered);
          save = () => saveProjectRailOrder(next);
          verify = () =>
            JSON.stringify(loadProjectRailOrder().map(pathKey)) ===
            JSON.stringify(next.map(pathKey));
          break;
        }
        case "groupName": {
          exact(change, ["kind", "name"]);
          const groupId = current.snapshot.groupId;
          if (!groupId || !current.groupIds.has(groupId))
            throw new Error("Assign this project to an available group first");
          const label = name(change.name);
          save = () => {
            if (!updateProjectGroup(groupId, (group) => ({ ...group, name: label })))
              throw new Error("Could not save group name");
          };
          verify = () => loadProjectGroups().find((row) => row.id === groupId)?.name === label;
          break;
        }
        case "groupMove": {
          exact(change, ["kind", "step"]);
          const group = current.groups.find((row) => row.id === current.snapshot.groupId);
          if (!group || !current.groupIds.has(group.id)) throw new Error("Group is unavailable");
          const visible = current.groups.filter((row) => current.groupIds.has(row.id));
          const next = reordered(current.groups, visible, move(visible, group, change.step));
          save = () => {
            if (!saveProjectGroups(next)) throw new Error("Could not save group order");
          };
          verify = () => JSON.stringify(loadProjectGroups()) === JSON.stringify(next);
          break;
        }
        case "folderCreate": {
          exact(change, ["kind", "name", "sessionIds", "parentId"]);
          const chosen = sessions(change.sessionIds);
          if (!chosen.length) throw new Error("Select a conversation for the folder");
          const parent =
            change.parentId === undefined || change.parentId === null
              ? undefined
              : folder(change.parentId);
          if (parent && folderDepth(current.folders, parent.id) >= MAX_FOLDER_DEPTH)
            throw new Error("Folder nesting limit reached");
          const label = name(change.name);
          const folderId = crypto.randomUUID();
          saveFolders(
            createFolderWithSessions(current.folders, chosen, label, {
              parentId: parent?.id,
              id: folderId,
            }).folders,
            {
              kind: "create",
              cwd: context.projectCwd,
              folderId,
              sessionIds: chosen,
              name: label,
              parentId: parent?.id,
            },
          );
          break;
        }
        case "folderName": {
          exact(change, ["kind", "folderId", "name"]);
          const target = folder(change.folderId);
          const label = name(change.name);
          saveFolders(renameFolder(current.folders, target.id, label), {
            kind: "rename",
            cwd: context.projectCwd,
            folderId: target.id,
            name: label,
          });
          break;
        }
        case "folderMove": {
          exact(change, ["kind", "folderId", "target"]);
          const targetFolder = folder(change.folderId);
          if (
            !record(change.target) ||
            !["into", "beside", "pinned", "root"].includes(String(change.target.kind))
          )
            throw new Error("Invalid folder destination");
          const target = change.target;
          exact(
            target,
            target.kind === "beside"
              ? ["kind", "id", "place"]
              : target.kind === "into"
                ? ["kind", "id"]
                : ["kind"],
          );
          if (target.kind === "into" || target.kind === "beside") folder(target.id);
          if (target.kind === "beside" && target.place !== "before" && target.place !== "after")
            throw new Error("Invalid folder placement");
          if (!canMoveFolder(current.folders, targetFolder.id, target as FolderMoveTarget))
            throw new Error("Folder move would create a cycle or exceed nesting");
          saveFolders(moveFolder(current.folders, targetFolder.id, target as FolderMoveTarget), {
            kind: "moveFolder",
            cwd: context.projectCwd,
            folderId: targetFolder.id,
            target: target as FolderMoveTarget,
          });
          break;
        }
        case "folderOrder": {
          exact(change, ["kind", "folderIds"]);
          const selected = ids(change.folderIds);
          selected.forEach(folder);
          saveFolders(reorderSessionFolders(current.folders, selected), {
            kind: "folderOrder",
            cwd: context.projectCwd,
            folderIds: selected,
          });
          break;
        }
        case "sessionMove": {
          exact(change, ["kind", "sessionId", "folderId"]);
          const [sessionId] = sessions([change.sessionId]);
          if (change.folderId === null) {
            saveFolders(removeSessionFromFolder(current.folders, sessionId), {
              kind: "assign",
              cwd: context.projectCwd,
              folderId: null,
              sessionIds: [sessionId],
            });
          } else {
            const to = folder(change.folderId);
            saveFolders(addSessionToFolder(current.folders, to.id, sessionId), {
              kind: "assign",
              cwd: context.projectCwd,
              folderId: to.id,
              sessionIds: [sessionId],
            });
          }
          break;
        }
        case "folderSessions": {
          exact(change, ["kind", "folderId", "sessionIds"]);
          const target = folder(change.folderId);
          const chosen = sessions(change.sessionIds);
          const unknown = target.sessionIds.filter((id) => !current.ownIds.has(id));
          saveFolders(arrangeFolderSessions(current.folders, target.id, [...chosen, ...unknown]), {
            kind: "reviewedFolderSessions",
            cwd: context.projectCwd,
            folderId: target.id,
            sessionIds: chosen,
            knownIds: [...current.ownIds],
          });
          break;
        }
        case "sessionOrder": {
          exact(change, ["kind", "list", "sessionIds"]);
          if (change.list !== "loose" && change.list !== "pinned")
            throw new Error("Invalid conversation list");
          const chosen = sessions(change.sessionIds);
          const before = current.sessionOrder;
          const list = change.list;
          const existing = before[list] ?? [];
          const next = {
            ...before,
            [list]: [...chosen, ...existing.filter((id) => !chosen.includes(id))],
          };
          save = NATIVE_SESSION_ORGANIZATION_ACTIVE
            ? () =>
                saveNative({
                  kind: "reviewedOrder",
                  cwd: context.projectCwd,
                  list,
                  sessionIds: chosen,
                })
            : () => saveSessionOrder(context.projectCwd, next);
          verify = NATIVE_SESSION_ORGANIZATION_ACTIVE
            ? async () =>
                JSON.stringify(
                  organizationOrderForProject(
                    await hydrateSessionOrganization(),
                    context.projectCwd,
                  ),
                ) === JSON.stringify(next)
            : () => JSON.stringify(loadSessionOrder(context.projectCwd)) === JSON.stringify(next);
          break;
        }
        default:
          throw new Error("Unsupported organization change");
      }
      assert(context);
      if (context.authorize && !(await context.authorize()))
        throw new Error("Organization authority revoked");
      await withRoomPrivacyMutation(async () => {
        if (context.authorize && !(await context.authorize()))
          throw new Error("Organization authority revoked");
        assert(context);
        if ((await reviewedMetadata()) !== current.raw || privacySignature() !== current.privacy)
          throw new Error("Desktop organization changed before saving");
        await save!();
        if (!(await verify!())) throw new Error("Organization save could not be verified");
      }, context.privacyRequestId);
      receipt.status = { state: "applied", snapshot: (await capture(context)).snapshot };
    } catch {
      receipt.status = {
        state: nativeOutcome ?? "failed",
        message:
          "The organization change could not be verified. Refresh the desktop state before another change.",
      };
    }
    return receipt.status;
  };
}
let defaultControl: ReturnType<typeof createProjectOrganizationControl> | undefined;
export function handleProjectOrganization(
  context: ProjectOrganizationContext,
  action: string,
  input: Record<string, unknown>,
) {
  defaultControl ??= createProjectOrganizationControl();
  return defaultControl(context, action, input);
}

import { pathKey } from "../../../shared/lib/paths";
import { openRemoteProject, parseRemotePath } from "../../connections/model/remoteProjects";
import { autoNameOnConflict } from "../../projects/model/projectNames";
import {
  isLocalProject,
  loadArchivedProjects,
  loadRecents,
  normalizeProjectPath,
  notifyProjectPathsChanged,
  rememberImportedProjects,
} from "../../projects/model/recents";
import { resolveProjectLocation } from "../../../platform/tauri/fs";
import { dismissProjectIds, markAutoAdded, persistDismissed } from "./syncAutoAdded";
import { knownRecordValue } from "./syncPeerState";
import {
  locallyAdoptableProjects,
  projectIdForPath,
  remoteOnlyProjects,
  setKnownHostEnvironments,
  type RemoteOnlyProject,
} from "./syncProjects";

/** A machine saved on this desktop whose host can open folders for it. */
export type RemoteOpenTarget = {
  environmentId: string;
  name: string;
  /** `userInitiated` requests may bring a dropped connection back up. */
  request: (method: string, params: unknown, userInitiated: boolean) => Promise<unknown>;
};

let openTargets: readonly RemoteOpenTarget[] = [];

/** Replaces the machines synced projects may be opened on; announces a change
 * so the rail re-reads which placeholders can be opened remotely. */
export function setRemoteOpenTargets(targets: readonly RemoteOpenTarget[]): void {
  const signature = (list: readonly RemoteOpenTarget[]) =>
    list.map((target) => `${target.environmentId}\n${target.name}`).join("\n\n");
  const changed = signature(targets) !== signature(openTargets);
  openTargets = targets;
  setKnownHostEnvironments(targets.map((target) => target.environmentId));
  if (changed) notifyProjectPathsChanged();
}

export type RemoteOpenMatch = { target: RemoteOpenTarget; path: string };

/** The connected machine that holds a project this desktop lacks, if any. */
export function remoteOpenMatch(
  project: RemoteOnlyProject,
  targets: readonly RemoteOpenTarget[] = openTargets,
): RemoteOpenMatch | undefined {
  if (!project.hostEnvironmentId) return undefined;
  const target = targets.find((entry) => entry.environmentId === project.hostEnvironmentId);
  return target ? { target, path: project.path } : undefined;
}

/** Tooltip for a project that is only on another machine. */
export function remoteOnlyProjectHint(
  project: RemoteOnlyProject,
  match: RemoteOpenMatch | undefined,
): string {
  if (match) return `${match.path} on ${match.target.name}. Click to open it there.`;
  return `${project.path} is on a machine that is not connected to this one. Add that machine under Connections to open it.`;
}

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

/** How long to leave a project alone after its nth consecutive failed open. */
export function autoAddRetryDelayMs(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

const retries = new Map<string, { failures: number; nextAt: number }>();

const addedListeners = new Set<() => void>();

/** Fires after sync put a remote project on the rail (recents changed in storage). */
export function subscribeSyncedProjectsAdded(listener: () => void): () => void {
  addedListeners.add(listener);
  return () => void addedListeners.delete(listener);
}

function onRail(key: string): boolean {
  const wanted = pathKey(key);
  return [...loadRecents(), ...loadArchivedProjects()].some(
    (item) => pathKey(item.path) === wanted,
  );
}

async function addRemotely(
  projectId: string,
  match: RemoteOpenMatch,
  userInitiated: boolean,
): Promise<string> {
  const remote = await openRemoteProject(
    (method, params) => match.target.request(method, params, userInitiated),
    match.target.environmentId,
    match.path,
  );
  // Appended, not opened: a background add must not reshuffle the rail or steal focus.
  rememberImportedProjects([{ path: remote.key, lastUsedAt: Date.now() }]);
  if (!onRail(remote.key)) throw new Error("The project rail is full");
  // The host names the folder by another path (a symlink, say): the project
  // is on the rail under that location, so the announced one is not offered again.
  if (projectIdForPath(remote.key) !== projectId) dismissProjectIds([projectId]);
  markAutoAdded(projectId, remote.key);
  retries.delete(projectId);
  return remote.key;
}

function announce(): void {
  notifyProjectPathsChanged();
  for (const listener of [...addedListeners]) listener();
}

/** Puts every synced project that is only on a connected machine on the rail
 * as a remote project. Each project is added at most once: one the user later
 * removes is remembered as dismissed. A machine that cannot be reached is
 * retried on later calls, with a growing delay. Returns the added rail keys. */
export async function autoAddRemoteProjects(now: number = Date.now()): Promise<string[]> {
  persistDismissed();
  if (openTargets.length === 0) return [];
  const added: string[] = [];
  const failedTargets = new Set<string>();
  for (const project of remoteOnlyProjects()) {
    const match = remoteOpenMatch(project);
    if (!match) continue;
    const retry = retries.get(project.projectId);
    if (retry && now < retry.nextAt) continue;
    const fail = () => {
      const failures = (retry?.failures ?? 0) + 1;
      retries.set(project.projectId, { failures, nextAt: now + autoAddRetryDelayMs(failures) });
    };
    // An unreachable machine fails every project on it: ask it once per call
    // and back the rest off with it.
    if (failedTargets.has(match.target.environmentId)) {
      fail();
      continue;
    }
    try {
      added.push(await addRemotely(project.projectId, match, false));
    } catch {
      fail();
      failedTargets.add(match.target.environmentId);
    }
  }
  if (added.length > 0) announce();
  return added;
}

async function folderExists(path: string): Promise<boolean> {
  try {
    return (await resolveProjectLocation(path)) !== null;
  } catch {
    // The check itself is unavailable: add the project rather than hide it.
    return true;
  }
}

/** Puts every synced project whose folder is on this machine, but which only
 * another desktop has opened (remotely, through this machine's host), on the
 * rail as a local project. Each project is added at most once: one the user
 * later removes is remembered as dismissed. Returns the added paths. */
export async function adoptLocalProjects(
  exists: (path: string) => Promise<boolean> = folderExists,
): Promise<string[]> {
  persistDismissed();
  const added: string[] = [];
  for (const project of locallyAdoptableProjects()) {
    const path = normalizeProjectPath(project.path);
    if (!isLocalProject(path) || !(await exists(path))) continue;
    rememberImportedProjects([{ path, lastUsedAt: Date.now() }]);
    if (!onRail(path) || projectIdForPath(path) !== project.projectId) continue;
    markAutoAdded(project.projectId, path);
    added.push(path);
  }
  if (added.length > 0) announce();
  return added;
}

/** A background add never asks for a name: a project whose name the rail
 * already shows gets a unique automatic one (`name (Machine name)` for a
 * project on another machine). Skipped when the project has a label here, or
 * the host holds one for it, which the next capture applies. */
export function nameAutoAddedProjects(machineId: string, paths: readonly string[]): void {
  for (const path of paths) {
    const projectId = projectIdForPath(path);
    const known = projectId ? knownRecordValue(machineId, "appearance", projectId) : undefined;
    const hostLabel = (known as { label?: unknown } | null | undefined)?.label;
    if (typeof hostLabel === "string" && hostLabel.trim()) continue;
    const remote = parseRemotePath(path);
    const machine = remote
      ? openTargets.find((target) => target.environmentId === remote.environmentId)
      : undefined;
    autoNameOnConflict(path, machine?.name);
  }
}

export type OpenSyncedProjectResult =
  | { status: "opened"; key: string }
  | { status: "failed"; error: unknown }
  | { status: "unavailable" };

/** The user clicked a project that is only on another machine: open it on
 * that machine when it is connected here. `unavailable` means no connected
 * machine has it, so there is nothing to open. */
export async function openSyncedProjectRemotely(
  projectId: string,
): Promise<OpenSyncedProjectResult> {
  const project = remoteOnlyProjects().find((entry) => entry.projectId === projectId);
  const match = project ? remoteOpenMatch(project) : undefined;
  if (!match) return { status: "unavailable" };
  try {
    const key = await addRemotely(projectId, match, true);
    announce();
    return { status: "opened", key };
  } catch (error) {
    return { status: "failed", error };
  }
}

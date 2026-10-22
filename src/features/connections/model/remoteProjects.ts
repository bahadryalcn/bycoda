import { isRemoteProjectPath, REMOTE_PROJECT_PREFIX } from "../../projects/model/recents";
import type { HostProject } from "./protocol";

/** A rail project whose folder lives on another machine. */
export type RemoteProject = {
  key: string;
  environmentId: string;
  /** The host's ID for this folder. */
  projectId: string;
  /** The folder's path on the host. */
  cwd: string;
};

const KEY = "bycoda.remote-projects.v2";
export const REMOTE_PROJECTS_CHANGED = "bycoda:remote-projects-changed";

const slashed = (path: string) => path.replace(/\\/g, "/");

export function remoteProjectKey(environmentId: string, cwd: string): string {
  return remotePath(environmentId, slashed(cwd).replace(/\/+$/, ""));
}

/** How this app addresses a path on another machine: under that machine's
 * `remote://<environment>/` root, so every file view can tell where it lives. */
export function remotePath(environmentId: string, hostPath: string): string {
  const path = slashed(hostPath);
  // Keep the second leading slash of a Windows UNC path.
  return `${REMOTE_PROJECT_PREFIX}${environmentId}/${path.startsWith("//") ? path.slice(1) : path.replace(/^\/+/, "")}`;
}

/** Git follows the tab's selected checkout, independently of the file/terminal cwd. */
export function remoteSessionGitCwd(project: Pick<RemoteProject, "environmentId" | "cwd">, gitCwd: string, projectCwd: string, tabCwd?: string): string {
  const cwd = tabCwd ?? (gitCwd !== projectCwd ? gitCwd : project.cwd);
  return isRemoteProjectPath(cwd) ? cwd : remotePath(project.environmentId, cwd);
}

/** The machine and host path behind a `remote://` path. */
export function parseRemotePath(
  path: string,
): { environmentId: string; hostPath: string } | undefined {
  if (!isRemoteProjectPath(path)) return undefined;
  const rest = slashed(path).slice(REMOTE_PROJECT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  const hostPath = rest.slice(slash + 1);
  return {
    environmentId: rest.slice(0, slash),
    // Windows hosts keep their drive letter and UNC prefix; POSIX paths regain their root.
    hostPath: /^[A-Za-z]:(\/|$)/.test(hostPath) ? hostPath : `/${hostPath}`,
  };
}

function readAll(): Record<string, RemoteProject> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, RemoteProject>) : {};
  } catch {
    return {};
  }
}

export function remoteProjectFor(path: string): RemoteProject | undefined {
  if (!isRemoteProjectPath(path)) return undefined;
  const key = slashed(path).replace(/\/+$/, "");
  const projects = readAll();
  return (
    projects[key] ??
    Object.values(projects).find(
      (project) => remoteProjectKey(project.environmentId, project.cwd) === key,
    )
  );
}

export function rememberRemoteProject(environmentId: string, project: HostProject): RemoteProject {
  const remote: RemoteProject = {
    key: remoteProjectKey(environmentId, project.cwd),
    environmentId,
    projectId: project.id,
    cwd: project.cwd,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [remote.key]: remote }));
  } catch {
    /* the rail entry still works for this session */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  return remote;
}

/** Opens a folder on a machine's host and saves it as a remote project; the
 * caller adds the returned key to the rail. */
export async function openRemoteProject(
  request: (method: string, params: unknown) => Promise<unknown>,
  environmentId: string,
  cwd: string,
): Promise<RemoteProject> {
  const project = (await request("projects.open", { cwd })) as HostProject;
  if (!project || typeof project.cwd !== "string" || typeof project.id !== "string")
    throw new Error("projects.open returned a malformed result");
  return rememberRemoteProject(environmentId, project);
}

/** Old hosts registered multiple IDs for one folder. Only the owning host can
 * prove filesystem equivalence (including case, separators and symlinks).
 * Never infer it from the session cwd, which may be a worktree or another folder.
 */
export async function verifyRemoteProjectAlias(
  request: (method: string, params: unknown) => Promise<unknown>,
  project: Pick<RemoteProject, "projectId" | "cwd">,
  actualProjectId: string,
): Promise<void> {
  if (actualProjectId === project.projectId) return;
  const mismatch = () => new Error("This session belongs to a different host project");
  const projects = (await request("projects.list", {})) as HostProject[];
  if (!Array.isArray(projects)) throw mismatch();
  const expected = projects.find((entry) => entry.id === project.projectId);
  const actual = projects.find((entry) => entry.id === actualProjectId);
  if (!expected || !actual || expected.cwd !== project.cwd) throw mismatch();
  const resolved = await Promise.all(
    [expected, actual].map(async (entry) => {
      const value = (await request("projects.open", { cwd: entry.cwd })) as HostProject;
      if (!value || typeof value.id !== "string" || !value.id) throw mismatch();
      return value.id;
    }),
  );
  if (resolved[0] !== resolved[1]) throw mismatch();
}

export function remoteProjectsOn(environmentId: string): RemoteProject[] {
  return Object.values(readAll()).filter((project) => project.environmentId === environmentId);
}

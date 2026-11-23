import { pathKey } from "../../../shared/lib/paths";
import { gitRemotes } from "../../../platform/tauri/fs";
import { readRemoteConnection } from "../../connections/public/remoteHealth";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import type { RecentProject } from "./recents";

/**
 * Which repository each rail project is a checkout of, so the same repository
 * on several machines shows as one project. The identity is the `origin`
 * remote, read on the machine that holds the folder; a folder without a
 * hosted remote links to nothing.
 */
const KEY = "bycoda.projectRepositories";
const SEPARATE_KEY = "bycoda.projectLinkSeparate";
const CHANGED = "bycoda:project-repositories-changed";
const CONCURRENT_READS = 4;

/** pathKey → repository id; "" for a folder known to have no hosted remote. */
export type ProjectRepositories = Readonly<Record<string, string>>;

/** `github.com/owner/repo` for every spelling of a hosted remote URL, "" for a local one. */
export function repositoryIdFromUrl(url: string): string {
  const text = url.trim();
  const match =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(text) ??
    // scp-like `[user@]host:path`; a one-letter host is a Windows drive.
    /^(?:[^@/\\]+@)?([^/:\\]{2,}):(?!\/\/)(.+)$/.exec(text);
  if (!match || /^file:/i.test(text)) return "";
  const path = match[2]
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return path ? `${match[1]}/${path}`.toLowerCase() : "";
}

let parsed: { raw: string | null; value: ProjectRepositories } | undefined;

/** The saved identities; the same object until they change. */
export function loadProjectRepositories(): ProjectRepositories {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // unreadable storage links nothing
  }
  if (parsed && parsed.raw === raw) return parsed.value;
  const value: Record<string, string> = {};
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [key, id] of Object.entries(data)) if (typeof id === "string") value[key] = id;
    }
  } catch {
    // a damaged value is read again from git
  }
  parsed = { raw, value };
  return value;
}

/** pathKeys of projects the owner chose to show as their own row, never folded. */
export type SeparatedProjects = ReadonlySet<string>;

let parsedSeparate: { raw: string | null; value: SeparatedProjects } | undefined;

/** The projects shown separately; the same set until it changes. */
export function loadSeparatedProjects(): SeparatedProjects {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SEPARATE_KEY);
  } catch {
    // unreadable storage separates nothing
  }
  if (parsedSeparate && parsedSeparate.raw === raw) return parsedSeparate.value;
  const value = new Set<string>();
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(data)) for (const key of data) if (typeof key === "string") value.add(key);
  } catch {
    // a damaged value separates nothing
  }
  parsedSeparate = { raw, value };
  return value;
}

function saveSeparatedProjects(keys: ReadonlySet<string>): void {
  try {
    const raw = JSON.stringify([...keys].sort());
    if ((localStorage.getItem(SEPARATE_KEY) ?? "[]") === raw) return;
    localStorage.setItem(SEPARATE_KEY, raw);
  } catch {
    return; // private mode / quota: the choice is not kept
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Shows a project as its own row (`true`) or lets it fold with its other machines again. */
export function setProjectShownSeparately(path: string, separate: boolean): void {
  const next = new Set(loadSeparatedProjects());
  if (separate) next.add(pathKey(path));
  else next.delete(pathKey(path));
  saveSeparatedProjects(next);
}

function saveProjectRepositories(value: Record<string, string>): void {
  try {
    const raw = JSON.stringify(value);
    if (localStorage.getItem(KEY) === raw) return;
    localStorage.setItem(KEY, raw);
  } catch {
    return; // private mode / quota: the rail keeps separate rows
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeProjectRepositories(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === SEPARATE_KEY) listener();
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function machineOf(path: string): string {
  return parseRemotePath(path)?.environmentId ?? "";
}

export type ProjectLinks = {
  /** The rail row a project shows under: itself unless it is another machine's copy of a row. */
  rowOf: (path: string) => string;
  /** Every copy shown under the same row as `path`, itself included. */
  copiesOf: (path: string) => string[];
};

/**
 * Folds copies of one repository on different machines into one row. Two
 * copies on the same machine are separate clones and stay separate rows. The
 * row is this computer's copy when there is one. A separated project never
 * folds and nothing folds into it.
 */
export function projectLinks(
  paths: readonly string[],
  repositories: ProjectRepositories,
  separated: SeparatedProjects = new Set(),
): ProjectLinks {
  const rows = new Map<string, { path: string; machines: Map<string, string> }[]>();
  // Sorted so the same copies fold the same way whatever order the rail has them in.
  const ordered = [...new Map(paths.map((path) => [pathKey(path), path])).entries()].sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [key, path] of ordered) {
    const repository = repositories[key];
    if (!repository || separated.has(key)) continue;
    const machine = machineOf(path);
    const candidates = rows.get(repository) ?? [];
    let row = candidates.find((entry) => !entry.machines.has(machine));
    if (!row) {
      row = { path, machines: new Map() };
      candidates.push(row);
      rows.set(repository, candidates);
    }
    row.machines.set(machine, path);
    if (!machine) row.path = path;
  }
  const rowByKey = new Map<string, { path: string; machines: Map<string, string> }>();
  for (const candidates of rows.values()) {
    for (const row of candidates) {
      if (row.machines.size < 2) continue;
      for (const copy of row.machines.values()) rowByKey.set(pathKey(copy), row);
    }
  }
  return {
    rowOf: (path) => rowByKey.get(pathKey(path))?.path ?? path,
    copiesOf: (path) => {
      const row = rowByKey.get(pathKey(path));
      return row ? [...row.machines.values()] : [path];
    },
  };
}

/** The links among the given rail projects, from the identities saved so far. */
export function savedProjectLinks(recents: readonly RecentProject[]): ProjectLinks {
  return projectLinks(
    recents.map((item) => item.path),
    loadProjectRepositories(),
    loadSeparatedProjects(),
  );
}

/** Whether another rail project on a different machine is a checkout of the same repository. */
export function hasLinkableCopy(
  path: string,
  paths: readonly string[],
  repositories: ProjectRepositories,
): boolean {
  const repository = repositories[pathKey(path)];
  if (!repository) return false;
  const machine = machineOf(path);
  return paths.some(
    (other) => repositories[pathKey(other)] === repository && machineOf(other) !== machine,
  );
}

/** The copy of `path`'s project on a machine (`undefined` is this computer), if the rail has one. */
export function linkedProjectOnMachine(
  links: ProjectLinks,
  path: string,
  environmentId: string | undefined,
): string | undefined {
  return links.copiesOf(path).find((copy) => machineOf(copy) === (environmentId ?? ""));
}

/** The rail's projects with every folded copy removed; a row is as recent as its newest copy. */
export function foldLinkedProjects(
  recents: readonly RecentProject[],
  links: ProjectLinks,
): RecentProject[] {
  const newest = new Map<string, number>();
  for (const item of recents) {
    const key = pathKey(links.rowOf(item.path));
    newest.set(key, Math.max(newest.get(key) ?? 0, item.openedAt));
  }
  return recents
    .filter((item) => pathKey(links.rowOf(item.path)) === pathKey(item.path))
    .map((item) => {
      const openedAt = newest.get(pathKey(item.path)) ?? item.openedAt;
      return openedAt === item.openedAt ? item : { ...item, openedAt };
    });
}

/** Folders whose remote was read this run; a remote read that failed is asked again. */
const settled = new Set<string>();
const reading = new Set<string>();

async function readRepository(path: string): Promise<string> {
  const remotes = await gitRemotes(path);
  const remote = remotes.find((entry) => entry.name === "origin") ?? remotes[0];
  return remote ? repositoryIdFromUrl(remote.url) : "";
}

/**
 * Reads the repository of each rail project once per run and forgets the ones
 * that left the rail. A remote project is read only while its machine is
 * connected, and keeps its last identity until then.
 */
export async function refreshProjectRepositories(paths: readonly string[]): Promise<void> {
  const keys = new Set(paths.map(pathKey));
  for (const key of settled) if (!keys.has(key)) settled.delete(key);
  const pending = paths.filter((path) => {
    const key = pathKey(path);
    if (path === "~" || settled.has(key) || reading.has(key)) return false;
    const machine = machineOf(path);
    return !machine || readRemoteConnection(machine).status === "connected";
  });
  for (const path of pending) reading.add(pathKey(path));
  const found = new Map<string, string>();
  const next = [...pending];
  const worker = async () => {
    for (let path = next.shift(); path !== undefined; path = next.shift()) {
      const key = pathKey(path);
      try {
        found.set(key, await readRepository(path));
        settled.add(key);
      } catch {
        // Not a repository, or the machine went away: a local folder is not asked again.
        if (!machineOf(path)) settled.add(key);
      } finally {
        reading.delete(key);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_READS }, worker));
  const saved = loadProjectRepositories();
  const value: Record<string, string> = {};
  for (const key of keys) {
    const id = found.get(key) ?? saved[key];
    if (id !== undefined) value[key] = id;
  }
  saveProjectRepositories(value);
  const separated = loadSeparatedProjects();
  if ([...separated].some((key) => !keys.has(key)))
    saveSeparatedProjects(new Set([...separated].filter((key) => keys.has(key))));
}

/** Test seam: forget what this run has read. */
export function resetProjectRepositoryReads(): void {
  settled.clear();
  reading.clear();
  parsed = undefined;
  parsedSeparate = undefined;
}

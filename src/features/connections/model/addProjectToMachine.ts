import {
  cloneRepo,
  gitRemotes,
  homeDir,
  listDir,
  readTextFile,
  writeTextFileChecked,
} from "../../../platform/tauri/fs";
import { loadRemoteCapabilities, remoteRequest } from "./connections";
import { pickFolderOnMachine, type MachineFolderTarget } from "./machineFolderPick";
import type { HostDirectory } from "./protocol";
import { openRemoteProject } from "./remoteProjects";

/**
 * Putting a project this app already has on one machine onto another: clone
 * its repository there (and bring chosen files git ignores), or point at a
 * folder that machine already has.
 */
export const ADD_PROJECT_TO_MACHINE_EVENT = "bycoda:add-project-to-machine";
const CLONE_CAPABILITY = "projects.clone.v1";
const CLONE_PROGRESS_INTERVAL_MS = 1_000;
// shortcut: a bounded walk instead of a git query on the owning machine; ignored
// files deeper or later than this are not offered. Upgrade to a `git ls-files
// --others --ignored` command when a project needs them.
const IGNORED_WALK = { depth: 3, folders: 120, files: 60 };

export interface AddProjectToMachineRequest {
  target: MachineFolderTarget;
  /** The copy the project is added from. */
  sourceCwd: string;
  /** The source repository's remote URL. */
  url: string;
  /** Called by the host that will show the dialog, before the event returns. */
  claim: () => void;
  /** Answers once with the new project's rail path, or undefined on cancel. */
  settle: (path: string | undefined) => void;
}

/**
 * Adds the project at `sourceCwd` to a machine and resolves its rail path
 * there, or undefined when the user cancels. A project without a hosted remote
 * cannot be cloned, so it goes straight to that machine's folder browser.
 */
export async function addProjectToMachine(
  target: MachineFolderTarget,
  sourceCwd: string,
): Promise<string | undefined> {
  const url = await sourceCloneUrl(sourceCwd).catch(() => undefined);
  if (!url) return pickFolderOnMachine(target);
  let claimed = false;
  const answer = new Promise<string | undefined>((resolve) => {
    let settled = false;
    const request: AddProjectToMachineRequest = {
      target,
      sourceCwd,
      url,
      claim: () => {
        claimed = true;
      },
      settle: (path) => {
        if (settled) return;
        settled = true;
        resolve(path);
      },
    };
    window.dispatchEvent(new CustomEvent(ADD_PROJECT_TO_MACHINE_EVENT, { detail: request }));
  });
  return claimed ? answer : pickFolderOnMachine(target);
}

/** The `origin` (else first) remote of a checkout, when it is a hosted URL. */
export async function sourceCloneUrl(cwd: string): Promise<string | undefined> {
  const remotes = await gitRemotes(cwd);
  const url = (remotes.find((remote) => remote.name === "origin") ?? remotes[0])?.url.trim();
  return url && parseHostedUrl(url) ? url : undefined;
}

function parseHostedUrl(url: string): { host: string; path: string; ssh: boolean } | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url);
  if (scheme) {
    if (!/^(https?|ssh|git)$/i.test(scheme[1])) return undefined;
    return { host: scheme[2], path: scheme[3], ssh: /^ssh$/i.test(scheme[1]) };
  }
  // scp-like `git@host:path`.
  const scp = /^git@([^/:\\]{2,}):(?!\/\/)(.+)$/.exec(url);
  return scp ? { host: scp[1], path: scp[2], ssh: true } : undefined;
}

export type CloneProtocol = "ssh" | "https";

/** The same repository over SSH and over HTTPS; `current` is how the source reaches it. */
export function cloneUrlChoices(url: string): Record<CloneProtocol, string> & {
  current: CloneProtocol;
} {
  const parsed = parseHostedUrl(url.trim());
  if (!parsed) return { ssh: url, https: url, current: "https" };
  const path = `${parsed.path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}.git`;
  return {
    // The source's own spelling is kept: it may carry a port or user the other form cannot.
    ssh: parsed.ssh ? url.trim() : `git@${parsed.host}:${path}`,
    https:
      parsed.ssh || !/^https?:/i.test(url.trim()) ? `https://${parsed.host}/${path}` : url.trim(),
    current: parsed.ssh ? "ssh" : "https",
  };
}

/** `owner/repo` for display and `repo` as the folder `git clone` creates. */
export function repositoryNames(url: string): { label: string; folder: string } {
  const path = (parseHostedUrl(url.trim())?.path ?? url)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return { label: path, folder: path.split("/").pop() ?? path };
}

export type AddTargetMachine = { id: string; environmentId: string };

/** The folder new clones go under by default: the machine's home. */
export async function defaultCloneParent(machine: AddTargetMachine | undefined): Promise<string> {
  if (!machine) return homeDir();
  const directory = await remoteRequest<HostDirectory>(
    machine.id,
    "projects.browse",
    {},
    false,
    true,
  );
  return directory.home ?? directory.path;
}

function joinPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/** Where the clone will land, for display before it runs. */
export function cloneDestination(parent: string, url: string): string {
  return joinPath(parent.trim(), repositoryNames(url).folder);
}

/**
 * Files git ignores in a checkout, as paths relative to its root. Folders git
 * ignores whole (dependencies, build output) are left out with everything in them.
 */
export async function listIgnoredFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let folders = 0;
  let level: { path: string; relative: string }[] = [{ path: root, relative: "" }];
  for (let depth = 0; depth <= IGNORED_WALK.depth && level.length > 0; depth += 1) {
    const next: typeof level = [];
    for (const folder of level) {
      if (folders >= IGNORED_WALK.folders || files.length >= IGNORED_WALK.files) return files;
      folders += 1;
      // A folder that cannot be read contributes nothing; the rest is still offered.
      const entries = await listDir(folder.path).catch(() => []);
      for (const entry of entries) {
        const relative = folder.relative ? `${folder.relative}/${entry.name}` : entry.name;
        if (entry.isDir) {
          if (!entry.ignored && entry.name !== ".git") next.push({ path: entry.path, relative });
        } else if (entry.ignored && files.length < IGNORED_WALK.files) files.push(relative);
      }
    }
    level = next;
  }
  return files;
}

/** Environment files are what a fresh clone most often cannot run without. */
export function copiedByDefault(relative: string): boolean {
  return /^\.env(\..+)?$/.test(relative.split("/").pop() ?? "");
}

export type CloneProgress = { phase: string; percent: number | null };

/**
 * Clones `url` under `parent` on the target machine and registers the clone as
 * a project there. Resolves the project's rail path.
 */
export async function cloneProjectToMachine(input: {
  machine: AddTargetMachine | undefined;
  url: string;
  parent: string;
  onProgress?: (progress: CloneProgress) => void;
}): Promise<string> {
  const { machine, url, onProgress } = input;
  const parent = input.parent.trim();
  if (!machine) return cloneRepo(url, parent);
  const capabilities = await loadRemoteCapabilities(machine.environmentId);
  if (capabilities && !capabilities.includes(CLONE_CAPABILITY))
    throw new Error("This host cannot clone repositories. Update it and try again.");
  const operationId = crypto.randomUUID();
  const poll = setInterval(() => {
    remoteRequest<{ progress: (CloneProgress & { state: string }) | null }>(
      machine.id,
      "projects.clone.progress",
      { operationId },
    )
      .then(({ progress }) => {
        if (progress?.state === "running") onProgress?.(progress);
      })
      // Progress is a courtesy; the clone request itself reports the outcome.
      .catch(() => undefined);
  }, CLONE_PROGRESS_INTERVAL_MS);
  try {
    const cloned = await remoteRequest<{ path: string }>(
      machine.id,
      "projects.clone",
      { url, parentPath: parent, name: repositoryNames(url).folder, operationId },
      false,
      true,
    );
    const project = await openRemoteProject(
      (method, params) => remoteRequest(machine.id, method, params, false, true),
      machine.environmentId,
      cloned.path,
    );
    return project.key;
  } finally {
    clearInterval(poll);
  }
}

/**
 * Copies files git does not track from one copy of a project to another.
 * Resolves the files that could not be copied; the clone stands either way.
 */
export async function copyIgnoredFiles(
  sourceRoot: string,
  destinationRoot: string,
  files: readonly string[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const relative of files) {
    try {
      // shortcut: text only, since both machines share a text write and no binary
      // one; a binary file lands in `failed`. Upgrade with a chunked byte copy.
      const text = await readTextFile(`${sourceRoot.replace(/[\\/]+$/, "")}/${relative}`);
      await writeTextFileChecked(`${destinationRoot.replace(/[\\/]+$/, "")}/${relative}`, text);
    } catch {
      failed.push(relative);
    }
  }
  return failed;
}

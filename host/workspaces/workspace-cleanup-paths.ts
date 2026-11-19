import { lstat, opendir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { lstatSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import {
  canonicalWorkspaceDirectorySync,
  ordinaryWorkspacePath,
  workspacePathKey,
} from "./workspace-paths";
import type { WorkspaceCleanupPlan } from "./workspace-contracts";

export const exists = (path: string) => !!lstatSync(path, { throwIfNoEntry: false });
/** True only when lstat reports ENOENT for the entry itself; every other failure stays an error. */
export async function entryMissing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
export const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Resolve aliases above the boundary, then inspect the boundary and its descendants without following links. */
export function assertNoFollowPath(root: string, target: string): { root: string; target: string } {
  // Compare one Windows namespace before checking lexical containment. Keep links
  // unresolved here so the boundary/descendant no-follow walk still inspects them.
  root = ordinaryWorkspacePath(root);
  target = ordinaryWorkspacePath(target);
  if (/(^|[\\/])\.{1,2}([\\/]|$)/.test(root) || /(^|[\\/])\.{1,2}([\\/]|$)/.test(target))
    throw new Error("Cleanup requires normalized absolute paths without dot segments.");
  if (!isAbsolute(root) || !isAbsolute(target))
    throw new Error("Cleanup path is outside its absolute managed root.");
  const boundary = join(canonicalWorkspaceDirectorySync(dirname(root)), basename(root));
  // A registry row may already use the canonical spelling while its configured root still uses an alias.
  const within = (base: string) =>
    workspacePathKey(base) === workspacePathKey(target) || inside(base, resolve(target));
  const base = within(resolve(root)) ? resolve(root) : boundary;
  if (!within(base)) throw new Error("Cleanup path is outside its absolute managed root.");
  const parts = relative(base, resolve(target)).split(sep).filter(Boolean);
  let current = boundary;
  for (const part of ["", ...parts]) {
    if (part) current = join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info?.isSymbolicLink())
      throw new Error("Cleanup cannot follow a reparse point or symbolic link.");
    if (info && !info.isDirectory()) throw new Error("Cleanup path ancestor is not a directory.");
  }
  return { root: boundary, target: current };
}

export type Link = WorkspaceCleanupPlan["links"][number];
const dependency = (path: string, root: string) =>
  relative(root, path).split(sep).includes("node_modules");
/** Windows metadata reports unknown reparse tags too; traversal never enters any reparse entry. */
export async function inventoryWorkspaceLinks(target: string): Promise<Link[]> {
  if (!exists(target)) return [];
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $result=[Collections.Generic.List[object]]::new(); function Walk([string]$p) { foreach($e in Get-ChildItem -LiteralPath $p -Force) { if(($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.Add(@{path=$e.FullName;type=$e.LinkType}) } elseif($e.PSIsContainer) { Walk $e.FullName } } }; Walk $env:BYCODA_CLEANUP_SCAN; ConvertTo-Json -Compress -InputObject @($result.ToArray())`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, BYCODA_CLEANUP_SCAN: target },
        encoding: "utf8",
      },
    );
    return (JSON.parse(stdout.trim()) as { path: string; type: string }[]).map((entry) => ({
      path: entry.path,
      kind:
        dependency(entry.path, target) &&
        entry.type === "Junction" &&
        !/Volume\{|GLOBALROOT|\\Device\\/i.test(readlinkSync(entry.path))
          ? "dependencyJunction"
          : dependency(entry.path, target) && entry.type === "SymbolicLink"
            ? "dependencySymlink"
            : "unsafe",
    }));
  }
  return walkPosixWorkspaceLinks(target);
}

const WALK_CONCURRENCY = 8;
type EntryKind = "directory" | "file" | "link" | "other";
async function entryKind(entry: Dirent, path: string): Promise<EntryKind> {
  // Dirent types come from the same no-follow directory read; filesystems that
  // report an unknown type fall back to lstat, never to stat.
  const info =
    entry.isSymbolicLink() || entry.isDirectory() || entry.isFile() ? entry : await lstat(path);
  if (info.isSymbolicLink()) return "link";
  if (info.isDirectory()) return "directory";
  return info.isFile() ? "file" : "other";
}

/**
 * Non-Windows inventory: an asynchronous, bounded-concurrency, no-follow walk so a
 * large dependency tree never blocks the Host event loop. Every directory read is
 * awaited, so RPC, websockets and session streams keep running between entries.
 * Symbolic links are recorded and never entered; read errors fail the inventory.
 * `firstOnly` stops at the first link for "no links may remain" checks.
 * @internal Exported for the platform-independent regression test.
 */
export async function walkPosixWorkspaceLinks(
  target: string,
  options: { firstOnly?: boolean } = {},
): Promise<Link[]> {
  const links: Link[] = [];
  const pending = [target];
  let active = 0;
  let failure: unknown = null;
  const done = () => failure !== null || (!!options.firstOnly && links.length > 0);
  await new Promise<void>((resolveWalk, rejectWalk) => {
    const pump = () => {
      if (failure !== null) {
        if (active === 0) rejectWalk(failure);
        return;
      }
      if (done() || (pending.length === 0 && active === 0)) {
        if (active === 0) resolveWalk();
        return;
      }
      while (active < WALK_CONCURRENCY && pending.length > 0) {
        const directory = pending.pop()!;
        active += 1;
        void readDirectory(directory)
          .catch((error: unknown) => {
            failure ??= error;
          })
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };
    const readDirectory = async (directory: string) => {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (done()) break;
        const child = join(directory, entry.name);
        const kind = await entryKind(entry, child);
        if (kind === "link")
          links.push({
            path: child,
            kind: dependency(child, target) ? "dependencySymlink" : "unsafe",
          });
        else if (kind === "directory") pending.push(child);
        else if (kind === "other") links.push({ path: child, kind: "unsafe" });
      }
    };
    pump();
  });
  // Concurrent reads finish in any order; keep the inventory deterministic.
  return links.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** True when any link or special entry remains; stops at the first one off Windows. */
export async function workspaceHasLinks(target: string): Promise<boolean> {
  if (!exists(target)) return false;
  if (process.platform === "win32") return (await inventoryWorkspaceLinks(target)).length > 0;
  return (await walkPosixWorkspaceLinks(target, { firstOnly: true })).length > 0;
}

/** Reject unknown reparse ancestors on Windows (Node only identifies known symlink tags). */
export async function validateWorkspaceCleanupPaths(root: string, target: string) {
  const paths = assertNoFollowPath(root, target);
  if (process.platform !== "win32") return paths;
  const script = `$ErrorActionPreference='Stop'; $p=$env:BYCODA_CLEANUP_SCAN; while($p) { if(Test-Path -LiteralPath $p) { $e=Get-Item -LiteralPath $p -Force; if(($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe reparse ancestor' } }; if($p -eq $env:BYCODA_CLEANUP_ROOT) { break }; $p=[IO.Path]::GetDirectoryName($p) }`;
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, BYCODA_CLEANUP_SCAN: paths.target, BYCODA_CLEANUP_ROOT: paths.root },
    },
  );
  return paths;
}

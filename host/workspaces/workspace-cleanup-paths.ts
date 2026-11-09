import { lstat } from "node:fs/promises";
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
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
  const links: Link[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const info = lstatSync(child);
      if (info.isSymbolicLink())
        links.push({
          path: child,
          kind: dependency(child, target) ? "dependencySymlink" : "unsafe",
        });
      else if (info.isDirectory()) walk(child);
      else if (!info.isFile()) links.push({ path: child, kind: "unsafe" });
    }
  };
  walk(target);
  return links;
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

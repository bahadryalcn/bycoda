import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative, sep } from "node:path";
import { sameHostPath } from "./task-worktree-cleanup";
import { runGitText } from "../src/shared/lib/processExecution.node";
import { canonicalWorkspaceEntry } from "./workspace-paths";

const ROOT = "temp/local";
export async function hashTaskArtifact(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024, signal }))
    hash.update(chunk);
  return hash.digest("hex");
}
const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

/** Transfer ignored local task outputs, never caches, tracked source or symlink targets. */
export async function transferTaskArtifacts(
  source: string,
  target: string,
  paths?: readonly string[],
  expectedHashes?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  if (paths?.length === 0) return [];
  [source, target] = await Promise.all([
    canonicalWorkspaceEntry(source),
    canonicalWorkspaceEntry(target),
  ]);
  if (sameHostPath(source, target)) return [];
  const sourceRoot = join(source, ROOT);
  if (!(await exists(sourceRoot))) {
    if (paths?.length) throw new Error("The dependency's task artifacts are unavailable.");
    return [];
  }
  const selected = paths ? new Set(paths) : undefined;
  if (
    paths?.some(
      (path) =>
        !path.startsWith(`${ROOT}/`) || path.includes("\\") || path.split("/").includes(".."),
    )
  )
    throw new Error("Invalid task artifact path.");
  const git = (cwd: string, args: string[]) =>
    runGitText(args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  for (const cwd of [source, target]) {
    await git(cwd, ["check-ignore", "--quiet", "--", ROOT]);
    if ((await git(cwd, ["ls-files", "--", ROOT])).trim())
      throw new Error("Task artifact transfer cannot include tracked files.");
  }
  const safe = async (cwd: string, path: string) => {
    signal?.throwIfAborted();
    const rel = relative(resolve(cwd), resolve(path));
    if (rel.startsWith(`..${sep}`) || rel === "..")
      throw new Error("Task artifact path is outside its checkout.");
    let current = resolve(cwd);
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if (
        (
          await lstat(current).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          })
        )?.isSymbolicLink()
      )
        throw new Error("Task artifact transfer cannot follow symbolic links.");
    }
  };
  const files: Array<{ source: string; target: string; hash: string }> = [];
  let bytes = 0;
  let entries = 0;
  const walk = async (folder: string) => {
    await safe(source, folder);
    for (const name of (await readdir(folder)).sort()) {
      if (++entries > 10_000) throw new Error("Task artifact transfer exceeds its entry limit.");
      const path = join(folder, name);
      const artifactPath = relative(source, path).split(sep).join("/");
      if (
        selected &&
        !selected.has(artifactPath) &&
        !paths!.some((entry) => entry.startsWith(`${artifactPath}/`))
      )
        continue;
      await safe(source, path);
      const info = await lstat(path);
      if (info.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!info.isFile()) throw new Error("Task artifacts must be regular files.");
      bytes += info.size;
      if (files.length >= 5000 || bytes > 128 * 1024 * 1024 || info.size > 16 * 1024 * 1024)
        throw new Error(
          "Task artifact transfer exceeds its size limit. All originals are retained.",
        );
      const destination = join(target, relative(source, path));
      await safe(target, destination);
      const digest = await hashTaskArtifact(path, signal);
      if (expectedHashes && expectedHashes[artifactPath] !== digest)
        throw new Error(
          `Delivered task artifact changed: ${artifactPath}. It does not match the delivery record.`,
        );
      if (
        (await exists(destination)) &&
        (!(await lstat(destination)).isFile() ||
          (await hashTaskArtifact(destination, signal)) !== digest)
      )
        throw new Error(
          `Task artifact destination has different content: ${relative(target, destination)}. Both copies are retained.`,
        );
      files.push({ source: path, target: destination, hash: digest });
    }
  };
  await walk(sourceRoot);
  if (selected && files.length !== selected.size)
    throw new Error("The dependency's task artifacts are incomplete.");
  for (const cwd of [source, target]) {
    const paths = files.map((file) => relative(source, file.source).split(sep).join("/"));
    for (let at = 0; at < paths.length; at += 100) {
      const batch = paths.slice(at, at + 100);
      const ignored = new Set(
        (await git(cwd, ["-c", "core.quotePath=false", "check-ignore", "--", ...batch]))
          .trimEnd()
          .split(/\r?\n/)
          .map((path) => (path.startsWith('"') ? (JSON.parse(path) as string) : path)),
      );
      if (batch.some((path) => !ignored.has(path)))
        throw new Error("Task artifact transfer cannot include non-ignored files.");
    }
  }
  // Preflight the whole transfer before making any destination changes.
  for (const file of files) {
    await safe(source, file.source);
    await safe(target, file.target);
    if ((await hashTaskArtifact(file.source, signal)) !== file.hash)
      throw new Error("Task artifact changed during transfer. Retry after it is stable.");
    await mkdir(dirname(file.target), { recursive: true });
    if (!(await exists(file.target)))
      await copyFile(file.source, file.target, constants.COPYFILE_EXCL);
    if ((await hashTaskArtifact(file.target, signal)) !== file.hash)
      throw new Error("Task artifact verification failed. The original is retained.");
  }
  return files.map((file) => relative(source, file.source).split(sep).join("/"));
}

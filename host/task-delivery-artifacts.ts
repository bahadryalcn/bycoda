import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGitText } from "../src/shared/lib/processExecution.node";
import { hashTaskArtifact } from "./task-artifacts";
import { sameHostPath } from "./task-worktree-cleanup";

const ROOT = "temp/local";
const MAX_ENTRIES = 10_000;
const MAX_FILES = 5_000;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface TaskDeliveryArtifactsPreview {
  paths: string[];
  hashes: Record<string, string>;
  sourceFingerprint: string;
  targetFingerprint: string;
  blockers: string[];
  /** Original per-destination state distinguishes safe partial-copy retries from removal/drift. */
  targetHashes: Record<string, string | null>;
}

const fingerprint = (entries: Readonly<Record<string, string | null>>) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(entries)
          .sort()
          .map((path) => [path, entries[path]]),
      ),
    )
    .digest("hex");

async function optionalStat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

/** Walk ancestor entries with lstat; never enumerate or hash through a junction/symlink. */
async function safeEntry(cwd: string, path: string) {
  const root = resolve(cwd);
  const absolute = resolve(path);
  const rel = relative(root, absolute);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Task artifact path is outside its checkout.");
  const parts = rel ? rel.split(sep) : [];
  let current = root;
  let info = await optionalStat(current);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new Error("Task artifact checkout must be a directory without symbolic links.");
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    info = await optionalStat(current);
    if (info?.isSymbolicLink())
      throw new Error("Task artifact review cannot follow symbolic links or junctions.");
    if (info && index < parts.length - 1 && !info.isDirectory())
      throw new Error("Task artifact destination has a non-directory ancestor.");
  }
  return info;
}

async function regularFileHash(cwd: string, path: string): Promise<string | null> {
  const before = await safeEntry(cwd, path);
  if (!before) return null;
  if (!before.isFile())
    throw new Error("Task artifacts and their destinations must be regular files.");
  if (before.size > MAX_FILE_BYTES)
    throw new Error("Task artifact review exceeds its file size limit.");
  const digest = await hashTaskArtifact(path);
  const after = await safeEntry(cwd, path);
  if (
    !after?.isFile() ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error("Task artifact changed during review; retry after it is stable.");
  return digest;
}

const git = (cwd: string, args: string[]) =>
  runGitText(args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });

async function requireIgnored(cwd: string, paths: readonly string[]) {
  if ((await git(cwd, ["ls-files", "-z", "--", ROOT])).length)
    throw new Error("Task artifact review cannot include tracked files.");
  try {
    await git(cwd, ["check-ignore", "--quiet", "--", ROOT]);
  } catch {
    throw new Error("Task artifact review requires ignored temp/local outputs in both checkouts.");
  }
  for (let at = 0; at < paths.length; at += 100) {
    const batch = paths.slice(at, at + 100);
    let output: string;
    try {
      output = await git(cwd, ["-c", "core.quotePath=false", "check-ignore", "--", ...batch]);
    } catch {
      throw new Error("Task artifact review cannot include non-ignored files.");
    }
    const ignored = new Set(
      output
        .trimEnd()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((path) => (path.startsWith('"') ? (JSON.parse(path) as string) : path)),
    );
    if (batch.some((path) => !ignored.has(path)))
      throw new Error("Task artifact review cannot include non-ignored files.");
  }
}

/** Read-only approval manifest. Includes every source output, so a newly added file invalidates approval. */
export async function previewTaskDeliveryArtifacts(
  source: string,
  target: string,
): Promise<TaskDeliveryArtifactsPreview> {
  const hashes: Record<string, string> = {};
  const targetHashes: Record<string, string | null> = {};
  const blockers: string[] = [];
  let entries = 0;
  let bytes = 0;
  let files = 0;
  try {
    const [sourcePath, targetPath] = await Promise.all([realpath(source), realpath(target)]);
    if (sameHostPath(sourcePath, targetPath))
      throw new Error("Task artifacts require separate source and target checkouts.");
    const sourceRoot = join(source, ROOT);
    const root = await safeEntry(source, sourceRoot);
    if (root) {
      if (!root.isDirectory()) throw new Error("Task artifact root must be a directory.");
      const walk = async (folder: string): Promise<void> => {
        await safeEntry(source, folder);
        for (const name of (await readdir(folder)).sort()) {
          if (++entries > MAX_ENTRIES)
            throw new Error("Task artifact review exceeds its entry limit.");
          const path = join(folder, name);
          const info = await safeEntry(source, path);
          if (!info) throw new Error("Task artifact disappeared during review.");
          if (info.isDirectory()) {
            await walk(path);
            continue;
          }
          if (!info.isFile()) throw new Error("Task artifacts must be regular files.");
          bytes += info.size;
          if (++files > MAX_FILES || bytes > MAX_BYTES || info.size > MAX_FILE_BYTES)
            throw new Error(
              "Task artifact review exceeds its size limit. All originals are retained.",
            );
          const digest = await regularFileHash(source, path);
          if (!digest) throw new Error("Task artifact disappeared during review.");
          hashes[relative(source, path).split(sep).join("/")] = digest;
        }
      };
      await walk(sourceRoot);
      const paths = Object.keys(hashes).sort();
      const ignoredChecks = await Promise.allSettled([
        requireIgnored(source, paths),
        requireIgnored(target, paths),
      ]);
      for (const result of ignoredChecks) if (result.status === "rejected") throw result.reason;
      for (const path of paths) {
        targetHashes[path] = await regularFileHash(target, join(target, path));
        if (targetHashes[path] !== null && targetHashes[path] !== hashes[path])
          blockers.push(
            `Task artifact destination has different content: ${path}. Both copies are retained.`,
          );
      }
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "Task artifact review failed.");
  }
  return {
    paths: Object.keys(hashes).sort(),
    hashes,
    targetHashes,
    sourceFingerprint: fingerprint(hashes),
    targetFingerprint: fingerprint(targetHashes),
    blockers,
  };
}

/** Validate before owner delivery, or before resuming its already-approved artifact copy. */
export async function validateTaskDeliveryArtifacts(
  preview: TaskDeliveryArtifactsPreview,
  source: string,
  target: string,
  options: { allowCopied?: boolean } = {},
): Promise<void> {
  if (preview.blockers.length) throw new Error(preview.blockers.join("\n"));
  if (
    preview.sourceFingerprint !== fingerprint(preview.hashes) ||
    preview.targetFingerprint !== fingerprint(preview.targetHashes) ||
    JSON.stringify(preview.paths) !== JSON.stringify(Object.keys(preview.hashes).sort()) ||
    JSON.stringify(preview.paths) !== JSON.stringify(Object.keys(preview.targetHashes).sort())
  )
    throw new Error("Task artifact approval manifest is invalid.");
  const current = await previewTaskDeliveryArtifacts(source, target);
  if (current.blockers.length) throw new Error(current.blockers.join("\n"));
  if (current.sourceFingerprint !== preview.sourceFingerprint)
    throw new Error("Task artifact source changed; review delivery again.");
  if (!options.allowCopied) {
    if (current.targetFingerprint !== preview.targetFingerprint)
      throw new Error("Task artifact target changed; review delivery again.");
    return;
  }
  for (const path of preview.paths) {
    const original = preview.targetHashes[path];
    const observed = current.targetHashes[path];
    if (observed !== original && !(original === null && observed === preview.hashes[path]))
      throw new Error(
        "Task artifact target changed beyond the approved copy; review delivery again.",
      );
  }
}

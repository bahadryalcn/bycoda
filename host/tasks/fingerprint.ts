import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { setImmediate as yieldFingerprint } from "node:timers/promises";
import { isAbsolute, join, normalize, sep } from "node:path";
import { hasUnmergedBranch, type HostTask } from "../../src/features/tasks/model/hostTasks";
import { readTaskInstructions } from "../../src/features/tasks/model/taskInstructions";
import { acceptanceOutputFingerprint } from "./task-acceptance-snapshot";
import { DIFF_STAT_LIMIT } from "./constants";
import { git } from "./git";
import type { TaskContext } from "./context";
export function shouldFingerprintFailedCheck(result: {
  timedOut: boolean;
  exitCode: number | null;
}): boolean {
  return !result.timedOut && result.exitCode !== null && result.exitCode !== 0;
}
/** Consume bounded I/O batches in legacy order, including errors and limits. */
export async function fingerprintPaths(
  hash: ReturnType<typeof createHash>,
  cwd: string,
  names: string[],
  budget: {
    entries: number;
    bytes: number;
  },
  pending?: string[],
): Promise<boolean> {
  for (let offset = 0; offset < names.length;) {
    const count = Math.min(8, pending ? 2000 - budget.entries : 8);
    if (!count) return false;
    const batch = names.slice(offset, offset + count);
    offset += batch.length;
    const metadata = await Promise.allSettled(batch.map((name) => lstat(join(cwd, name))));
    const reads: Array<{
      name: string;
      result: Promise<PromiseSettledResult<Buffer>>;
    }> = [];
    let stop:
      | {
          error: unknown;
        }
      | {
          limit: true;
        }
      | undefined;
    for (let index = 0; index < batch.length; index++) {
      if (pending) budget.entries++;
      const name = batch[index];
      const entry = metadata[index];
      if (entry.status === "rejected") {
        stop = { error: entry.reason };
        break;
      }
      const info = entry.value;
      if (pending && info.isSymbolicLink()) continue;
      if (pending && info.isDirectory()) pending.push(name);
      else if (info.isFile()) {
        if ((budget.bytes += info.size) > 16 * 1024 * 1024) {
          stop = { limit: true };
          break;
        }
        // Attach rejection handling immediately; consume each result in order.
        reads.push({
          name,
          result: readFile(join(cwd, name)).then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason: unknown) => ({ status: "rejected" as const, reason }),
          ),
        });
      } else if (!pending) {
        stop = { limit: true };
        break;
      }
    }
    // Drain the batch before propagating an error into the Git fallback, so
    // failed reads cannot leave extra I/O running alongside its next batch.
    const contents = await Promise.all(reads.map(({ result }) => result));
    for (let index = 0; index < reads.length; index++) {
      // The old implementation adds the name even if reading then fails.
      hash.update(reads[index].name);
      const content = contents[index];
      if (content.status === "rejected") throw content.reason;
      for (let offset = 0; offset < content.value.length; offset += 256 * 1024) {
        hash.update(content.value.subarray(offset, offset + 256 * 1024));
        await yieldFingerprint();
      }
    }
    if (stop) {
      if ("error" in stop) throw stop.error;
      return false;
    }
  }
  return true;
}

export async function resultFingerprint(
  context: TaskContext,
  task: HostTask,
): Promise<string | undefined> {
  await context.ready;

  return await context.acceptanceFingerprint({
    ...task,
    worktreeCwd: task.merged
      ? (task.deliveryCwd ?? (await context.store.project(task.projectId)).cwd)
      : task.worktreeCwd,
  });
}

export async function acceptanceFingerprint(
  context: TaskContext,
  task: HostTask,
  knownWorkspace?: string,
): Promise<string | undefined> {
  const cwd = task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd;
  const workspace = knownWorkspace ?? (await context.workspaceFingerprint(task));
  const outputs = await acceptanceOutputFingerprint(
    cwd,
    readTaskInstructions(task.prompt)?.deliverables ?? [],
    task.artifactPaths,
  );
  if (!workspace || !outputs) return undefined;
  return createHash("sha256")
    .update(workspace)
    .update("\0")
    .update(outputs.fingerprint)
    .digest("hex");
}

export async function workspaceFingerprint(
  context: TaskContext,
  task: HostTask,
): Promise<string | undefined> {
  const cwd = task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd;
  const hash = createHash("sha256");
  if (task.crewScopes?.length && !task.crewScopes.includes("."))
    return await scopedFingerprint(hash, cwd, task.crewScopes);
  const attributed = await assignmentChanges(context, task, cwd);
  // A whole-checkout crew assignment in a shared checkout snapshots only the
  // files its worker changed, so other sessions' edits elsewhere cannot void
  // its independent review. Without attribution it keeps the strict snapshot.
  if (attributed) return await scopedFingerprint(hash.update("attributed\0"), cwd, attributed);
  try {
    const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
    hash.update(tree).update(await git(cwd, ["diff", "--binary", "HEAD"]));
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
    if (
      !(await fingerprintPaths(hash, cwd, untracked.split(/\r?\n/).filter(Boolean).sort(), {
        entries: 0,
        bytes: 0,
      }))
    )
      return undefined;
    return hash.digest("hex");
  } catch {
    // A non-Git project may be a small report/artifact folder. Keep this
    // fallback bounded so large projects cannot stall the scheduler.
    const pending = [""];
    const budget = { entries: 0, bytes: 0 };
    try {
      while (pending.length) {
        const directory = pending.pop()!;
        const names = (await readdir(join(cwd, directory)))
          .sort()
          .filter((name) => ![".git", "node_modules", "temp"].includes(name))
          .map((name) => join(directory, name));
        if (!(await fingerprintPaths(hash, cwd, names, budget, pending))) return undefined;
      }
      return hash.digest("hex");
    } catch {
      return undefined;
    }
  }
}

/** Hash named paths (files or directories) under `cwd`, including missing ones. */
async function scopedFingerprint(
  hash: ReturnType<typeof createHash>,
  cwd: string,
  scopes: readonly string[],
): Promise<string | undefined> {
  const pending = [...scopes].sort().reverse();
  const visited = new Set<string>();
  let bytes = 0;
  try {
    while (pending.length) {
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      if (visited.size > 2000) return undefined;
      hash.update(name).update("\0");
      let info;
      try {
        info = await lstat(join(cwd, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          hash.update("missing\0");
          continue;
        }
        throw error;
      }
      if (info.isSymbolicLink()) return undefined;
      if (info.isDirectory()) {
        hash.update("directory\0");
        const children = (await readdir(join(cwd, name)))
          .filter((child) => ![".git", "node_modules", "temp"].includes(child))
          .sort()
          .reverse();
        pending.push(...children.map((child) => `${name}/${child}`));
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 16 * 1024 * 1024) return undefined;
        hash.update("file\0").update(await readFile(join(cwd, name)));
        await yieldFingerprint();
      } else return undefined;
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

async function assignmentChanges(
  context: TaskContext,
  task: HostTask,
  cwd: string,
): Promise<string[] | undefined> {
  if (!task.crewRunId || task.isolate !== false || task.worktreeCwd || !task.sessionId)
    return undefined;
  const files = await context.sessionCheckpoints
    ?.status(task.sessionId, cwd)
    .then((status) => status.files.map((file) => file.relative))
    .catch(() => undefined);
  // shortcut: overlapping turns attribute only tool-reported edits, not shell-written
  // files; upgrade to a task-start baseline or a crew worktree if that gap matters.
  if (!files?.length) return undefined;
  // Attribution comes from Host file history; reject anything outside the checkout.
  if (files.some((path) => !path || isAbsolute(path) || normalize(path).split(sep).includes("..")))
    return undefined;
  return files;
}

export async function diffStat(context: TaskContext, task: HostTask): Promise<string | undefined> {
  if (!hasUnmergedBranch(task) || !task.baseCommit) return undefined;
  try {
    const stat = await git((await context.store.project(task.projectId)).cwd, [
      "diff",
      "--stat",
      `${task.baseCommit}...${task.branch}`,
    ]);
    return stat.slice(0, DIFF_STAT_LIMIT) || undefined;
  } catch {
    return undefined;
  }
}

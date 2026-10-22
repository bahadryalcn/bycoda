import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  GitConflictFile,
  GitConflictKind,
  GitConflictStages,
  GitOperation,
} from "../src/platform/tauri/fs";

/** Unmerged paths, read from `git ls-files -u` exactly as src-tauri/src/
 * git_conflicts.rs does, so both sides report the same kinds. Callers validate
 * paths first (`workspacePath`); nothing here reads a UI string as an option. */

export type HostConflict = GitConflictFile;

/** Stage numbers git recorded for a path: 1 base, 2 ours (current), 3 theirs. */
export function conflictKind(stages: ReadonlySet<number>): GitConflictKind {
  const has = (...wanted: number[]) =>
    wanted.length === stages.size && wanted.every((stage) => stages.has(stage));
  if (has(1, 2, 3)) return "both-modified";
  if (has(2, 3)) return "both-added";
  if (has(1, 3)) return "deleted-by-us";
  if (has(1, 2)) return "deleted-by-them";
  if (has(2)) return "added-by-us";
  if (has(3)) return "added-by-them";
  return "both-deleted";
}

export type UnmergedEntry = { relative: string; stage: number; sha: string };

/** `git ls-files -u -z`: `<mode> <sha> <stage>\t<path>` per NUL-separated record. */
export function parseUnmerged(output: string): UnmergedEntry[] {
  const entries: UnmergedEntry[] = [];
  for (const record of output.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [, sha, stage] = record.slice(0, tab).split(" ");
    if (sha && (stage === "1" || stage === "2" || stage === "3"))
      entries.push({ relative: record.slice(tab + 1), stage: Number(stage), sha });
  }
  return entries;
}

/** Groups the listing by path (it is sorted), with the kind for each. */
export function conflictsFrom(
  entries: UnmergedEntry[],
): { relative: string; kind: GitConflictKind }[] {
  const stages = new Map<string, Set<number>>();
  for (const entry of entries) {
    const seen = stages.get(entry.relative) ?? new Set<number>();
    seen.add(entry.stage);
    stages.set(entry.relative, seen);
  }
  return [...stages].map(([relative, seen]) => ({ relative, kind: conflictKind(seen) }));
}

const LIST_MS = 30_000;
// Matches MAX_FILE in workspace.ts: remote responses are bounded.
const MAX_BLOB = 1024 * 1024;

async function run<T extends string | Buffer>(
  root: string,
  args: string[],
  encoding: "utf8" | "buffer",
  maxBuffer = 4 * 1024 * 1024,
): Promise<T> {
  const { stdout } = await exec(
    "git",
    [...(args.includes("--") ? ["--literal-pathspecs"] : []), "--no-pager", ...args],
    {
      cwd: root,
      timeout: LIST_MS,
      maxBuffer,
      encoding,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    },
  );
  return stdout as T;
}

async function unmergedEntries(root: string, pathspec?: string): Promise<UnmergedEntry[]> {
  const output = await run<string>(
    root,
    ["ls-files", "-u", "-z", ...(pathspec ? ["--", pathspec] : [])],
    "utf8",
  );
  return parseUnmerged(output);
}

/** Unmerged files under `root`, relative to it; one git call. */
export async function hostUnmerged(root: string): Promise<HostConflict[]> {
  return conflictsFrom(await unmergedEntries(root)).map(({ relative, kind }) => ({
    path: relative,
    relative,
    kind,
  }));
}

/** Why a commit or continue is refused while conflicts remain. */
export function unmergedMessage(files: { relative: string }[]): string {
  const shown = files.slice(0, 5).map((file) => file.relative);
  if (files.length > shown.length) shown.push("...");
  return (
    `Resolve the merge conflicts first. ${files.length} ` +
    `${files.length === 1 ? "file has" : "files have"} unresolved conflicts: ${shown.join(", ")}`
  );
}

const OPERATION_MARKERS = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["MERGE_HEAD", "merge"],
] as const;

/** The operation git stopped in the middle of, in one git call. Rebase is
 * first: a rebase that stops on a conflict also leaves CHERRY_PICK_HEAD. */
export async function hostOperationState(root: string): Promise<GitOperation | null> {
  const paths = (
    await run<string>(
      root,
      ["rev-parse", ...OPERATION_MARKERS.flatMap(([name]) => ["--git-path", name])],
      "utf8",
    ).catch(() => "")
  ).trim();
  if (!paths) return null;
  const lines = paths.split("\n");
  const found = OPERATION_MARKERS.find(
    (_, index) => lines[index] && existsSync(resolve(root, lines[index])),
  );
  return found?.[1] ?? null;
}

export type HostConflictStages = GitConflictStages & { workingExists: boolean };

/** The base, current (ours) and incoming (theirs) versions of one conflicted
 * file. `relative` must already be confined to the project. */
export async function hostConflictStages(
  root: string,
  relative: string,
): Promise<HostConflictStages> {
  // `ls-files` reads its argument as a pathspec; only the exact path counts.
  const entries = (await unmergedEntries(root, relative)).filter(
    (entry) => entry.relative === relative,
  );
  if (!entries.length) throw new Error("This file has no merge conflict");
  let binary = false;
  let tooLarge = false;
  const read = async (stage: number): Promise<string | null> => {
    const entry = entries.find((candidate) => candidate.stage === stage);
    if (!entry) return null;
    try {
      const blob = await run<Buffer>(root, ["cat-file", "blob", entry.sha], "buffer", MAX_BLOB + 1);
      binary ||= blob.includes(0) || !Buffer.from(blob.toString("utf8"), "utf8").equals(blob);
      return blob.toString("utf8");
    } catch (reason) {
      if (!String(reason).includes("maxBuffer"))
        throw new Error("Could not read this version of the file");
      tooLarge = true;
      return "";
    }
  };
  let [base, ours, theirs] = [await read(1), await read(2), await read(3)];
  if (binary || tooLarge) {
    const hidden = (text: string | null) => (text === null ? null : "");
    [base, ours, theirs] = [hidden(base), hidden(ours), hidden(theirs)];
  }
  return {
    path: relative,
    relative,
    kind: conflictKind(new Set(entries.map((entry) => entry.stage))),
    base,
    ours,
    theirs,
    binary,
    tooLarge,
    workingExists: await lstat(resolve(root, relative)).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; }),
  };
}

/** Stage numbers present for one validated path; empty when not conflicted. */
export async function hostConflictStageSet(root: string, relative: string): Promise<Set<number>> {
  return new Set(
    (await unmergedEntries(root, relative))
      .filter((entry) => entry.relative === relative)
      .map((entry) => entry.stage),
  );
}

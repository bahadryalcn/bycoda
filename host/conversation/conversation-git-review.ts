import { createHash } from "node:crypto";
import { lstat, open, readlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { relative, sep } from "node:path";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { existingPath, workspacePath } from "../workspace";
import { hostGitStarts } from "../git/git-start-gate";

const MAX_BYTES = 16 * 1024 * 1024;
const sameFile = (first: Stats, second: Stats) =>
  first.dev === second.dev &&
  first.ino === second.ino &&
  first.size === second.size &&
  first.mtimeMs === second.mtimeMs &&
  first.ctimeMs === second.ctimeMs;

/** At most the reviewed size plus one byte is read, even if a file grows concurrently. */
export async function readGitReviewContent(
  cwd: string,
  path: string,
  entry: Stats,
  remainingBytes: number,
) {
  if (!entry.isFile()) throw new Error("Git review requires explicit regular untracked files.");
  if (entry.size > remainingBytes || entry.size > MAX_BYTES)
    throw new Error("Untracked Git review exceeds the content budget.");
  const checked = await existingPath(cwd, relative(cwd, path));
  const handle = await open(checked, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || !sameFile(entry, before))
      throw new Error("Untracked file changed while reading Git review.");
    const content = Buffer.alloc(entry.size + 1);
    let length = 0;
    while (length < content.length) {
      const read = await handle.read(content, length, content.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (
      length !== entry.size ||
      !sameFile(entry, await handle.stat()) ||
      !sameFile(entry, await lstat(path)) ||
      (await existingPath(cwd, relative(cwd, path))) !== checked
    )
      throw new Error("Untracked file changed while reading Git review.");
    return content.subarray(0, length);
  } finally {
    await handle.close();
  }
}
/** Content identity for owner-reviewed Git effects. Metadata/status codes alone
 * cannot distinguish edits with equal line counts. Oversized reviews fail closed. */
export async function conversationGitReviewHash(cwd: string): Promise<string> {
  const git = async (args: string[]) => {
    await hostGitStarts.enter();
    return (
      await execFileAsync("git", args, {
        cwd,
        timeout: 30_000,
        maxBuffer: MAX_BYTES,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      })
    ).stdout;
  };
  const [status, index, working, staged, branch] = await Promise.all([
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(["ls-files", "--stage", "-z"]),
    git(["diff", "--binary", "--no-ext-diff", "--no-textconv"]),
    git(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"]),
    git(["status", "--porcelain=v2", "--branch", "--untracked-files=no"]),
  ]);
  const hash = createHash("sha256");
  const add = (value: string | Buffer) => {
    hash.update(String(Buffer.byteLength(value)));
    hash.update(":");
    hash.update(value);
  };
  for (const value of [status, index, working, staged, branch]) add(value);
  let bytes = 0;
  const rows = status.split("\0");
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at];
    if (row.slice(0, 2).match(/[RC]/)) at++;
    if (!row.startsWith("?? ")) continue;
    const path = workspacePath(cwd, row.slice(3));
    const entry = await lstat(path);
    add(relative(cwd, path).split(sep).join("/"));
    if (entry.isSymbolicLink()) {
      add(await readlink(path));
      continue;
    }
    const content = await readGitReviewContent(cwd, path, entry, MAX_BYTES - bytes);
    bytes += content.length;
    add(content);
  }
  return hash.digest("hex");
}

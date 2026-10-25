import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { withHostGitMutation } from "./git-mutations";
const api = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("../src/shared/lib/processExecution.node", () => ({ execFileAsync: api.exec }));
vi.mock("./git-start-gate", () => ({ hostGitStarts: { enter: async () => {} } }));
vi.mock("./git-conflicts", () => ({
  hostUnmerged: async () => [],
  hostOperationState: async () => null,
  unmergedMessage: () => "conflict",
}));
import {
  hostGitIndex,
  indexHostFiles,
  invalidateHostFilePaths,
  invalidateHostGitIndex,
  parseHostBranchStatus,
} from "./workspace";

const roots: string[] = [];
afterEach(async () => {
  invalidateHostFilePaths();
  invalidateHostGitIndex();
  vi.restoreAllMocks();
  api.exec.mockReset();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), "bycoda-cache-")))
      throw new Error("Unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});
async function repo() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-cache-"));
  roots.push(root);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git/index"), "index");
  await writeFile(join(root, "a.txt"), "one\n");
  return root;
}
function gitReplies() {
  api.exec.mockImplementation(async (_file: string, args: string[]) => {
    const command = args.find((arg) =>
      ["rev-parse", "symbolic-ref", "status", "diff", "ls-files"].includes(arg),
    );
    const stdout =
      command === "status"
        ? "## main\0 M a.txt\0"
        : command === "diff"
          ? "1\t0\ta.txt\0"
          : command === "symbolic-ref"
            ? "main\n"
            : args.includes("--is-inside-work-tree")
              ? "true\n"
              : args.includes("--verify")
                ? "head\n"
                : command === "ls-files" && !args.includes("--deleted")
                  ? "a.txt\0"
                  : "";
    return { stdout, stderr: "" };
  });
}
const diffCalls = () => api.exec.mock.calls.filter(([, args]) => args.includes("--numstat")).length;

it.each([
  ["main...origin/main [ahead 3, behind 2]", "main", "origin/main", 3, 2],
  ["No commits yet on feature/ü", "feature/ü", "", 0, 0],
  ["Initial commit on main", "main", "", 0, 0],
  ["HEAD (no branch)", "", "", 0, 0],
  ["main...origin/main [gone]", "main", "origin/main", 0, 0],
])("reads porcelain branch metadata: %s", (header, branch, upstream, ahead, behind) => {
  const status = " M a\nline.txt\0";
  expect(parseHostBranchStatus(`## ${header}\0${status}`)).toEqual({
    branch,
    upstream,
    ahead,
    behind,
    status,
  });
});

it("reuses metadata-validated numstat but refreshes after worktree/index edits", async () => {
  const root = await repo();
  gitReplies();
  await hostGitIndex(root, false);
  await hostGitIndex(root, false);
  expect(diffCalls()).toBe(1);
  await writeFile(join(root, "a.txt"), "one\ntwo\n");
  await hostGitIndex(root, false);
  expect(diffCalls()).toBe(2);
  await writeFile(join(root, ".git/index"), "another-index");
  await hostGitIndex(root, false);
  expect(diffCalls()).toBe(3);
});

it("preserves an unrelated in-flight Git read on scoped invalidation", async () => {
  const a = await repo(),
    b = await repo();
  gitReplies();
  const first = hostGitIndex(b, false);
  invalidateHostGitIndex(a);
  expect(hostGitIndex(b, false)).toBe(first);
  await first;
});

it("invalidates sibling worktree refs while retaining a known unrelated repository flight", async () => {
  const a = await repo(),
    unrelated = await repo();
  const b = await mkdtemp(join(tmpdir(), "bycoda-cache-"));
  roots.push(b);
  const gitDir = join(a, ".git/worktrees/linked");
  await mkdir(gitDir, { recursive: true });
  await writeFile(join(gitDir, "commondir"), "../..");
  await writeFile(join(gitDir, "index"), "linked-index");
  await writeFile(join(b, ".git"), `gitdir: ${gitDir}`);
  await writeFile(join(b, "a.txt"), "one\n");
  gitReplies();
  const respond = api.exec.getMockImplementation()!;
  let release!: (value: { stdout: string; stderr: string }) => void;
  const held = new Promise<{ stdout: string; stderr: string }>((done) => {
    release = done;
  });
  api.exec.mockImplementation((file: string, args: string[], options: { cwd: string }) =>
    args.includes("status") ? held : respond(file, args, options),
  );
  const linked = hostGitIndex(b, false),
    other = hostGitIndex(unrelated, false);
  await vi.waitFor(() =>
    expect(api.exec.mock.calls.filter(([, args]) => args.includes("status"))).toHaveLength(2),
  );
  let refreshed!: Promise<unknown>;
  await withHostGitMutation(a, async () => {
    invalidateHostGitIndex(a);
    refreshed = hostGitIndex(b, false);
    expect(refreshed).not.toBe(linked);
    expect(hostGitIndex(unrelated, false)).toBe(other);
  });
  release({ stdout: "## main\0 M a.txt\0", stderr: "" });
  await Promise.all([linked, other, refreshed]);
});

it("conservatively retires an unresolved repository identity during a mutation", async () => {
  const a = await repo(),
    unknown = await repo();
  gitReplies();
  let first!: Promise<unknown>, second!: Promise<unknown>;
  await withHostGitMutation(a, async () => {
    first = hostGitIndex(unknown, false);
    invalidateHostGitIndex(a);
    second = hostGitIndex(unknown, false);
    expect(second).not.toBe(first);
  });
  await Promise.all([first, second]);
});

it("starts the file-list freshness window on completion and keeps another root cached", async () => {
  const a = await repo(),
    b = await repo();
  let now = 1000,
    listing = "a.txt\0",
    release!: () => void;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  api.exec.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("--is-inside-work-tree")) return { stdout: "true", stderr: "" };
    if (args.includes("--deleted")) return { stdout: "", stderr: "" };
    await new Promise<void>((done) => {
      release = done;
    });
    return { stdout: listing, stderr: "" };
  });
  const pending = indexHostFiles(b);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  now = 10_000;
  release();
  expect(await pending).toEqual(["a.txt"]);
  listing = "a.txt\0new.txt\0";
  now++;
  invalidateHostFilePaths(a);
  expect(await indexHostFiles(b)).toEqual(["a.txt"]);
});

import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import {
  GIT_PUBLISH_TOOLS,
  gitMergeReview,
  gitPushReview,
  runGitPublish,
  stripRemoteCredentials,
} from "./conversation-git-publish";
import { ConversationManagementTools } from "./conversation-management-tools";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const ident = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "bycoda-voice-publish-"));
  roots.push(base);
  const root = join(base, "work");
  const remote = join(base, "remote.git");
  const run = (cwd: string, ...args: string[]) =>
    execFileAsync("git", args, { cwd, windowsHide: true, timeout: 20_000 });
  await run(base, "init", "--bare", "-b", "main", remote);
  await run(base, "init", "-b", "main", root);
  const git = (...args: string[]) => run(root, ...args);
  const commit = async (file: string, body: string, message: string) => {
    await writeFile(join(root, file), body);
    await git("add", ".");
    await git(...ident, "commit", "-m", message);
  };
  await commit("a.txt", "one\n", "first");
  await git("remote", "add", "origin", remote);
  return { root, remote, git, commit, run, base };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const head = async (f: Fixture) => (await f.git("rev-parse", "HEAD")).stdout.trim();

it("push schema has no force, delete, tags or other-ref fields", () => {
  const keys = Object.keys(GIT_PUBLISH_TOOLS["git.pushPreview"].properties).concat(
    Object.keys(GIT_PUBLISH_TOOLS["git.push"].properties),
  );
  expect(keys.join()).not.toMatch(/force|delete|tags|mirror|refspec/i);
});
it("strips credentials from remote URLs", () => {
  expect(stripRemoteCredentials("https://user:pw@host.example/r.git")).toBe(
    "https://host.example/r.git",
  );
  expect(stripRemoteCredentials("https://host.example/r.git?token=abc")).not.toContain("abc");
});
it("push review names remote, ref and commits; rejects other refs and no upstream", async () => {
  const f = await fixture();
  await expect(gitPushReview(f.root, {})).rejects.toThrow("No upstream");
  await expect(gitPushReview(f.root, { remote: "origin", branch: "other" })).rejects.toThrow(
    "current branch",
  );
  await expect(gitPushReview(f.root, { remote: "--mirror", branch: "main" })).rejects.toThrow();
  await expect(gitPushReview(f.root, { remote: "origin", branch: "-d" })).rejects.toThrow();
  await expect(
    gitPushReview(f.root, { remote: "origin", branch: "main", setUpstream: true }),
  ).resolves.toMatchObject({
    localBranch: "main",
    targetRef: "refs/heads/main",
    commitCount: 1,
    commits: [expect.stringContaining("first")],
    setUpstream: true,
  });
  await expect(gitPushReview(f.root, { setUpstream: true })).rejects.toThrow("remote and branch");
});
it("pushes the reviewed head, then aborts when HEAD changes after review", async () => {
  const f = await fixture();
  const review = await gitPushReview(f.root, {
    remote: "origin",
    branch: "main",
    setUpstream: true,
  });
  await runGitPublish(f.root, "git.push", review);
  expect((await f.run(f.remote, "rev-parse", "main")).stdout.trim()).toBe(await head(f));
  await f.commit("a.txt", "two\n", "second");
  const second = await gitPushReview(f.root, {});
  expect(second.commitCount).toBe(1);
  await f.commit("a.txt", "three\n", "third");
  await expect(runGitPublish(f.root, "git.push", second)).rejects.toThrow("changed after review");
  expect((await f.run(f.remote, "log", "--format=%s", "main")).stdout).not.toContain("third");
});
it("refuses a non-fast-forward push instead of forcing", async () => {
  const f = await fixture();
  await runGitPublish(
    f.root,
    "git.push",
    await gitPushReview(f.root, { remote: "origin", branch: "main", setUpstream: true }),
  );
  await f.commit("b.txt", "b\n", "local");
  const other = join(f.base, "other");
  await f.run(f.base, "clone", f.remote, other);
  await writeFile(join(other, "c.txt"), "c");
  await f.run(other, "add", ".");
  await f.run(other, ...ident, "commit", "-m", "remote");
  await f.run(other, "push", "origin", "main");
  await f.git("fetch", "origin");
  await expect(gitPushReview(f.root, {})).rejects.toThrow("Never forced");
});
async function mergeFixture() {
  const f = await fixture();
  await f.git("checkout", "-b", "topic");
  await f.commit("t.txt", "topic\n", "topic work");
  await f.git("checkout", "main");
  return f;
}
it("merges fast-forward and merge-commit, reviewing the exact source", async () => {
  const f = await mergeFixture();
  const ff = await gitMergeReview(f.root, { source: "topic" });
  expect(ff).toMatchObject({ mode: "fast-forward", commitCount: 1 });
  await runGitPublish(f.root, "git.merge", ff);
  expect(await readFile(join(f.root, "t.txt"), "utf8")).toBe("topic\n");
  await f.git("checkout", "-b", "side");
  await f.commit("s.txt", "s\n", "side");
  await f.git("checkout", "main");
  await f.commit("m.txt", "m\n", "main");
  const merge = await gitMergeReview(f.root, { source: "side" });
  expect(merge.mode).toBe("merge-commit");
  await runGitPublish(f.root, "git.merge", merge);
  expect(
    (await f.git("rev-list", "--parents", "-n1", "HEAD")).stdout.trim().split(" "),
  ).toHaveLength(3);
});
it("rejects merge when HEAD changed after review or tree is dirty", async () => {
  const f = await mergeFixture();
  const review = await gitMergeReview(f.root, { source: "topic" });
  await f.commit("x.txt", "x\n", "moved");
  await expect(runGitPublish(f.root, "git.merge", review)).rejects.toThrow("changed after review");
  await writeFile(join(f.root, "a.txt"), "dirty");
  await expect(gitMergeReview(f.root, { source: "topic" })).rejects.toThrow("clean");
});
it("refuses a conflicting merge at review and leaves the tree untouched", async () => {
  const f = await fixture();
  await f.git("checkout", "-b", "topic");
  await f.commit("a.txt", "topic\n", "topic edit");
  await f.git("checkout", "main");
  await f.commit("a.txt", "main\n", "main edit");
  const before = await head(f);
  await expect(gitMergeReview(f.root, { source: "topic" })).rejects.toThrow("a.txt");
  expect(await head(f)).toBe(before);
  expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("main\n");
});
it("never starts a merge that conflicts at run time, leaving the checkout clean", async () => {
  const f = await fixture();
  await f.git("checkout", "-b", "topic");
  await f.commit("a.txt", "topic\n", "topic edit");
  await f.git("checkout", "main");
  await f.commit("b.txt", "main\n", "main edit");
  const review = await gitMergeReview(f.root, { source: "topic" });
  await f.commit("a.txt", "late\n", "late");
  const late = await head(f);
  await expect(runGitPublish(f.root, "git.merge", { ...review, headSha: late })).rejects.toThrow();
  expect(await head(f)).toBe(late);
  expect((await f.git("status", "--porcelain")).stdout.trim()).toBe("");
});
it("requires native approval before any push executes", async () => {
  let executed = 0;
  const tools = new ConversationManagementTools<"git.push">(
    {
      execute: async () => (executed++, {}),
      approve: async () => ({ approved: false }),
      receipt: async () => undefined,
      saveReceipt: async () => undefined,
    },
    new Set(),
  );
  const principal = { kind: "session", sessionId: "s", projectId: "p" } as never;
  const result = (await tools.call(
    "git.push",
    { requestId: "r1", review: { remote: "origin" } },
    principal,
    async () => true,
  )) as { state: string };
  expect(result.state).toBe("failed");
  expect(executed).toBe(0);
});

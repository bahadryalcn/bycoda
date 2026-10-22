import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostGitAction } from "./workspace";
import { gitManagementSnapshot, runGitAction, verifyGitManagementSnapshot } from "./git-actions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith("bycoda-selective-")) throw new Error("Unsafe fixture cleanup path"); rmSync(root, { recursive: true, force: true }); } });
function repo() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-selective-"))); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q"); git("checkout", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test"); git("config", "commit.gpgsign", "false"); git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n"); git("add", "a.txt"); git("commit", "-qm", "base");
  return { root, git, write: (text: string | Buffer) => writeFileSync(join(root, "a.txt"), text) };
}
it("rejects stale working content and guarded index-mode changes without altering either file", async () => {
  const r = repo(); const original = r.git("show", ":a.txt"); r.write("ONE\ntwo\nTHREE\n");
  const index = readFileSync(join(r.root, ".git/index"));
  await expect(hostGitAction(r.root, "stageContents", "a.txt", undefined, "ONE\ntwo\nthree\n", original, "stale")).rejects.toThrow("working file changed");
  expect(readFileSync(join(r.root, ".git/index"))).toEqual(index);
  const snapshot = await gitManagementSnapshot(r.root);
  r.git("update-index", "--cacheinfo", "100755", r.git("rev-parse", ":a.txt").trim(), "a.txt");
  await expect(hostGitAction(r.root, "stageContents", "a.txt", undefined, "ONE\ntwo\nthree\n", original, "ONE\ntwo\nTHREE\n", () => verifyGitManagementSnapshot(r.root, snapshot.token))).rejects.toThrow("state changed");
  expect(r.git("show", ":a.txt")).toBe(original); expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe("ONE\ntwo\nTHREE\n");
});
it("stages only reviewed text, preserving working content, index mode and unrelated staged entries", async () => {
  const r = repo(); const original = r.git("show", ":a.txt"); r.git("update-index", "--chmod=+x", "a.txt");
  writeFileSync(join(r.root, "other.txt"), "unrelated\n"); r.git("add", "other.txt");
  r.write("ONE\ntwo\nTHREE\n"); const snapshot = await gitManagementSnapshot(r.root);
  await hostGitAction(r.root, "stageContents", "a.txt", undefined, "ONE\ntwo\nthree\n", original, "ONE\ntwo\nTHREE\n", () => verifyGitManagementSnapshot(r.root, snapshot.token));
  expect(r.git("show", ":a.txt")).toBe("ONE\ntwo\nthree\n"); expect(r.git("ls-files", "--stage", "a.txt")).toContain("100755"); expect(r.git("show", ":other.txt")).toBe("unrelated\n"); expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe("ONE\ntwo\nTHREE\n");
});
it("refuses malformed UTF-8 even when the lossy string matches a reviewed preview", async () => {
  const r = repo(); const original = r.git("show", ":a.txt"); const invalid = Buffer.from([0xff, 10]); r.write(invalid);
  await expect(hostGitAction(r.root, "stageContents", "a.txt", undefined, "new\n", original, invalid.toString("utf8"))).rejects.toThrow("valid UTF-8");
  expect(r.git("show", ":a.txt")).toBe(original); expect(readFileSync(join(r.root, "a.txt"))).toEqual(invalid);
});
it("resolves reviewed text conflicts with the real index lock and rejects stale conflict snapshots", async () => {
  const r = repo(); r.git("checkout", "-qb", "incoming"); r.write("theirs\n"); r.git("commit", "-qam", "incoming");
  r.git("checkout", "-q", "main"); r.write("ours\n"); r.git("commit", "-qam", "ours");
  try { r.git("merge", "incoming"); } catch { /* Expected merge conflict. */ }
  const working = readFileSync(join(r.root, "a.txt"), "utf8"); const snapshot = await gitManagementSnapshot(r.root);
  r.write(working + "edited after review\n");
  await expect(runGitAction("git_resolve_conflict", r.root, { relative: "a.txt", side: "reviewed", contents: "ours\ntheirs\n", expectedCurrent: working, expectedSnapshot: snapshot.token })).rejects.toThrow("state changed");
  expect(r.git("ls-files", "-u", "a.txt")).not.toBe("");
  r.write(working); const latest = await gitManagementSnapshot(r.root);
  await runGitAction("git_resolve_conflict", r.root, { relative: "a.txt", side: "reviewed", contents: "ours\ntheirs\n", expectedCurrent: working, expectedSnapshot: latest.token });
  expect(r.git("ls-files", "-u", "a.txt")).toBe(""); expect(r.git("show", ":a.txt")).toBe("ours\ntheirs\n"); expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe("ours\ntheirs\n");
});

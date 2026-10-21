import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostCheckpoints } from "./checkpoints";
import { hostGitAction, safeGitPath } from "./workspace";

const roots: string[] = [];
// Overlap/continuation scenarios capture several real Git trees on Windows.
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-turn-")));
  roots.push(dir);
  const cwd = join(dir, "repo");
  await mkdir(cwd);
  const git = (...args: string[]) =>
    exec("git", args, { cwd, encoding: "utf8", windowsHide: true });
  await git("init", "-q");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(cwd, "a.txt"), "base\n");
  await writeFile(join(cwd, "b.txt"), "keep\n");
  await git("add", "--", "a.txt", "b.txt");
  await git("commit", "-qm", "base");
  return { dir, cwd, git, checkpoints: new HostCheckpoints(join(dir, "checkpoints")) };
}
describe("host turn checkpoints", () => {
  it("recovers only its exact settled lease while preserving an independently active native peer", async () => {
    const f = await fixture();
    await f.checkpoints.begin("host", f.cwd, "settled");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("host", f.cwd, "settled");
    const root = join(f.dir, "checkpoints", ".active-leases");
    const orphan = join(root, "host-host-settled.json");
    const native = join(root, "native-peer-live.json");
    await writeFile(
      orphan,
      JSON.stringify({
        owner: "host",
        sessionId: "host",
        turnId: "settled",
        cwd: f.cwd,
        shared: false,
      }),
    );
    await writeFile(
      native,
      JSON.stringify({
        owner: "native",
        sessionId: "peer",
        turnId: "live",
        cwd: f.cwd,
        shared: false,
      }),
    );
    await f.checkpoints.recover("host", f.cwd);
    expect(await readdir(root)).toEqual(["native-peer-live.json"]);
    expect((await f.checkpoints.status("host", f.cwd)).files[0].undoable).toBe(false);
    await rm(native);
    expect((await f.checkpoints.status("host", f.cwd)).files[0].undoable).toBe(true);
  });
  it("attributes concurrent new files only to the tool's session", async () => {
    const f = await fixture();
    await f.checkpoints.begin("first", f.cwd, "one");
    await f.checkpoints.begin("peer", f.cwd, "two");
    await writeFile(join(f.cwd, "new.txt"), "new\n");
    await f.checkpoints.claim("first", f.cwd, "one", [join(f.cwd, "new.txt")]);
    await writeFile(join(f.cwd, "a.txt"), "peer\n");
    await f.checkpoints.claim("peer", f.cwd, "two", ["a.txt"]);
    await f.checkpoints.finish("first", f.cwd, "one");
    await f.checkpoints.finish("peer", f.cwd, "two");
    const files = (await f.checkpoints.status("first", f.cwd)).files;
    expect(files.map((file) => file.relative)).toEqual(["new.txt"]);
    expect(files[0].status).toBe("untracked");
    expect((await f.checkpoints.fileDiff("first", f.cwd, "new.txt")).current).toBe("new\n");
    expect((await f.checkpoints.status("peer", f.cwd)).files.map((file) => file.relative)).toEqual([
      "a.txt",
    ]);
  });
  it("preserves dirty bytes and path-specific clean-file filters from a nested project", async () => {
    const f = await fixture();
    const nested = join(f.cwd, "pkg");
    await mkdir(nested);
    await writeFile(
      join(f.cwd, ".gitattributes"),
      "pkg/clean.txt text eol=crlf\npkg/dirty.txt text eol=lf\n",
    );
    await writeFile(join(nested, "clean.txt"), "clean\r\n");
    await writeFile(join(nested, "dirty.txt"), "base\n");
    await f.git("add", "--", ".gitattributes", "pkg");
    await f.git("commit", "-qm", "nested baseline");
    await writeFile(join(nested, "dirty.txt"), "owner staged\r\n");
    await f.git("add", "--", "pkg/dirty.txt");
    const ownerBytes = "owner staged\r\nowner unstaged\r\n";
    await writeFile(join(nested, "dirty.txt"), ownerBytes);
    const index = await readFile(join(f.cwd, ".git", "index"));
    await f.checkpoints.begin("nested", nested, "turn");
    await writeFile(join(nested, "dirty.txt"), "agent\n");
    await writeFile(join(nested, "clean.txt"), "agent clean\n");
    await f.checkpoints.finish("nested", nested, "turn");
    expect((await f.checkpoints.fileDiff("nested", nested, "dirty.txt")).original).toBe(ownerBytes);
    expect((await f.checkpoints.fileDiff("nested", nested, "clean.txt")).original).toBe(
      "clean\r\n",
    );
    await f.checkpoints.change("nested", nested, undefined, true);
    expect(await readFile(join(nested, "dirty.txt"), "utf8")).toBe(ownerBytes);
    expect(await readFile(join(nested, "clean.txt"), "utf8")).toBe("clean\r\n");
    expect(await readFile(join(f.cwd, ".git", "index"))).toEqual(index);
  });
  it("publishes host ownership without adopting unclaimed native overlap edits", async () => {
    const f = await fixture();
    const leases = join(f.dir, "checkpoints", ".active-leases");
    await mkdir(leases, { recursive: true });
    const native = join(leases, "native-peer-turn.json");
    await writeFile(
      native,
      JSON.stringify({
        owner: "native",
        sessionId: "peer",
        turnId: "turn",
        cwd: f.cwd,
        shared: false,
      }),
    );
    await f.checkpoints.begin("host", f.cwd, "turn");
    expect(JSON.parse(await readFile(join(leases, "host-host-turn.json"), "utf8"))).toMatchObject({
      owner: "host",
      shared: true,
    });
    expect(JSON.parse(await readFile(native, "utf8"))).toMatchObject({ shared: true });
    await writeFile(join(f.cwd, "a.txt"), "shared\n");
    await rm(native);
    await f.checkpoints.finish("host", f.cwd, "turn");
    await expect(readFile(join(leases, "host-host-turn.json"))).rejects.toThrow();
    expect((await f.checkpoints.status("host", f.cwd)).files).toEqual([]);
    await expect(f.checkpoints.change("host", f.cwd, undefined, true)).rejects.toThrow("overlaps");
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("shared\n");
  });
  it("blocks a completed host undo while a native turn is active on its checkout", async () => {
    const f = await fixture();
    await f.checkpoints.begin("host", f.cwd, "turn");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("host", f.cwd, "turn");
    const native = join(f.dir, "checkpoints", ".active-leases", "native-peer-turn.json");
    await writeFile(
      native,
      JSON.stringify({
        owner: "native",
        sessionId: "peer",
        turnId: "turn",
        cwd: f.cwd,
        shared: false,
      }),
    );
    expect((await f.checkpoints.status("host", f.cwd)).files[0].undoable).toBe(false);
    await expect(f.checkpoints.change("host", f.cwd, undefined, true)).rejects.toThrow("overlaps");
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("agent\n");
    await rm(native);
    await f.checkpoints.change("host", f.cwd, undefined, true);
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("base\n");
  });
  it("coordinates with native active turns and retains overlap evidence after completion", async () => {
    const f = await fixture();
    const leases = join(f.dir, "checkpoints", ".active-leases");
    await mkdir(leases, { recursive: true });
    const native = join(leases, "native-native-session-turn.json");
    await writeFile(
      native,
      JSON.stringify({
        owner: "native",
        sessionId: "native-session",
        turnId: "turn",
        cwd: f.cwd,
        shared: false,
      }),
    );
    await f.checkpoints.begin("host-session", f.cwd, "turn");
    expect(JSON.parse(await readFile(native, "utf8")).shared).toBe(true);
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.claim("host-session", f.cwd, "turn", ["a.txt"]);
    await f.checkpoints.finish("host-session", f.cwd, "turn");
    await rm(native);
    expect((await f.checkpoints.status("host-session", f.cwd)).files[0].undoable).toBe(false);
    await expect(f.checkpoints.change("host-session", f.cwd, undefined, true)).rejects.toThrow(
      "overlaps",
    );
    expect(await readdir(leases)).toEqual([]);
  });
  it("blocks completed-turn undo while a later native turn is active", async () => {
    const f = await fixture();
    await f.checkpoints.begin("session", f.cwd, "turn");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("session", f.cwd, "turn");
    const leases = join(f.dir, "checkpoints", ".active-leases");
    const native = join(leases, "native-peer-turn.json");
    await writeFile(
      native,
      JSON.stringify({
        owner: "native",
        sessionId: "peer",
        turnId: "turn",
        cwd: f.cwd,
        shared: false,
      }),
    );
    expect((await f.checkpoints.status("session", f.cwd)).files[0].undoable).toBe(false);
    await expect(f.checkpoints.change("session", f.cwd, undefined, true)).rejects.toThrow(
      "overlaps",
    );
    await rm(native);
    expect((await f.checkpoints.status("session", f.cwd)).files[0].undoable).toBe(true);
  });
  it("cleans up active leases for non-Git folders and failed baselines", async () => {
    const f = await fixture();
    await rm(join(f.cwd, ".git"), { recursive: true });
    await f.checkpoints.begin("session", f.cwd, "plain");
    await f.checkpoints.finish("session", f.cwd, "plain");
    expect(await readdir(join(f.dir, "checkpoints", ".active-leases"))).toEqual([]);
    await f.git("init", "-q");
    await f.git("config", "core.sparseCheckout", "true");
    await expect(f.checkpoints.begin("session", f.cwd, "failed")).rejects.toThrow("sparse");
    await expect(f.checkpoints.begin("session", f.cwd, "failed")).rejects.toThrow("sparse");
    expect((await readdir(join(f.dir, "checkpoints", ".active-leases"))).length).toBe(1);
    await expect(f.checkpoints.finish("session", f.cwd, "failed")).rejects.toThrow("sparse");
    expect(await readdir(join(f.dir, "checkpoints", ".active-leases"))).toEqual([]);
    await f.git("config", "core.sparseCheckout", "false");
    await f.checkpoints.begin("session", f.cwd, "recovered");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("session", f.cwd, "recovered");
    expect((await f.checkpoints.status("session", f.cwd)).files[0].undoable).toBe(true);
    await f.checkpoints.change("session", f.cwd, undefined, true);
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("base\n");
  });
  it("records shell edits, additions and deletions while preserving dirty bytes and the staging index", async () => {
    const f = await fixture();
    const a = join(f.cwd, "a.txt");
    await writeFile(a, "owner staged\r\n");
    await f.git("add", "--", "a.txt");
    await writeFile(a, "owner staged\r\nowner unstaged\r\n");
    const index = await readFile(join(f.cwd, ".git", "index"));
    await f.checkpoints.begin("session", f.cwd, "turn");
    // Private checkpoint refs must not break ordinary history commands.
    expect((await f.git("log", "--all", "--oneline")).stdout).toContain("base");
    await exec(
      process.execPath,
      [
        "-e",
        "require('fs').writeFileSync('a.txt','agent\\n');require('fs').writeFileSync('new.txt','new\\n');require('fs').unlinkSync('b.txt')",
      ],
      { cwd: f.cwd, windowsHide: true },
    );
    await f.checkpoints.finish("session", f.cwd, "turn");
    expect(
      (await f.checkpoints.status("session", f.cwd)).files.map((file) => file.relative).sort(),
    ).toEqual(["a.txt", "b.txt", "new.txt"]);
    expect(await readFile(join(f.cwd, ".git", "index"))).toEqual(index);
    await f.checkpoints.change("session", f.cwd, undefined, true);
    expect(await readFile(a, "utf8")).toBe("owner staged\r\nowner unstaged\r\n");
    expect(await readFile(join(f.cwd, "b.txt"), "utf8")).toBe("keep\n");
    await expect(readFile(join(f.cwd, "new.txt"))).rejects.toThrow();
    expect(await readFile(join(f.cwd, ".git", "index"))).toEqual(index);
  });
  it("refuses undo after a later edit or a HEAD change", async () => {
    const f = await fixture();
    await f.checkpoints.begin("session", f.cwd, "turn");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("session", f.cwd, "turn");
    await writeFile(join(f.cwd, "a.txt"), "later\n");
    await expect(f.checkpoints.change("session", f.cwd, undefined, true)).rejects.toThrow(
      "outside this session",
    );
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await writeFile(join(f.cwd, "other.txt"), "head\n");
    await f.git("add", "--", "other.txt");
    await f.git("commit", "-qm", "move HEAD");
    expect((await f.checkpoints.status("session", f.cwd)).files[0].undoable).toBe(false);
    await expect(f.checkpoints.change("session", f.cwd, undefined, true)).rejects.toThrow(
      "HEAD changed",
    );
  });
  it("locks overlapping turns and preserves interrupted ownership across continuation", async () => {
    const f = await fixture();
    await f.checkpoints.begin("first", f.cwd, "one");
    await f.checkpoints.begin("second", f.cwd, "two");
    await f.checkpoints.claim("first", f.cwd, "one", ["a.txt"]);
    await writeFile(join(f.cwd, "a.txt"), "shared\n");
    await f.checkpoints.finish("first", f.cwd, "one");
    await expect(f.checkpoints.change("first", f.cwd, undefined, true)).rejects.toThrow("overlaps");
    await f.checkpoints.finish("second", f.cwd, "two");
    expect((await f.checkpoints.status("first", f.cwd)).files.every((file) => !file.undoable)).toBe(
      true,
    );
    await f.checkpoints.change("first", f.cwd, undefined, false);
    await f.checkpoints.begin("first", f.cwd, "interrupted");
    await writeFile(join(f.cwd, "a.txt"), "partial\n");
    await f.checkpoints.begin("first", f.cwd, "resumed");
    await writeFile(join(f.cwd, "a.txt"), "resumed\n");
    await f.checkpoints.finish("first", f.cwd, "interrupted");
    await expect(f.checkpoints.status("first", f.cwd)).rejects.toThrow("still recording");
    await f.checkpoints.finish("first", f.cwd, "resumed");
    expect((await f.checkpoints.fileDiff("first", f.cwd, "a.txt")).current).toBe("resumed\n");
    await expect(f.checkpoints.change("first", f.cwd, undefined, true)).rejects.toThrow("overlaps");
  });
  it("keeps sibling checkouts independent and wildcard-looking names literal", async () => {
    const f = await fixture();
    const sibling = await fixture();
    await writeFile(join(f.cwd, "[ab].txt"), "owner\n");
    await f.git("add", "--", "[ab].txt");
    await f.git("commit", "-qm", "literal");
    await f.checkpoints.begin("first", f.cwd, "one");
    await f.checkpoints.begin("other", sibling.cwd, "two");
    await writeFile(join(f.cwd, "[ab].txt"), "agent\n");
    await f.checkpoints.finish("first", f.cwd, "one");
    await f.checkpoints.change("first", f.cwd, "[ab].txt", true);
    expect(await readFile(join(f.cwd, "[ab].txt"), "utf8")).toBe("owner\n");
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("base\n");
  });
  it("rejects traversal and symlink/junction ancestors for deleted Git paths", async () => {
    const f = await fixture();
    const outside = join(f.dir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "a.txt"), "outside\n");
    const link = join(f.cwd, "escape");
    if (process.platform === "win32")
      await exec("cmd.exe", ["/d", "/c", "mklink", "/J", link, outside], { windowsHide: true });
    else {
      const { symlink } = await import("node:fs/promises");
      await symlink(outside, link, "dir");
    }
    await expect(safeGitPath(f.cwd, "../outside/a.txt")).rejects.toThrow();
    await expect(safeGitPath(f.cwd, "escape/missing.txt")).rejects.toThrow("outside");
    await expect(hostGitAction(f.cwd, "stage", "escape/a.txt")).rejects.toThrow("outside");
    expect(await readFile(join(outside, "a.txt"), "utf8")).toBe("outside\n");
  });
});

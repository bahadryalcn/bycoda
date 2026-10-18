import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  invalidateHostFilePaths,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "./workspace";

const roots: string[] = [];

it("rejects one of two concurrent saves based on the same file version", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-write-race-"));
  roots.push(root);
  writeFileSync(join(root, "file.txt"), "base");
  const results = await Promise.allSettled([
    writeHostFile(root, "file.txt", "base", "first"),
    writeHostFile(root, "file.txt", "base", "second"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const failure = results.find((result) => result.status === "rejected");
  expect(failure).toMatchObject({
    reason: expect.objectContaining({ message: "File changed on the host; reload before saving" }),
  });
  const current = readFileSync(join(root, "file.txt"), "utf8");
  await writeHostFile(root, "file.txt", current, "retried");
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("retried");
});

function reviewRepo() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-git-regression-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  execFileSync("git", ["config", "core.autocrlf", "false"], {
    cwd: root,
    windowsHide: true,
  });
  return root;
}

function reviewGit(root: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "unstages both rename paths from a project subdirectory (folder: %s, alias: %s)",
  async (folder, alias) => {
    let root = reviewRepo();
    if (alias) {
      const aliases = mkdtempSync(join(tmpdir(), "bycoda-workspace-alias-"));
      roots.push(aliases);
      const target = join(aliases, "checkout");
      symlinkSync(
        realpathSync.native(root),
        target,
        process.platform === "win32" ? "junction" : "dir",
      );
      root = target;
    }
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "old[1].txt"), "original\n");
    writeFileSync(join(root, "keep.txt"), "before\n");
    reviewGit(root, "add", ".");
    reviewGit(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base",
    );
    mkdirSync(join(root, "app", "nested"));
    reviewGit(root, "mv", "old[1].txt", "app/nested/new[1].txt");
    writeFileSync(join(root, "keep.txt"), "unrelated staged change\n");
    reviewGit(root, "add", "keep.txt");
    const child = join(root, "app");
    await hostGitAction(child, "unstage", folder ? "nested" : "nested/new[1].txt");
    expect(reviewGit(root, "diff", "--cached", "--name-status")).toBe("M\tkeep.txt");
    expect(readFileSync(join(child, "nested/new[1].txt"), "utf8")).toBe("original\n");
  },
);

it("searches untracked files while respecting ignore rules", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "new.txt"), "needle-untracked");
  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "ignored.txt"), "needle-untracked");
  expect(
    (await searchHostContent(root, { query: "needle-untracked" })).matches.map(
      (match) => match.relative,
    ),
  ).toEqual(["new.txt"]);
});

it.each([false, true])("preserves literal search whitespace (Git: %s)", async (gitRepo) => {
  const root = gitRepo ? reviewRepo() : mkdtempSync(join(tmpdir(), "bycoda-search-spaces-"));
  if (!gitRepo) roots.push(root);
  writeFileSync(join(root, "sample.txt"), "foo\n  foo  \n   \n");
  expect((await searchHostContent(root, { query: "  foo  " })).matches).toEqual([
    expect.objectContaining({ line: 2, column: 1, preview: "  foo  " }),
  ]);
  expect((await searchHostContent(root, { query: "   " })).matches).toEqual([
    expect.objectContaining({ line: 3, column: 1 }),
  ]);
});

it("reports actual regex columns in editor code units and preserves Git ERE syntax", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "sample.txt"), "start needle end\né😀 needle end\nprefix 123 end\n");
  expect((await searchHostContent(root, { query: "needle", regex: true })).matches).toEqual([
    expect.objectContaining({ line: 1, column: 7 }),
    expect.objectContaining({ line: 2, column: 5 }),
  ]);
  expect((await searchHostContent(root, { query: "[[:digit:]]+", regex: true })).matches).toEqual([
    expect.objectContaining({ line: 3, column: 8 }),
  ]);
});

it.each([false, true])("uses Unicode whole-word boundaries (Git: %s)", async (gitRepo) => {
  const root = gitRepo ? reviewRepo() : mkdtempSync(join(tmpdir(), "bycoda-search-unicode-"));
  if (!gitRepo) roots.push(root);
  writeFileSync(join(root, "sample.txt"), "éfoo\nfooé\n𐐀foo\nfoo𐐀\néfoo foo\nfoo\n");
  expect((await searchHostContent(root, { query: "foo", wholeWord: true })).matches).toEqual([
    expect.objectContaining({ line: 5, column: 6 }),
    expect.objectContaining({ line: 6, column: 1 }),
  ]);
});

it.each([false, true])(
  "retains complete Git results when output exceeds its byte budget (regex: %s)",
  async (regex) => {
    const root = reviewRepo();
    for (let index = 0; index < 10; index++) {
      writeFileSync(join(root, `${index}.txt`), `needle${"x".repeat(900 * 1024)}\n`);
    }
    const result = await searchHostContent(root, { query: "needle", regex });
    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeLessThan(10);
    expect(
      result.matches.every(
        (match) =>
          match.line === 1 && match.column === 1 && match.preview.length === 900 * 1024 + 6,
      ),
    ).toBe(true);
  },
);

it("handles zero-directory recursive globs and reports unsupported fallback regex", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-search-fallback-"));
  roots.push(root);
  writeFileSync(join(root, "top.ts"), "needle");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "nested.ts"), "needle");
  expect(
    (await searchHostContent(root, { query: "needle", include: "**/*.ts" })).matches,
  ).toHaveLength(2);
  expect(
    (await searchHostContent(root, { query: "needle", exclude: "**/*.ts" })).matches,
  ).toHaveLength(0);
  await expect(searchHostContent(root, { query: "need.*", regex: true })).rejects.toThrow(
    "Regex search is unavailable",
  );
});

it("counts staged lines before the first commit with lossless filenames", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "Türkçe.txt"), "one\ntwo\n");
  reviewGit(root, "add", ".");
  const index = await hostGitIndex(root);
  expect(index.files[0]).toMatchObject({ relative: "Türkçe.txt", additions: 2, deletions: 0 });
  expect(index.additions).toBe(2);
});

it("resolves staged rename bases and project-subdirectory diffs", async () => {
  const root = reviewRepo();
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "Türkçe.txt"), "before\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "base",
  );
  const child = join(root, "app");
  writeFileSync(join(child, "Türkçe.txt"), "after\n");
  expect(await hostFileDiff(child, "Türkçe.txt", false)).toMatchObject({
    original: "before\n",
    current: "after\n",
  });
  expect((await hostGitIndex(child)).files[0]).toMatchObject({
    relative: "Türkçe.txt",
    additions: 1,
    deletions: 1,
  });
  reviewGit(root, "checkout", "--", "app/Türkçe.txt");
  reviewGit(root, "mv", "app/Türkçe.txt", "app/renamed.txt");
  expect(await hostFileDiff(child, "renamed.txt", true)).toMatchObject({
    original: "before\n",
    current: "before\n",
  });
});

it("stages, unstages and discards literal paths without touching matching names", async () => {
  const root = reviewRepo();
  for (const file of ["a[1].txt", "a1.txt"]) writeFileSync(join(root, file), "old\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  for (const file of ["a[1].txt", "a1.txt"]) writeFileSync(join(root, file), "new\n");
  await hostGitAction(root, "stage", "a[1].txt");
  expect(reviewGit(root, "diff", "--cached", "--name-only")).toBe("a[1].txt");
  reviewGit(root, "add", ".");
  await hostGitAction(root, "unstage", "a[1].txt");
  expect(reviewGit(root, "diff", "--cached", "--name-only")).toBe("a1.txt");
  writeFileSync(join(root, "a1.txt"), "keep me\n");
  await hostGitAction(root, "discard", "a[1].txt");
  expect(await readHostFile(root, "a[1].txt")).toBe("old\n");
  expect(await readHostFile(root, "a1.txt")).toBe("keep me\n");
});

it("unstages files before the first commit without deleting disk contents", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "a.txt"), "a\n");
  writeFileSync(join(root, "b.txt"), "b\n");
  reviewGit(root, "add", ".");
  await hostGitAction(root, "unstage", "a.txt");
  expect(reviewGit(root, "ls-files")).toBe("b.txt");
  await hostGitAction(root, "unstageAll");
  await hostGitAction(root, "unstageAll");
  expect(reviewGit(root, "ls-files")).toBe("");
  expect(await readHostFile(root, "a.txt")).toBe("a\n");
  expect(await readHostFile(root, "b.txt")).toBe("b\n");
});

it("pushes to the configured upstream and supports a first push without origin", async () => {
  const root = reviewRepo();
  const remote = reviewRepo();
  const origin = reviewRepo();
  reviewGit(remote, "config", "core.bare", "true");
  reviewGit(origin, "config", "core.bare", "true");
  writeFileSync(join(root, "a.txt"), "one\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  reviewGit(root, "branch", "-M", "topic");
  reviewGit(root, "remote", "add", "upstream", remote);
  await hostGitAction(root, "push");
  expect(reviewGit(root, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("upstream/topic");
  reviewGit(root, "remote", "add", "origin", origin);
  writeFileSync(join(root, "a.txt"), "two\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "next",
  );
  await hostGitAction(root, "push");
  expect(reviewGit(remote, "rev-parse", "refs/heads/topic")).toBe(
    reviewGit(root, "rev-parse", "HEAD"),
  );
  expect(reviewGit(root, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("upstream/topic");
  expect(reviewGit(origin, "for-each-ref", "refs/heads")).toBe("");
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("reports a broken Git index instead of searching ignored files", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-broken-index-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), "private.txt\n");
  writeFileSync(join(root, "private.txt"), "ignored");
  writeFileSync(join(root, ".git", "index"), "broken");
  await expect(searchHostFiles(root, "private")).rejects.toThrow();
});

it("serves a project reached through a linked parent folder", async () => {
  // macOS temporary and many user folders sit under /var -> /private/var, and
  // Windows may report a short 8.3 name; the project itself is still inside.
  const real = mkdtempSync(join(tmpdir(), "bycoda-workspace-real-"));
  const linked = `${real}-link`;
  symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
  roots.push(linked, real);
  const root = join(linked, "project");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "source\n");
  symlinkSync(tmpdir(), join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
  expect(await readHostFile(root, "src/app.ts")).toBe("source\n");
  expect(await createHostPath(root, "src", "nested/new.ts", false)).toBe("src/nested/new.ts");
  await expect(readHostFile(root, "outside/anything.txt")).rejects.toThrow();
  await expect(createHostPath(root, "outside", "bad.ts", false)).rejects.toThrow(
    "outside the workspace",
  );
});

it("lists host files and rejects paths escaping the project", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-workspace-")));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.ts"), "source\n");
  symlinkSync(tmpdir(), join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
  expect((await listHostFiles(root, "")).map((entry) => entry.name)).toContain("src");
  expect((await searchHostFiles(root, "app")).map((entry) => entry.path)).toEqual(["src/app.ts"]);
  expect(await readHostFile(root, "src/app.ts")).toBe("source\n");
  expect(await readHostFile(root, join(root, "src", "app.ts"))).toBe("source\n");
  await writeHostFile(root, "src/app.ts", "source\n", "edited\n");
  expect(await readHostFile(root, "src/app.ts")).toBe("edited\n");
  expect(await searchHostContent(root, { query: "edited" })).toMatchObject({
    matches: [expect.objectContaining({ relative: "src/app.ts", line: 1, column: 1 })],
    truncated: false,
  });
  expect(await createHostPath(root, "src", "nested/new.ts", false)).toBe("src/nested/new.ts");
  expect(await readHostFile(root, "src/nested/new.ts")).toBe("");
  expect(await createHostPath(root, "", "assets", true)).toBe("assets");
  await expect(createHostPath(root, "src", "app.ts", false)).rejects.toThrow();
  await expect(createHostPath(root, "", "../outside.txt", false)).rejects.toThrow(
    "Invalid file name",
  );
  await expect(createHostPath(root, "", ".git/config", false)).rejects.toThrow("Invalid file name");
  await expect(createHostPath(root, "outside", "bad.ts", false)).rejects.toThrow("outside");
  await expect(writeHostFile(root, "src/app.ts", "source\n", "lost\n")).rejects.toThrow(
    "changed on the host",
  );
  await expect(listHostFiles(root, "../")).rejects.toThrow("outside");
  await expect(listHostFiles(root, "outside")).rejects.toThrow("outside");
  await expect(readHostFile(root, ".git/config")).rejects.toThrow("outside");
  expect(await hostGitIndex(root)).toMatchObject({
    branch: null,
    files: [],
    additions: 0,
    deletions: 0,
  });
});

it("reports tracked and untracked changes and commits staged files", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-workspace-git-")));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  writeFileSync(join(root, "app.ts"), "before\n");
  git("add", "--", "app.ts");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "app.ts"), "after\n");
  writeFileSync(join(root, "new.ts"), "new\n");

  const index = await hostGitIndex(root);
  expect(
    await searchHostContent(root, {
      query: "AFTER",
      include: "app.ts",
      caseSensitive: false,
    }),
  ).toMatchObject({
    matches: [expect.objectContaining({ relative: "app.ts", line: 1, column: 1 })],
  });
  expect(
    (
      await searchHostContent(root, {
        query: "after",
        exclude: "app.ts",
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "AFTER",
        caseSensitive: true,
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "aft",
        wholeWord: true,
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "aft.r",
        regex: true,
      })
    ).matches,
  ).toEqual([expect.objectContaining({ relative: "app.ts", line: 1 })]);
  expect(index.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relative: "app.ts",
        status: "modified",
        unstaged: true,
      }),
      expect.objectContaining({
        relative: "new.ts",
        status: "untracked",
        unstaged: true,
      }),
    ]),
  );
  expect(await hostFileDiff(root, "app.ts", false)).toMatchObject({
    original: "before\n",
    current: "after\n",
  });
  await expect(hostGitAction(root, "stage", "../outside")).rejects.toThrow("outside");
  await hostGitAction(root, "stageAll");
  expect((await hostGitIndex(root)).files.every((file) => file.staged)).toBe(true);
  expect(await hostFileDiff(root, "app.ts", true)).toMatchObject({
    original: "before\n",
    current: "after\n",
  });
  await hostGitAction(root, "commit", undefined, "remote commit");
  expect((await hostGitIndex(root)).files).toEqual([]);
  const remote = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-workspace-remote-")));
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "-q"], { cwd: remote });
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "HEAD");
  writeFileSync(join(root, "app.ts"), "another change\n");
  git("add", "app.ts");
  git("commit", "-qm", "ahead");
  expect(await hostGitIndex(root)).toMatchObject({
    remote: "origin",
    ahead: 1,
    behind: 0,
  });
  writeFileSync(join(root, "app.ts"), "discard this\n");
  await hostGitAction(root, "discard", "app.ts");
  expect((await hostGitIndex(root)).files).toEqual([]);
});

it("stages and unstages a folder subtree without affecting other changes", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-host-folder-")));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src/nested"), { recursive: true });
  mkdirSync(join(root, "src-other"));
  writeFileSync(join(root, "src/app.ts"), "before\n");
  writeFileSync(join(root, "src/nested/deleted.ts"), "delete me\n");
  writeFileSync(join(root, "src-other/app.ts"), "before\n");
  writeFileSync(join(root, "ready.txt"), "before\n");
  writeFileSync(join(root, ".gitignore"), "src/ignored.txt\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "src/app.ts"), "after\n");
  rmSync(join(root, "src/nested"), { recursive: true });
  mkdirSync(join(root, "src/added"));
  writeFileSync(join(root, "src/added/new.ts"), "new\n");
  writeFileSync(join(root, "src/ignored.txt"), "ignored\n");
  writeFileSync(join(root, "src-other/app.ts"), "outside\n");
  writeFileSync(join(root, "ready.txt"), "ready\n");
  await hostGitAction(root, "stage", "ready.txt");

  await hostGitAction(root, "stage", "src");
  let files = (await hostGitIndex(root)).files;
  expect(files).toHaveLength(5);
  for (const file of files) {
    expect(file.staged).toBe(file.relative.startsWith("src/") || file.relative === "ready.txt");
    expect(file.unstaged).toBe(file.relative === "src-other/app.ts");
  }

  await hostGitAction(root, "unstage", "src");
  files = (await hostGitIndex(root)).files;
  expect(files).toHaveLength(5);
  for (const file of files) {
    expect(file.staged).toBe(file.relative === "ready.txt");
    expect(file.unstaged).toBe(file.relative !== "ready.txt");
  }
  expect(await readHostFile(root, "src/app.ts")).toBe("after\n");

  // A folder can still appear in the Changes tree after it was deleted on disk.
  await hostGitAction(root, "stage", "src/nested");
  expect(
    (await hostGitIndex(root)).files.find((file) => file.relative === "src/nested/deleted.ts"),
  ).toMatchObject({ staged: true, unstaged: false });
  await hostGitAction(root, "unstage", "src/nested");
  expect(
    (await hostGitIndex(root)).files.find((file) => file.relative === "src/nested/deleted.ts"),
  ).toMatchObject({ staged: false, unstaged: true });
});

it("stages selected host diff content without replacing the working file", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-workspace-hunk-")));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/app.ts"), "one\ntwo\nthree\n");
  git("add", "src/app.ts");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "src/app.ts"), "ONE\ntwo\nTHREE\n");
  await hostGitAction(root, "stageContents", "src/app.ts", undefined, "ONE\ntwo\nthree\n");
  expect(git("show", ":src/app.ts")).toBe("ONE\ntwo\nthree\n");
  expect(await readHostFile(root, "src/app.ts")).toBe("ONE\ntwo\nTHREE\n");
  await hostGitAction(root, "discard", "src/app.ts");
  expect(await readHostFile(root, "src/app.ts")).toBe("ONE\ntwo\nthree\n");
  expect(git("ls-files").trim()).toBe("src/app.ts");
  await expect(hostGitAction(root, "stageContents", "../escape", undefined, "x")).rejects.toThrow(
    "outside",
  );
});

it("rejects stale hunk bases and preserves other clients' index and lock files", async () => {
  const root = reviewRepo();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const base = "first\n" + "context\n".repeat(20) + "second\n";
  writeFileSync(join(root, "a.txt"), base);
  git("add", "a.txt");
  git(
    "-c",
    "user.name=Workspace Test",
    "-c",
    "user.email=workspace@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "hunk base",
  );
  const external = base.replace("second", "SECOND");
  writeFileSync(join(root, "a.txt"), external);
  git("add", "a.txt");
  const index = readFileSync(join(root, ".git/index"));
  await expect(
    hostGitAction(root, "stageContents", "a.txt", undefined, base.replace("first", "FIRST"), base),
  ).rejects.toThrow("index changed");
  expect(readFileSync(join(root, ".git/index"))).toEqual(index);
  expect(git("show", ":a.txt")).toBe(external);
  writeFileSync(join(root, ".git/index.lock"), "another writer");
  await expect(
    hostGitAction(root, "stageContents", "a.txt", undefined, external, external),
  ).rejects.toThrow();
  expect(readFileSync(join(root, ".git/index.lock"), "utf8")).toBe("another writer");
  rmSync(join(root, ".git/index.lock"));
  await hostGitAction(
    root,
    "stageContents",
    "a.txt",
    undefined,
    external.replace("first", "FIRST"),
    external,
  );
  expect(git("show", ":a.txt")).toBe(external.replace("first", "FIRST"));
});

it("stages a guarded untracked hunk before the first commit", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-empty-index-")));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "new.txt"), "first\nsecond\n");
  await hostGitAction(root, "stageContents", "new.txt", undefined, "first\n", "");
  expect(git("show", ":new.txt")).toBe("first\n");
});

it("unstages a literal directory before the first commit without touching a matching sibling", async () => {
  const root = reviewRepo();
  for (const folder of ["src[1]", "src1"]) {
    mkdirSync(join(root, folder, "nested"), { recursive: true });
    writeFileSync(join(root, folder, "nested/a.txt"), "keep\n");
  }
  await hostGitAction(root, "stage", "src[1]");
  expect(reviewGit(root, "ls-files")).toBe("src[1]/nested/a.txt");
  await hostGitAction(root, "stage", "src1");
  await hostGitAction(root, "unstage", "src[1]");
  expect(reviewGit(root, "ls-files")).toBe("src1/nested/a.txt");
  expect(await readHostFile(root, "src[1]/nested/a.txt")).toBe("keep\n");
});

it("reuses the file list briefly and drops it after this host changes files or git state", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "one.txt"), "1\n");
  invalidateHostFilePaths();
  expect((await searchHostFiles(root, "txt")).map((f) => f.path)).toEqual(["one.txt"]);
  // Changed behind the host's back: the cached list still serves typing.
  writeFileSync(join(root, "two.txt"), "2\n");
  expect((await searchHostFiles(root, "txt")).map((f) => f.path)).toEqual(["one.txt"]);
  await createHostPath(root, "", "three.txt", false);
  expect((await searchHostFiles(root, "txt")).map((f) => f.path).sort()).toEqual([
    "one.txt",
    "three.txt",
    "two.txt",
  ]);
  writeFileSync(join(root, "four.txt"), "4\n");
  expect((await searchHostFiles(root, "four")).length).toBe(0);
  await hostGitAction(root, "stage", "four.txt");
  expect((await searchHostFiles(root, "four")).map((f) => f.path)).toEqual(["four.txt"]);
  writeFileSync(join(root, "five.txt"), "5\n");
  invalidateHostFilePaths(root);
  expect((await searchHostFiles(root, "five")).map((f) => f.path)).toEqual(["five.txt"]);
});

it("shares one concurrent git index refresh but never serves one begun before a change", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "a.txt"), "a\nb\n");
  const first = hostGitIndex(root);
  expect(hostGitIndex(root)).toBe(first);
  expect((await first).files).toMatchObject([
    { relative: "a.txt", status: "untracked", additions: 2 },
  ]);
  const stale = hostGitIndex(root);
  writeFileSync(join(root, "a.txt"), "a\nb\nc\n");
  await writeHostFile(root, "a.txt", "a\nb\nc\n", "a\nb\nc\nd\n");
  const fresh = hostGitIndex(root);
  expect(fresh).not.toBe(stale);
  expect((await fresh).files[0]?.additions).toBe(4);
  await stale;
});

it("looks up one file's status without the full index", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "tracked.txt"), "old\n");
  writeFileSync(join(root, "other.txt"), "x\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  writeFileSync(join(root, "tracked.txt"), "new\n");
  writeFileSync(join(root, "fresh.txt"), "a\nb");
  expect(await hostFileDiff(root, "tracked.txt", false)).toMatchObject({
    status: "modified",
    original: "old\n",
    current: "new\n",
  });
  expect(await hostFileDiff(root, "fresh.txt", false)).toMatchObject({ status: "untracked" });
  await expect(hostFileDiff(root, "other.txt", false)).rejects.toThrow("no uncommitted changes");
  await expect(hostGitAction(root, "discard", "other.txt")).rejects.toThrow(
    "no changes to discard",
  );
  await hostGitAction(root, "discard", "tracked.txt");
  expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe("old\n");
  expect((await hostGitIndex(root)).files).toMatchObject([{ relative: "fresh.txt", additions: 2 }]);
});

it("reports a staged rename's status the same way as the full index", async () => {
  const root = reviewRepo();
  writeFileSync(join(root, "old-name.txt"), "line one\nline two\nline three\n");
  reviewGit(root, "add", ".");
  reviewGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  reviewGit(root, "mv", "old-name.txt", "new-name.txt");
  const entry = (await hostGitIndex(root)).files.find((file) => file.relative === "new-name.txt");
  expect(entry).toBeDefined();
  expect(await hostFileDiff(root, "new-name.txt", true)).toMatchObject({ status: entry!.status });
});

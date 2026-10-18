import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCommands } from "./workspace-commands";
import {
  BranchCache,
  GIT_ACTION_COMMANDS,
  parseHistoryLog,
  runGitAction,
  type GitActionCommand,
} from "./git-actions";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

function repo() {
  const cwd = temp("bycoda-git-actions-");
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  // A Windows runner defaults to autocrlf=true, which rewrites the files these tests read back.
  git("config", "core.autocrlf", "false");
  const write = (name: string, text: string) => writeFileSync(join(cwd, name), text);
  const commit = (name: string, text: string, message = `edit ${name}`) => {
    write(name, text);
    git("add", name);
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const run = (command: GitActionCommand, input: Record<string, unknown> = {}) =>
    runGitAction(command, cwd, input);
  return { cwd, git, write, commit, run };
}

describe("validation", () => {
  it.each(["git_merge", "git_rebase", "git_create_branch_from"] as const)(
    "%s targets the selected local branch when a tag has the same name",
    async (command) => {
      const r = repo();
      const base = r.commit("a.txt", "base\n");
      r.git("checkout", "-qb", "topic");
      const target = r.commit("b.txt", "feature\n");
      r.git("checkout", "-q", "main");
      r.git("tag", "topic", base);
      await r.run(command, { reference: "topic", name: "from-topic" });
      expect(r.git("rev-parse", "HEAD")).toBe(target);
    },
  );

  it("merges the exact remote branch when a tag has the same spelling", async () => {
    const r = repo();
    const base = r.commit("a.txt", "base\n");
    const target = r.commit("b.txt", "feature\n");
    r.git("update-ref", "refs/remotes/origin/topic", target);
    r.git("checkout", "-qb", "before", base);
    r.git("tag", "origin/topic", base);
    await r.run("git_merge", { reference: "origin/topic" });
    expect(r.git("rev-parse", "HEAD")).toBe(target);
  });
  it("trusts only the confirmed repository, preserving other safe.directory entries", async () => {
    const r = repo();
    r.commit("a.txt", "one\n");
    const config = join(r.cwd, "isolated-global-config");
    writeFileSync(config, "[safe]\n\tdirectory = /already/trusted\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_CONFIG_COUNT", "0");
    vi.stubEnv("GIT_TEST_ASSUME_DIFFERENT_OWNER", "1");
    try {
      await expect(r.run("git_trust_repository")).rejects.toThrow(/confirmation/);
      expect(readFileSync(config, "utf8")).not.toContain(r.cwd);
      await r.run("git_trust_repository", { confirmed: true, path: "*" });
      const safe = r.git("config", "--global", "--get-all", "safe.directory").split("\n");
      expect(safe).toEqual(["/already/trusted", realpathSync(r.cwd).replaceAll("\\", "/")]);
      expect(r.git("rev-parse", "--is-inside-work-tree")).toBe("true");
      await r.run("git_trust_repository", { confirmed: true });
      expect(r.git("config", "--global", "--get-all", "safe.directory").split("\n")).toEqual(safe);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("never lets a UI string become a git option", async () => {
    const r = repo();
    const head = r.commit("a.txt", "one\n");
    for (const sha of [
      "--help",
      "-d",
      "zz",
      "",
      "deadbeef",
      head.slice(0, 3),
      `${head};ls`,
      5,
      null,
    ])
      for (const command of ["git_checkout_commit", "git_cherry_pick", "git_revert"] as const)
        await expect(r.run(command, { sha })).rejects.toThrow(/commit/i);
    await expect(r.run("git_reset", { sha: "--hard", mode: "hard" })).rejects.toThrow(
      "Invalid commit",
    );
    await expect(r.run("git_reset", { sha: head, mode: "--hard" })).rejects.toThrow(
      "Invalid reset mode",
    );
    await expect(r.run("git_reset", { sha: head, mode: "constructor" })).rejects.toThrow(
      "Invalid reset mode",
    );

    for (const name of [
      "-b",
      "--force",
      "has space",
      "a..b",
      "@{-1}",
      "",
      "x".repeat(300),
      "feat~1",
      3,
    ])
      await expect(r.run("git_create_branch_at", { name, sha: head })).rejects.toThrow();
    for (const name of ["-t", "a b", "x..y", "", "tag.lock"])
      await expect(r.run("git_create_tag", { name, sha: head })).rejects.toThrow();
    await expect(r.run("git_delete_tag", { name: "-d" })).rejects.toThrow("not a valid tag name");

    for (const reference of ["--all", "-x", "", "missing", "origin/--help"]) {
      await expect(r.run("git_merge", { reference })).rejects.toThrow();
      await expect(r.run("git_rebase", { reference })).rejects.toThrow();
      await expect(r.run("git_create_branch_from", { name: "ok", reference })).rejects.toThrow();
    }
    await expect(r.run("git_stash", { mode: "all" })).rejects.toThrow("Invalid stash mode");
    await expect(r.run("git_stash", { mode: ["tracked"] })).rejects.toThrow("Invalid stash mode");
    await expect(r.run("git_stash", { message: "x".repeat(2000) })).rejects.toThrow(
      "Invalid stash message",
    );
    for (const action of ["clear", "--help", "", undefined])
      await expect(r.run("git_stash_action", { action, index: 0 })).rejects.toThrow(
        "Invalid stash action",
      );
    for (const index of [-1, 1.5, "0", "0}; ls", null])
      await expect(r.run("git_stash_action", { action: "drop", index })).rejects.toThrow(
        "Invalid stash",
      );

    await expect(
      r.run("git_remote_add", { name: "-x", url: "https://example.test/a.git" }),
    ).rejects.toThrow("not a valid remote name");
    await expect(
      r.run("git_remote_add", { name: "up stream", url: "https://example.test/a.git" }),
    ).rejects.toThrow("not a valid remote name");
    await expect(r.run("git_remote_add", { name: "ok", url: "--upload-pack=ls" })).rejects.toThrow(
      "Invalid remote URL",
    );
    await expect(r.run("git_remote_add", { name: "ok", url: "" })).rejects.toThrow(
      "cannot be empty",
    );
    await expect(r.run("git_remote_remove", { name: "-x" })).rejects.toThrow("does not exist");
    await expect(r.run("git_remote_remove", { name: "nope" })).rejects.toThrow("does not exist");
    await expect(r.run("git_delete_remote_branch", { remote: "-x", name: "main" })).rejects.toThrow(
      "does not exist",
    );
    await expect(r.run("git_fetch", {})).rejects.toThrow("No git remote");
  });

  it("confines file arguments to the project", async () => {
    const r = repo();
    r.commit("a.txt", "one\n");
    for (const relative of [
      "../a.txt",
      "/etc/passwd",
      ".git/config",
      "",
      "a\0b",
      7,
      "sub/../../a.txt",
    ]) {
      await expect(r.run("git_blame", { relative })).rejects.toThrow();
      await expect(r.run("git_file_history", { relative })).rejects.toThrow();
      await expect(r.run("git_resolve_conflict", { relative, side: "ours" })).rejects.toThrow();
    }
    await expect(
      r.run("git_resolve_conflict", { relative: "a.txt", side: "--ours" }),
    ).rejects.toThrow("Invalid side");
    await expect(
      r.run("git_resolve_conflict", { relative: "a.txt", side: "toString" }),
    ).rejects.toThrow("Invalid side");
  });

  it("refuses a folder that is not a repository", async () => {
    const cwd = temp("bycoda-not-a-repo-");
    await expect(runGitAction("git_stash", cwd, {})).rejects.toThrow("Not a git repository");
    // The polled reads report an idle repository instead.
    expect(await runGitAction("git_operation_status", cwd, {})).toEqual({
      operation: null,
      conflicts: [],
    });
    expect(await runGitAction("git_tags", cwd, {})).toEqual([]);
  });

  it("covers every advertised command", () => {
    expect(new Set(GIT_ACTION_COMMANDS).size).toBe(GIT_ACTION_COMMANDS.length);
  });
});

describe("stashes", () => {
  it.each(["apply", "pop", "drop"])(
    "rejects stale stash identity for %s without touching either stash",
    async (action) => {
      const r = repo();
      r.commit("tracked.txt", "base\n");
      r.write("tracked.txt", "A\n");
      await r.run("git_stash", { message: "A" });
      const expectedSha = r.git("rev-parse", "stash@{0}");
      r.write("tracked.txt", "B\n");
      await r.run("git_stash", { message: "B" });
      const before = r.git("stash", "list", "--format=%H");
      await expect(r.run("git_stash_action", { action, index: 0, expectedSha })).rejects.toThrow(
        "Stash list changed",
      );
      expect(r.git("stash", "list", "--format=%H")).toBe(before);
      expect(readFileSync(join(r.cwd, "tracked.txt"), "utf8")).toBe("base\n");
      await expect(r.run("git_stash_action", { action, index: 0 })).rejects.toThrow(
        "Expected stash SHA",
      );
    },
  );
  it("stashes by mode, lists, applies, pops, drops and clears", async () => {
    const r = repo();
    r.commit("tracked.txt", "base\n");
    const dirty = () => {
      r.write("tracked.txt", "changed\n");
      r.write("fresh.txt", "new\n");
    };

    dirty();
    await r.run("git_stash", { message: "  tracked only ", mode: "tracked" });
    expect(r.git("status", "--porcelain")).toBe("?? fresh.txt");
    expect(await r.run("git_stash_list")).toEqual([
      expect.objectContaining({ index: 0, message: expect.stringContaining("tracked only") }),
    ]);
    await r.run("git_stash_action", {
      action: "pop",
      index: 0,
      expectedSha: r.git("rev-parse", "stash@{0}"),
    });
    expect(readFileSync(join(r.cwd, "tracked.txt"), "utf8")).toBe("changed\n");
    expect(await r.run("git_stash_list")).toEqual([]);

    // The default includes untracked files.
    await r.run("git_stash", {});
    expect(r.git("status", "--porcelain")).toBe("");
    await r.run("git_stash_action", {
      action: "apply",
      index: 0,
      expectedSha: r.git("rev-parse", "stash@{0}"),
    });
    expect(r.git("status", "--porcelain")).toContain("fresh.txt");
    expect(await r.run("git_stash_list")).toHaveLength(1);
    await r.run("git_stash_action", {
      action: "drop",
      index: 0,
      expectedSha: r.git("rev-parse", "stash@{0}"),
    });
    expect(await r.run("git_stash_list")).toEqual([]);

    // `staged` leaves unstaged edits in place.
    r.git("add", "tracked.txt");
    writeFileSync(join(r.cwd, "fresh.txt"), "edited\n");
    await r.run("git_stash", { mode: "staged" });
    expect(r.git("status", "--porcelain")).toBe("?? fresh.txt");
    await r.run("git_stash", { mode: "untracked" });
    expect(await r.run("git_stash_list")).toHaveLength(2);
    await r.run("git_stash_clear");
    expect(await r.run("git_stash_list")).toEqual([]);
  });
});

describe("commits, branches, tags", () => {
  it("checks out commits and creates branches and tags at them", async () => {
    const r = repo();
    const first = r.commit("a.txt", "one\n");
    r.commit("a.txt", "two\n");

    await r.run("git_checkout_commit", { sha: first.slice(0, 8) });
    expect(r.git("rev-parse", "HEAD")).toBe(first);
    expect(await r.run("git_create_branch_at", { name: "from-first", sha: first })).toBe(
      "from-first",
    );
    expect(r.git("branch", "--show-current")).toBe("from-first");
    await expect(r.run("git_create_branch_at", { name: "from-first", sha: first })).rejects.toThrow(
      "already exists",
    );

    await r.run("git_create_tag", { name: "v1", sha: first });
    await expect(r.run("git_create_tag", { name: "v1", sha: first })).rejects.toThrow(
      "already exists",
    );
    expect(await r.run("git_tags")).toEqual(["v1"]);
    await r.run("git_delete_tag", { name: "v1" });
    await expect(r.run("git_delete_tag", { name: "v1" })).rejects.toThrow("does not exist");
    expect(await r.run("git_tags")).toEqual([]);

    r.git("checkout", "-q", "main");
    expect(await r.run("git_create_branch_from", { name: "topic", reference: "from-first" })).toBe(
      "topic",
    );
    expect(r.git("rev-parse", "HEAD")).toBe(first);
  });

  it("explains a checkout blocked by local changes", async () => {
    const r = repo();
    const first = r.commit("a.txt", "one\n");
    r.commit("a.txt", "two\n");
    r.write("a.txt", "dirty\n");
    await expect(r.run("git_checkout_commit", { sha: first })).rejects.toThrow(
      "Your local changes would be overwritten. Commit or stash them first.",
    );
  });

  it("cherry-picks, reverts, resets and undoes the last commit", async () => {
    const r = repo();
    const base = r.commit("a.txt", "base\n");
    r.git("checkout", "-q", "-b", "side");
    const picked = r.commit("b.txt", "side\n", "side work");
    r.git("checkout", "-q", "main");

    await r.run("git_cherry_pick", { sha: picked });
    expect(r.git("log", "-1", "--format=%s")).toBe("side work");
    await r.run("git_revert", { sha: r.git("rev-parse", "HEAD") });
    expect(r.git("log", "-1", "--format=%s")).toContain("Revert");

    await r.run("git_reset", { sha: base, mode: "soft" });
    expect(r.git("rev-parse", "HEAD")).toBe(base);
    await r.run("git_reset", { sha: base, mode: "hard" });
    expect(r.git("status", "--porcelain")).toBe("");

    r.commit("c.txt", "c\n", "last");
    await r.run("git_undo_last_commit");
    expect(r.git("status", "--porcelain")).toBe("A  c.txt");
    expect(r.git("rev-parse", "HEAD")).toBe(base);
    await expect(r.run("git_undo_last_commit")).rejects.toThrow("first commit");
  });

  it("deletes and renames branches", async () => {
    const r = repo();
    r.commit("a.txt", "one\n");
    r.git("branch", "old");
    await expect(r.run("git_delete_branch", { name: "main" })).rejects.toThrow("current branch");
    expect(await r.run("git_rename_branch", { from: "old", to: "new" })).toBe("new");
    await expect(r.run("git_rename_branch", { from: "new", to: "main" })).rejects.toThrow(
      "already exists",
    );
    r.git("checkout", "-q", "new");
    r.commit("b.txt", "unmerged\n");
    r.git("checkout", "-q", "main");
    await expect(r.run("git_delete_branch", { name: "new" })).rejects.toThrow(/not fully merged/);
    await r.run("git_delete_branch", { name: "new", force: true });
    expect(r.git("branch", "--format=%(refname:short)")).toBe("main");
  });
});

describe("remotes", () => {
  it("adds, fetches, prunes and removes remotes and deletes remote branches", async () => {
    const r = repo();
    r.commit("a.txt", "one\n");
    const server = temp("bycoda-git-remote-");
    execFileSync("git", ["init", "-q", "--bare"], { cwd: server });

    await r.run("git_remote_add", { name: "origin", url: server });
    await expect(r.run("git_remote_add", { name: "origin", url: server })).rejects.toThrow(
      "already exists",
    );
    expect(await r.run("git_remotes")).toEqual([{ name: "origin", url: server }]);

    r.git("push", "-q", "origin", "main:main", "main:gone");
    await r.run("git_fetch", {});
    expect(r.git("branch", "-r", "--format=%(refname:short)")).toContain("origin/gone");

    execFileSync("git", ["branch", "-D", "gone"], { cwd: server });
    await r.run("git_fetch", {});
    expect(r.git("branch", "-r", "--format=%(refname:short)")).toContain("origin/gone");
    await r.run("git_fetch", { prune: true });
    expect(r.git("branch", "-r", "--format=%(refname:short)")).not.toContain("origin/gone");

    r.git("push", "-q", "origin", "main:extra");
    await expect(
      r.run("git_delete_remote_branch", { remote: "origin", name: "-x" }),
    ).rejects.toThrow();
    await r.run("git_delete_remote_branch", { remote: "origin", name: "extra" });
    expect(
      execFileSync("git", ["branch", "--format=%(refname:short)"], {
        cwd: server,
        encoding: "utf8",
      }),
    ).not.toContain("extra");

    await r.run("git_remote_remove", { name: "origin" });
    expect(await r.run("git_remotes")).toEqual([]);
  });
});

describe("history and blame", () => {
  it("seçilen committeki blame ve tam mesajı HEAD'den bağımsız okur", async () => {
    const r = repo();
    const first = r.commit("old.txt", "original\n", "first subject\n\nfirst body");
    r.git("mv", "old.txt", "new.txt");
    r.git("commit", "-qm", "rename");
    r.write("new.txt", "uncommitted content\n");
    expect(await r.run("git_blame", { relative: "old.txt", sha: first })).toMatchObject([
      { line: 1, sha: first },
    ]);
    expect(await r.run("git_commit_message", { sha: first })).toContain(
      "first subject\n\nfirst body",
    );
    for (const sha of ["--help", "HEAD", "deadbeef", null]) {
      await expect(r.run("git_blame", { relative: "old.txt", sha })).rejects.toThrow();
      await expect(r.run("git_commit_message", { sha })).rejects.toThrow();
    }
  });
  it("follows a file and blames its lines", async () => {
    const r = repo();
    const first = r.commit("a.txt", "one\ntwo\n", "add a");
    r.git("mv", "a.txt", "b.txt");
    r.git("commit", "-q", "-m", "rename to b");
    const third = r.commit("b.txt", "one\ntwo\nthree\n", "extend b");

    const history = (await r.run("git_file_history", { relative: "b.txt", limit: 10 })) as {
      sha: string;
      subject: string;
      head: boolean;
    }[];
    expect(history.map((entry) => entry.subject)).toEqual(["extend b", "rename to b", "add a"]);
    expect(history[0]).toMatchObject({ sha: third, head: true });
    expect(history[2]!.sha).toBe(first);
    expect(await r.run("git_file_history", { relative: "b.txt", limit: 1 })).toHaveLength(1);

    const blame = (await r.run("git_blame", { relative: "b.txt" })) as {
      line: number;
      sha: string;
      shortSha: string;
      author: string;
      summary: string;
    }[];
    expect(blame.map((line) => [line.line, line.sha, line.summary])).toEqual([
      [1, first, "add a"],
      [2, first, "add a"],
      [3, third, "extend b"],
    ]);
    expect(blame[0]).toMatchObject({ author: "Test", shortSha: first.slice(0, 7) });
    r.write("untracked.txt", "x\n");
    await expect(r.run("git_blame", { relative: "untracked.txt" })).rejects.toThrow(
      "Could not blame this file",
    );
  });

  it("classifies refs in history records", () => {
    const sha = "a".repeat(40);
    const fields = [sha, "aaaaaaa", "", "Ann", "100", "subject"];
    const record = `${fields.join("\0")}\x1e`;
    expect(
      parseHistoryLog(
        record,
        sha,
        new Map([
          [
            sha,
            [
              { name: "main", kind: "local" },
              { name: "v1", kind: "tag" },
              { name: "origin/main", kind: "remote" },
              { name: "topic", kind: "local" },
            ],
          ],
        ]),
      ),
    ).toEqual([
      {
        sha,
        shortSha: "aaaaaaa",
        parents: [],
        author: "Ann",
        timestamp: 100,
        subject: "subject",
        refs: [
          { name: "main", kind: "local" },
          { name: "v1", kind: "tag" },
          { name: "origin/main", kind: "remote" },
          { name: "topic", kind: "local" },
        ],
        head: true,
      },
    ]);
  });

  it("preserves comma-containing tags and branches through real history actions", async () => {
    const r = repo();
    const sha = r.commit("a.txt", "first\n");
    r.git("tag", "-a", "release,one", "-m", "Annotated release");
    r.git("branch", "topic,one");
    r.git("update-ref", "refs/remotes/origin/topic,one", sha);
    r.git("remote", "add", "origin", "https://example.invalid/repo.git");
    r.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/topic,one");
    r.git("symbolic-ref", "refs/heads/alias,one", "refs/heads/main");
    r.git("symbolic-ref", "refs/remotes/origin/stable,one", "refs/remotes/origin/topic,one");
    const parsed = (await r.run("git_file_history", { relative: "a.txt" })) as ReturnType<
      typeof parseHistoryLog
    >;
    expect(parsed[0].refs).toEqual(
      expect.arrayContaining([
        { name: "main", kind: "local" },
        { name: "release,one", kind: "tag" },
        { name: "topic,one", kind: "local" },
        { name: "origin/topic,one", kind: "remote" },
        { name: "alias,one", kind: "local" },
        { name: "origin/stable,one", kind: "remote" },
      ]),
    );
    expect(parsed[0].refs).toHaveLength(6);
    const commands = new WorkspaceCommands(
      { projects: () => [{ cwd: r.cwd }], attachmentDir: join(r.cwd, "attachments") } as never,
      (async (_id: string, action: () => Promise<unknown>) => action()) as never,
    );
    const graph = (await commands.run("git_history", { cwd: r.cwd, all: true })) as {
      commits: typeof parsed;
    };
    expect(graph.commits[0].refs).toEqual(parsed[0].refs);
    r.git("checkout", "--detach", "-q", sha);
    const detached = (await r.run("git_file_history", { relative: "a.txt" })) as typeof parsed;
    expect(detached[0].head).toBe(true);
    expect(detached[0].refs).not.toContainEqual({ name: "HEAD", kind: "local" });
  });
});

describe("stopped operations", () => {
  it("merges with a conflict, resolves it, and continues", async () => {
    const r = repo();
    r.commit("a.txt", "base\n");
    r.git("checkout", "-q", "-b", "feature");
    r.commit("a.txt", "feature\n", "feature side");
    r.git("checkout", "-q", "main");
    r.commit("a.txt", "main\n", "main side");

    expect(await r.run("git_operation_status")).toEqual({ operation: null, conflicts: [] });
    await expect(r.run("git_merge", { reference: "feature" })).rejects.toThrow(/conflict/i);
    expect(await r.run("git_operation_state")).toBe("merge");
    expect(await r.run("git_conflicts")).toEqual(["a.txt"]);
    expect(await r.run("git_operation_status")).toEqual({
      operation: "merge",
      conflicts: ["a.txt"],
    });

    await r.run("git_resolve_conflict", { relative: "a.txt", side: "theirs" });
    expect(readFileSync(join(r.cwd, "a.txt"), "utf8")).toBe("feature\n");
    expect(await r.run("git_operation_status")).toEqual({ operation: "merge", conflicts: [] });

    await r.run("git_operation_continue");
    expect(await r.run("git_operation_state")).toBeNull();
    expect(r.git("log", "-1", "--format=%p").split(" ")).toHaveLength(2);
    await expect(r.run("git_operation_continue")).rejects.toThrow("No operation in progress");
    await expect(r.run("git_operation_abort")).rejects.toThrow("No operation in progress");
  });

  it("aborts a merge, and reports cherry-picks, reverts and rebases", async () => {
    const r = repo();
    const base = r.commit("a.txt", "base\n");
    r.git("checkout", "-q", "-b", "feature");
    const theirs = r.commit("a.txt", "feature\n", "feature side");
    r.git("checkout", "-q", "main");
    r.commit("a.txt", "main\n", "main side");

    await expect(r.run("git_merge", { reference: "feature" })).rejects.toThrow();
    await r.run("git_operation_abort");
    expect(await r.run("git_operation_state")).toBeNull();
    expect(r.git("status", "--porcelain")).toBe("");

    await expect(r.run("git_cherry_pick", { sha: theirs })).rejects.toThrow();
    expect(await r.run("git_operation_state")).toBe("cherry-pick");
    await r.run("git_resolve_conflict", { relative: "a.txt", side: "theirs" });
    await r.run("git_operation_continue");
    expect(await r.run("git_operation_state")).toBeNull();

    await expect(r.run("git_revert", { sha: base })).rejects.toThrow();
    expect(await r.run("git_operation_state")).toBe("revert");
    await r.run("git_operation_abort");

    r.git("checkout", "-q", "-b", "other", base);
    r.commit("a.txt", "other\n", "other side");
    await expect(r.run("git_rebase", { reference: "main" })).rejects.toThrow();
    expect(await r.run("git_operation_state")).toBe("rebase");
    expect(await r.run("git_conflicts")).toEqual(["a.txt"]);
    await r.run("git_operation_abort");
    expect(await r.run("git_operation_state")).toBeNull();
  });
});

describe("BranchCache", () => {
  it("shares one lookup between concurrent callers and honours the TTL", async () => {
    let now = 0;
    const lookup = vi.fn(async (_cwd: string) => "main");
    const cache = new BranchCache(lookup, 4_000, 256, () => now);
    await expect(Promise.all([cache.get("/a"), cache.get("/a"), cache.get("/a")])).resolves.toEqual(
      ["main", "main", "main"],
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 3_999;
    await cache.get("/a");
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 4_001;
    await cache.get("/a");
    expect(lookup).toHaveBeenCalledTimes(2);
    await cache.get("/b");
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("clear makes the next read look again, and a failed lookup yields an empty branch", async () => {
    const lookup = vi
      .fn<(cwd: string) => Promise<string>>()
      .mockResolvedValueOnce("main")
      .mockRejectedValueOnce(new Error("not a repository"))
      .mockResolvedValue("feature");
    const cache = new BranchCache(lookup);
    expect(await cache.get("/a")).toBe("main");
    cache.clear();
    expect(await cache.get("/a")).toBe("");
    cache.clear();
    expect(await cache.get("/a")).toBe("feature");
  });

  it("stays bounded, dropping expired entries first", async () => {
    let now = 0;
    const lookup = vi.fn(async (cwd: string) => cwd);
    const cache = new BranchCache(lookup, 1_000, 3, () => now);
    for (const cwd of ["/1", "/2", "/3"]) await cache.get(cwd);
    now = 2_000;
    await cache.get("/4");
    expect((cache as unknown as { entries: Map<string, unknown> }).entries.size).toBe(1);
    for (const cwd of ["/5", "/6", "/7"]) await cache.get(cwd);
    expect(
      (cache as unknown as { entries: Map<string, unknown> }).entries.size,
    ).toBeLessThanOrEqual(3);
  });
});

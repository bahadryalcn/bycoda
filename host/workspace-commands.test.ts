import { afterEach, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceCommands } from "./workspace-commands";
import { hostWorktrees } from "./git-worktrees";
import * as workspace from "./workspace";
import * as gitActions from "./git-actions";

vi.mock("./git-worktrees", () => ({ hostWorktrees: vi.fn() }));
const roots: string[] = [];

it("isolates search cancellation by server owner and cancels revoked-owner work", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const root = vi
    .spyOn(commands as unknown as { gitRoot(cwd: unknown): Promise<string> }, "gitRoot")
    .mockResolvedValue(cwd);
  const signals: AbortSignal[] = [];
  const search = vi
    .spyOn(workspace, "searchHostContent")
    .mockImplementation(async (_root, _input, signal) => {
      signals.push(signal!);
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
      );
    });
  try {
    const first = commands
      .run("search_project", { options: { cwd, query: "x", searchId: "same-id" } }, "owner-a")
      .catch((error) => error);
    const second = commands
      .run("search_project", { options: { cwd, query: "x", searchId: "same-id" } }, "owner-b")
      .catch((error) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    await commands.run("cancel_project_search", { cwd, searchId: "same-id" }, "owner-a");
    expect(await first).toMatchObject({ message: "cancelled" });
    expect(signals[1].aborted).toBe(false);
    commands.cancelSearches("owner-b");
    expect(await second).toMatchObject({ message: "cancelled" });
    root.mockRestore();
    await expect(
      commands.run("cancel_project_search", { cwd: "../outside", searchId: "same-id" }, "owner-a"),
    ).rejects.toThrow();
  } finally {
    root.mockRestore();
    search.mockRestore();
  }
});

it.each(["cancel", "revoke"])(
  "prevents late search registration after %s during root validation",
  async (kind) => {
    const { projects, commands } = await setup();
    const cwd = projects[104].cwd;
    let release!: (value: string) => void;
    const root = vi
      .spyOn(commands as unknown as { gitRoot(cwd: unknown): Promise<string> }, "gitRoot")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(cwd);
    const search = vi.spyOn(workspace, "searchHostContent");
    try {
      const pending = commands
        .run("search_project", { options: { cwd, query: "x", searchId: "late-id" } }, "late-owner")
        .catch((error) => error);
      if (kind === "cancel")
        await commands.run("cancel_project_search", { cwd, searchId: "late-id" }, "late-owner");
      else commands.cancelSearches("late-owner");
      release(cwd);
      expect(await pending).toBeInstanceOf(Error);
      expect(search).not.toHaveBeenCalled();
    } finally {
      root.mockRestore();
      search.mockRestore();
    }
  },
);
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-roots-")));
  roots.push(root);
  const projects = Array.from({ length: 105 }, (_, index) => ({
    cwd: join(root, `project-${index}`),
  }));
  await mkdir(projects[104].cwd);
  const commands = new WorkspaceCommands(
    { projects: () => projects, attachmentDir: join(root, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  return { root, projects, commands };
}

it("pins PR creation to the reviewed provider repository and reads its destination without publishing", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const bridge = commands as unknown as {
    gitRoot: (cwd: unknown) => Promise<string>;
    ghCommand: (cwd: unknown, args: string[]) => Promise<string>;
  };
  const root = vi.spyOn(bridge, "gitRoot").mockResolvedValue(cwd);
  const gh = vi
    .spyOn(bridge, "ghCommand")
    .mockResolvedValueOnce(
      JSON.stringify({ nameWithOwner: "owner/repo", url: "https://github.com/owner/repo" }),
    )
    .mockResolvedValue("https://github.com/owner/repo/pull/1");
  try {
    expect(await commands.run("git_pr_destination", { cwd })).toEqual({
      nameWithOwner: "owner/repo",
      url: "https://github.com/owner/repo",
    });
    await commands.run("git_pr_create", {
      cwd,
      repository: "github.com/owner/repo",
      title: "Review",
      body: "Body",
      base: "main",
      head: "feature",
    });
    expect(gh).toHaveBeenLastCalledWith(cwd, [
      "pr",
      "create",
      "--repo",
      "github.com/owner/repo",
      "--title",
      "Review",
      "--body",
      "Body",
      "--base",
      "main",
      "--head",
      "feature",
    ]);
    await expect(
      commands.run("git_pr_create", {
        cwd,
        repository: "--bad",
        title: "Review",
        body: "Body",
        base: "main",
        head: "feature",
      }),
    ).rejects.toThrow("Invalid pull request repository");
    expect(gh).toHaveBeenCalledTimes(2);
  } finally {
    gh.mockRestore();
    root.mockRestore();
  }
});

it("routes file and summary requests to the lightweight index, including conflict counts", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const value = {
    files: [],
    conflicts: [{ relative: "conflict.txt" }],
    additions: 2,
    deletions: 1,
  } as never;
  const read = vi.spyOn(workspace, "hostGitIndex").mockResolvedValue(value);
  try {
    await commands.run("git_diff_files", { cwd });
    expect(read).toHaveBeenLastCalledWith(await realpath(cwd), false);
    expect(await commands.run("git_diff_stats", { cwd })).toEqual({
      files: 1,
      additions: 2,
      deletions: 1,
    });
    expect(read).toHaveBeenLastCalledWith(await realpath(cwd), false);
    await commands.run("git_diff_index", { cwd });
    expect(read).toHaveBeenLastCalledWith(await realpath(cwd), true);
  } finally {
    read.mockRestore();
  }
});

it("dispatches local staging while fetch is pending without bypassing the repository queues", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  await mkdir(join(cwd, ".git"));
  let releaseFetch!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.spyOn(gitActions, "runGitAction").mockImplementation(async () => {
    started();
    await new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
  });
  const stage = vi.spyOn(workspace, "hostGitAction").mockResolvedValue(undefined);
  let pending: Promise<unknown> | undefined;
  try {
    pending = commands.run("git_fetch", { cwd });
    await ready;
    await commands.run("git_stage_all", { cwd });
    expect(stage).toHaveBeenCalled();
  } finally {
    releaseFetch?.();
    await pending;
    fetch.mockRestore();
    stage.mockRestore();
  }
});

it("passes disabled skill copies to host discovery before deduplication", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const folder = join(cwd, ".agents/skills/round8-disabled-unique");
  await mkdir(folder, { recursive: true });
  const path = join(folder, "SKILL.md");
  await writeFile(path, "# unique");
  const name = "round8-disabled-unique";
  expect(
    ((await commands.run("list_skills", { cwd })) as { name: string }[]).some(
      (skill) => skill.name === name,
    ),
  ).toBe(true);
  expect(
    ((await commands.run("list_skills", { cwd, disabledPaths: null })) as { name: string }[]).some(
      (skill) => skill.name === name,
    ),
  ).toBe(true);
  expect(
    (
      (await commands.run("list_skills", { cwd, disabledPaths: [path] })) as { name: string }[]
    ).some((skill) => skill.name === name),
  ).toBe(false);
  await expect(commands.run("list_skills", { cwd, disabledPaths: [42] })).rejects.toThrow(
    "Invalid disabled",
  );
});

it("opens a file among 105 registered projects without querying Git", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "hello.txt");
  await writeFile(path, "hello");
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).not.toHaveBeenCalled();
});

it("isolates concurrent atomic text saves and removes only owned temporary files", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "same.txt");
  await writeFile(path, "base");
  const otherConnection = new WorkspaceCommands(
    { projects: () => projects, attachmentDir: join(projects[104].cwd, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  const contents = Array.from({ length: 24 }, (_, index) => `complete-save-${index}`);
  const now = vi.spyOn(Date, "now").mockReturnValue(42);
  try {
    await Promise.all(
      contents.map(
        async (content, index) =>
          await (index % 2 ? commands : otherConnection).run("write_text_file", { path, content }),
      ),
    );
  } finally {
    now.mockRestore();
  }
  expect(contents).toContain(await readFile(path, "utf8"));
  expect(await readdir(projects[104].cwd)).toEqual(["same.txt"]);
});

it.skipIf(process.platform === "win32")("preserves executable and private file modes", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "mode.txt");
  for (const mode of [0o755, 0o600]) {
    await writeFile(path, "before");
    await chmod(path, mode);
    await commands.run("write_text_file", { path, content: "after" });
    expect((await stat(path)).mode & 0o777).toBe(mode);
  }
});

it("preserves locked and unlocked worktree metadata", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  vi.mocked(hostWorktrees).mockResolvedValue({
    defaultRoot: cwd,
    worktrees: [
      { path: cwd, locked: true },
      { path: `${cwd}-other`, locked: false },
    ],
  } as never);
  expect(await commands.run("git_worktrees", { cwd })).toMatchObject({
    worktrees: [{ locked: true }, { locked: false }],
  });
});

it("blocks all working-tree stash mutations while project is busy", async () => {
  const { projects } = await setup();
  const cwd = projects[104].cwd;
  const gate = vi.fn(async () => {
    throw new Error("Project is busy");
  });
  const commands = new WorkspaceCommands(
    { projects: () => [{ id: "p", cwd }], attachmentDir: join(cwd, "attachments") } as never,
    gate,
  );
  for (const command of [
    "git_stash",
    "git_stash_action",
    "git_resolve_conflict",
    "git_pull",
    "git_sync",
  ]) {
    await expect(commands.run(command, { cwd })).rejects.toThrow("Project is busy");
  }
  expect(gate).toHaveBeenCalledTimes(5);
});

it("resolves worktrees, caches results, invalidates and still rejects outside paths", async () => {
  const { root, projects, commands } = await setup();
  const tree = join(root, "tree");
  await mkdir(tree);
  const path = join(tree, "hello.txt");
  await writeFile(path, "hello");
  vi.mocked(hostWorktrees).mockImplementation(async (cwd) => ({
    defaultRoot: cwd,
    worktrees: cwd === projects[0].cwd ? [{ path: tree, missing: false } as never] : [],
  }));
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  commands.invalidateRoots();
  await expect(commands.run("read_text_file", { path: join(root, "outside.txt") })).rejects.toThrow(
    "outside",
  );
  expect(hostWorktrees).toHaveBeenCalledTimes(210);
});

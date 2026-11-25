import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PREVIEW_SCAN_BYTES,
  WorkspaceCommands,
  type WorkspaceCommandDelivery,
} from "./workspace-commands";
import { hostWorktrees } from "../git/git-worktrees";
import * as workspace from "./workspace";
import * as gitActions from "../git/git-actions";
import * as cleanup from "../workspace-cleanup";

vi.mock("../git/git-worktrees", async (original) => ({
  ...(await original<typeof import("../git/git-worktrees")>()),
  hostWorktrees: vi.fn(),
}));
const renameHooks = vi.hoisted(() => ({
  after: undefined as undefined | (() => Promise<void>),
}));
vi.mock("../storage/rename-retry", async (original) => {
  const actual = await original<typeof import("../storage/rename-retry")>();
  return {
    ...actual,
    renameWithRetry: async (from: string, to: string) => {
      await actual.renameWithRetry(from, to);
      await renameHooks.after?.();
    },
  };
});
const roots: string[] = [];

async function managedDeliverySetup(startMutation?: WorkspaceCommandDelivery["startMutation"]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-managed-command-")));
  roots.push(root);
  const project = join(root, "project");
  const tree = join(root, "tree");
  await mkdir(project);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  git(project, "init", "-q", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.test");
  git(project, "config", "commit.gpgsign", "false");
  git(project, "commit", "-q", "--allow-empty", "-m", "base");
  git(project, "worktree", "add", "-q", "-b", "bycoda/t/test-123456789012", tree);
  const service = { review: vi.fn(), merge: vi.fn(), publish: vi.fn(), recover: vi.fn() };
  const registry = {
    list: vi.fn().mockResolvedValue([
      {
        id: "w",
        projectId: "p",
        path: tree,
        branchRef: "refs/heads/bycoda/t/test-123456789012",
      },
    ]),
  };
  vi.mocked(hostWorktrees).mockResolvedValue({
    defaultRoot: root,
    worktrees: [{ path: project }, { path: tree }],
  } as never);
  const projects = [{ id: "p", cwd: project }];
  const commands = new WorkspaceCommands(
    {
      projects: () => projects,
      attachmentDir: join(root, "attachments"),
    } as never,
    async (_id, action) => await action(),
    undefined,
    { registry, service, startMutation } as WorkspaceCommandDelivery,
  );
  return { commands, registry, service, project, tree, git, projects };
}

it("generates commit context from working changes without staging and prefers a populated index", async () => {
  const { commands, tree, git } = await managedDeliverySetup();
  const tracked = join(tree, "tracked.txt");
  await writeFile(tracked, "baseline\n");
  git(tree, "add", "tracked.txt");
  git(tree, "commit", "-qm", "track file");
  await expect(commands.run("git_staged_context", { cwd: tree })).rejects.toThrow(
    "No changes to summarize",
  );

  await writeFile(tracked, "working edit\n");
  await writeFile(join(tree, "new.txt"), "untracked content\n");
  await expect(commands.run("git_staged_context", { cwd: tree })).resolves.toMatchObject({
    summary: expect.stringContaining("Untracked files:\nnew.txt"),
    patch: expect.stringContaining("+working edit"),
  });
  expect(git(tree, "diff", "--cached", "--name-only")).toBe("");

  git(tree, "add", "tracked.txt");
  await writeFile(tracked, "later edit\n");
  const context = await commands.run("git_staged_context", { cwd: tree });
  expect(context).toMatchObject({
    summary: expect.stringContaining("tracked.txt"),
    patch: expect.stringContaining("+working edit"),
  });
  expect(context).not.toMatchObject({ patch: expect.stringContaining("later edit") });
  expect(context).not.toMatchObject({ summary: expect.stringContaining("new.txt") });
});

it("fences Git and editor writes while leaving reads available and releases admission on success or validation failure", async () => {
  const release = vi.fn(async () => {});
  const startMutation = vi
    .fn<NonNullable<WorkspaceCommandDelivery["startMutation"]>>()
    .mockRejectedValueOnce(new Error("Workspace reservation is active"))
    .mockRejectedValueOnce(new Error("Workspace reservation is active"))
    .mockResolvedValue(release);
  const { commands, tree, git } = await managedDeliverySetup(startMutation);
  const path = join(tree, "source.txt");
  await writeFile(path, "before");
  await expect(commands.run("write_text_file", { path, content: "blocked" })).rejects.toThrow(
    "Workspace reservation is active",
  );
  await expect(
    commands.run("git_stage_file", { cwd: tree, relative: "source.txt" }),
  ).rejects.toThrow("Workspace reservation is active");
  expect(await readFile(path, "utf8")).toBe("before");
  expect(git(tree, "diff", "--cached", "--name-only")).toBe("");
  await commands.run("read_text_file", { path });
  expect(startMutation).toHaveBeenCalledTimes(2);
  expect(release).not.toHaveBeenCalled();
  await commands.run("write_text_file", { path, content: "after" });
  await commands.run("git_stage_file", { cwd: tree, relative: "source.txt" });
  expect(git(tree, "diff", "--cached", "--name-only")).toBe("source.txt");
  await expect(
    commands.run("create_path", { parent: tree, name: "../outside", isDir: false }),
  ).rejects.toThrow();
  expect(release).toHaveBeenCalledTimes(3);
});

it("uses actual write destinations for admission even when input supplies an unrelated cwd", async () => {
  const release = vi.fn(async () => {});
  let destination = "";
  const startMutation = vi.fn(async (path: string) => {
    if (
      path === destination ||
      path.startsWith(`${destination}\\`) ||
      path.startsWith(`${destination}/`)
    )
      throw new Error("Destination is reserved");
    return release;
  });
  const { commands, project, tree } = await managedDeliverySetup(startMutation);
  destination = tree;
  const source = join(project, "input.txt");
  await writeFile(source, "preserved");
  const existing = join(tree, "existing.txt");
  await writeFile(existing, "unchanged");
  await expect(
    commands.run("write_text_file", { cwd: project, path: existing, content: "blocked" }),
  ).rejects.toThrow("Destination is reserved");
  expect(await readFile(existing, "utf8")).toBe("unchanged");
  for (const command of ["copy_path", "move_path"]) {
    await expect(
      commands.run(command, { cwd: project, from: source, destParent: tree }),
    ).rejects.toThrow("Destination is reserved");
  }
  expect(await readFile(source, "utf8")).toBe("preserved");
  expect(await readdir(tree)).not.toContain("input.txt");
  expect(release).toHaveBeenCalledTimes(2);
});

it("blocks legacy delivery from a managed directory even after an external branch switch", async () => {
  const { commands, project, tree, git } = await managedDeliverySetup();
  git(tree, "checkout", "-qb", "external-name");
  const head = git(project, "rev-parse", "HEAD");
  for (const command of ["git_push", "git_sync", "git_pr_create", "git_merge"])
    await expect(
      commands.run(command, {
        cwd: tree,
        reference: "main",
        confirmed: true,
        owner: { ownerId: "owner", authorizationId: "renderer-claim" },
      }),
    ).rejects.toThrow("fresh review plan");
  expect(git(project, "rev-parse", "HEAD")).toBe(head);
  expect(git(tree, "status", "--porcelain")).toBe("");
});

it("synchronizes an ordinary checkout when an unrelated registered project is missing", async () => {
  const { commands, project, tree, git, projects } = await managedDeliverySetup();
  const missing = join(project, "..", "removed-project");
  const origin = join(project, "..", "origin.git");
  projects.push({ id: "removed", cwd: missing });
  git(project, "init", "--bare", "-q", origin);
  git(project, "remote", "add", "origin", origin);
  git(project, "push", "-qu", "origin", "main");
  git(project, "commit", "-q", "--allow-empty", "-m", "local change");

  await expect(commands.run("git_sync", { cwd: tree })).rejects.toThrow("fresh review plan");
  await commands.run("git_sync", { cwd: project });

  expect(git(origin, "rev-parse", "refs/heads/main")).toBe(git(project, "rev-parse", "HEAD"));
});

it("blocks integration by source SHA after a managed directory is retired and fails closed on unknown ownership", async () => {
  const { commands, registry, project, tree, git } = await managedDeliverySetup();
  await writeFile(join(tree, "result.txt"), "result");
  git(tree, "add", "result.txt");
  git(tree, "commit", "-qm", "result");
  const source = git(tree, "rev-parse", "HEAD");
  git(project, "worktree", "remove", tree);
  const head = git(project, "rev-parse", "HEAD");
  await expect(
    commands.run("git_merge", { cwd: project, expectedTargetSha: source.slice(0, 12) }),
  ).rejects.toThrow("fresh review plan");
  expect(git(project, "rev-parse", "HEAD")).toBe(head);
  registry.list.mockRejectedValueOnce(new Error("Workspace ownership unavailable"));
  await expect(commands.run("git_push", { cwd: project })).rejects.toThrow(
    "Workspace ownership unavailable",
  );
});

it("routes reviewed session delivery to the shared service with transport authorization separate from input", async () => {
  const { commands, service } = await managedDeliverySetup();
  const review = { workspaceId: "w", expectedRevision: 4, action: "merge" } as const;
  const request = {
    workspaceId: "w",
    expectedRevision: 4,
    idempotencyKey: "delivery",
    planToken: "reviewed",
  };
  const proof = { ownerId: "owner", authorizationId: "transport-proof" };
  service.review.mockResolvedValue({ token: "reviewed" });
  service.merge.mockResolvedValue({ operationId: "merged" });
  service.publish.mockResolvedValue({ operationId: "published" });
  expect(await commands.reviewDelivery(review)).toEqual({ token: "reviewed" });
  expect(await commands.mergeDelivery(request, proof)).toEqual({ operationId: "merged" });
  expect(await commands.publishDelivery(request, proof)).toEqual({ operationId: "published" });
  expect(service.review).toHaveBeenCalledWith(review);
  expect(service.merge).toHaveBeenCalledWith(request, proof);
  expect(service.publish).toHaveBeenCalledWith(request, proof);
});

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

it.each([false, true])(
  "preserves requested case when renaming an existing leaf (folder: %s)",
  async (folder) => {
    const { projects, commands } = await setup();
    const cwd = projects[104].cwd;
    const from = join(cwd, folder ? "folder" : "file.txt");
    const name = folder ? "FOLDER" : "FILE.txt";
    if (folder) {
      await mkdir(from);
      await writeFile(join(from, "retained.txt"), "retained");
    } else await writeFile(from, "retained");
    expect(await commands.run("rename_path", { path: from, name })).toBe(
      join(cwd, name).replaceAll("\\", "/"),
    );
    const names = await readdir(cwd);
    expect(names).toContain(name);
    expect(names).not.toContain(folder ? "folder" : "file.txt");
    expect(await readFile(folder ? join(cwd, name, "retained.txt") : join(cwd, name), "utf8")).toBe(
      "retained",
    );
  },
);

it("does not mistake an existing hard-link name for a case-insensitive spelling alias", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const from = join(cwd, "source.txt");
  const target = join(cwd, "other.txt");
  await writeFile(from, "retained");
  await link(from, target);
  await expect(commands.run("rename_path", { path: from, name: "other.txt" })).rejects.toThrow(
    "already exists",
  );
  expect(await readFile(from, "utf8")).toBe("retained");
  expect(await readFile(target, "utf8")).toBe("retained");
});

it("admits a registered junction project and its worktree by physical root while rejecting escaping links", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-linked-project-")));
  roots.push(root);
  const physical = join(root, "physical");
  const registered = join(root, "registered");
  const tree = join(root, "physical-tree");
  const linkedTree = join(root, "linked-tree");
  const outside = join(root, "outside");
  const nested = join(physical, "nested");
  const linkedNested = join(root, "linked-nested");
  for (const path of [physical, tree, outside]) await mkdir(path);
  await linkFixtureWorktree(physical, tree);
  await mkdir(nested);
  await symlink(physical, registered, "junction");
  await symlink(tree, linkedTree, "junction");
  await symlink(nested, linkedNested, "junction");
  await symlink(outside, join(physical, "escape"), "junction");
  await writeFile(join(physical, "read.txt"), "project");
  await writeFile(join(outside, "private.txt"), "private");
  vi.mocked(hostWorktrees).mockResolvedValue({
    defaultRoot: registered,
    worktrees: [{ path: registered }, { path: linkedTree }],
  } as never);
  const withIdle = vi.fn(async (_id: string, action: () => Promise<unknown>) => await action());
  const commands = new WorkspaceCommands(
    {
      projects: () => [
        { id: "linked", cwd: registered },
        { id: "nested", cwd: linkedNested },
      ],
      attachmentDir: join(root, "attachments"),
    } as never,
    withIdle as never,
  );
  expect(await commands.run("read_text_file", { path: join(registered, "read.txt") })).toBe(
    "project",
  );
  await commands.run("write_text_file", { path: join(registered, "new.txt"), content: "new" });
  expect(await readFile(join(physical, "new.txt"), "utf8")).toBe("new");
  await commands.run("write_text_file", {
    path: join(linkedTree, "worktree.txt"),
    content: "tree",
  });
  expect(await readFile(join(tree, "worktree.txt"), "utf8")).toBe("tree");
  for (const path of [join(physical, "escape", "private.txt"), join(outside, "new.txt")])
    await expect(commands.run("write_text_file", { path, content: "blocked" })).rejects.toThrow(
      "Path is outside this machine’s projects",
    );
  expect(await readFile(join(outside, "private.txt"), "utf8")).toBe("private");
  await expect(commands.run("delete_path", { path: join(registered, "nested") })).rejects.toThrow(
    "Path is outside the workspace",
  );
  expect((await stat(nested)).isDirectory()).toBe(true);

  // Project-level permission/idle gates retain the registered project identity.
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: physical, windowsHide: true, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  await writeFile(join(physical, ".git", "info", "exclude"), "*\n");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "base",
  );
  await commands.run("git_create_branch", { cwd: registered, name: "linked-branch" });
  expect(withIdle).toHaveBeenCalledWith("linked", expect.any(Function));
});

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
    expect(read).toHaveBeenLastCalledWith(await realpath(cwd), false, false);
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

it("lists skills as a bare array unless the caller asks for the truncation status", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  const bare = await commands.run("list_skills", { cwd });
  expect(Array.isArray(bare)).toBe(true);
  const status = (await commands.run("list_skills", { cwd, withStatus: true })) as {
    skills: unknown[];
    truncated: boolean;
  };
  expect(status.skills).toEqual(bare);
  // The listing reads this machine's real home, so only the flag's shape is stable.
  expect(typeof status.truncated).toBe("boolean");
  await expect(commands.run("list_skills", { cwd, withStatus: "yes" })).rejects.toThrow(
    "Invalid skill list option",
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

it("lists worktrees with probed state, lock metadata and unknown state kept null", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-wt-state-")));
  roots.push(root);
  const project = join(root, "project");
  const remote = join(root, "remote.git");
  const dirtyTree = join(root, "dirty");
  const aheadTree = join(root, "ahead");
  const lockedTree = join(root, "locked");
  const goneTree = join(root, "gone");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  await mkdir(project);
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(project, "init", "-q", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.test");
  git(project, "config", "commit.gpgsign", "false");
  git(project, "commit", "-q", "--allow-empty", "-m", "base");
  git(project, "remote", "add", "origin", remote);
  git(project, "push", "-q", "origin", "main");
  for (const [name, tree] of [
    ["dirty", dirtyTree],
    ["ahead", aheadTree],
    ["locked", lockedTree],
    ["gone", goneTree],
  ])
    git(project, "worktree", "add", "-q", "-b", name, tree);
  await writeFile(join(dirtyTree, "draft.txt"), "draft");
  git(aheadTree, "commit", "-q", "--allow-empty", "-m", "local only");
  git(project, "worktree", "lock", lockedTree);
  await rm(goneTree, { recursive: true, force: true });

  const commands = new WorkspaceCommands(
    {
      projects: () => [{ id: "p", cwd: project }],
      attachmentDir: join(root, "attachments"),
    } as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  const listed = (await commands.run("git_worktrees", { cwd: project })) as {
    worktrees: {
      path: string;
      locked?: boolean;
      prunable: boolean;
      dirty: boolean | null;
      unpushed: number | null;
      sessionIds: string[];
    }[];
  };
  const norm = (path: string) => path.replaceAll("\\", "/").toLowerCase();
  const byPath = (path: string) => listed.worktrees.find((tree) => norm(tree.path) === norm(path))!;
  expect(listed.worktrees).toHaveLength(5);
  expect(byPath(project)).toMatchObject({ dirty: false, unpushed: 0, prunable: false });
  expect(byPath(dirtyTree)).toMatchObject({ dirty: true, unpushed: 0 });
  expect(byPath(aheadTree)).toMatchObject({ dirty: false, unpushed: 1 });
  expect(byPath(lockedTree)).toMatchObject({ locked: true, dirty: false });
  // A checkout Git cannot read stays unknown, never clean or zero.
  expect(byPath(goneTree)).toMatchObject({ prunable: true, dirty: null, unpushed: null });
  expect(listed.worktrees.flatMap((tree) => tree.sessionIds)).toEqual([]);
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
  const { path, other } = await worktreeFixture(root, projects);
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  commands.invalidateRoots();
  await expect(commands.run("read_text_file", { path: other })).rejects.toThrow("outside");
  expect(hostWorktrees).toHaveBeenCalledTimes(210);
});

it("revokes cached worktree writes after cleanup changes Git membership with files still present", async () => {
  const { root, projects, commands } = await setup();
  const { path } = await worktreeFixture(root, projects);
  const generation = cleanup.workspaceCleanupMembershipGeneration();
  const epoch = vi.spyOn(cleanup, "workspaceCleanupMembershipGeneration");
  try {
    await commands.run("write_text_file", { path, content: "before" });
    expect(hostWorktrees).toHaveBeenCalledTimes(105);
    await commands.run("read_text_file", { path });
    expect(hostWorktrees).toHaveBeenCalledTimes(105);
    vi.mocked(hostWorktrees).mockResolvedValue({ defaultRoot: root, worktrees: [] });
    epoch.mockReturnValue(generation + 1);
    await expect(commands.run("write_text_file", { path, content: "after" })).rejects.toThrow(
      "outside",
    );
    expect(await readFile(path, "utf8")).toBe("before");
  } finally {
    epoch.mockRestore();
  }
});

it("previews a large file with a long line and stops before a later binary line", async () => {
  const { projects, commands } = await setup();
  await mkdir(projects[0].cwd);
  const path = join(projects[0].cwd, "preview.txt");
  await writeFile(path, "skip\r\n" + "é".repeat(600_000) + "\r\nlast\n\0");
  expect(await commands.run("read_file_preview", { path, startLine: 2, maxLines: 2 })).toEqual([
    "é".repeat(199) + "…",
    "last",
  ]);
});

it("stops a preview scan at its byte bound for a huge file without line breaks", async () => {
  const { projects, commands } = await setup();
  await mkdir(projects[0].cwd);
  const path = join(projects[0].cwd, "huge.txt");
  await writeFile(path, Buffer.alloc(PREVIEW_SCAN_BYTES + 64 * 1024, "x"));
  // The first line is never finished within the bound: line 1 is cut, line 2 is never reached.
  expect(await commands.run("read_file_preview", { path, maxLines: 1 })).toEqual([
    "x".repeat(199) + "…",
  ]);
  expect(await commands.run("read_file_preview", { path, startLine: 2, maxLines: 1 })).toEqual([]);
});

it("revokes a cached path when an independent repository replaces a worktree", async () => {
  const { project, tree, commands, git } = await managedDeliverySetup();
  const path = join(tree, "source.txt");
  await writeFile(path, "original");
  await commands.run("read_text_file", { path });
  git(project, "worktree", "move", tree, tree + "-moved");
  await mkdir(tree);
  git(tree, "init", "-q");
  await writeFile(path, "new repo");
  await expect(commands.run("read_text_file", { path })).rejects.toThrow("outside");
});

it("rejects cached writes after external Git prune leaves the worktree folder behind", async () => {
  const { project, tree, commands, git } = await managedDeliverySetup();
  const path = join(tree, "source.txt");
  await writeFile(path, "before");
  await commands.run("read_text_file", { path });
  const parked = tree + "-parked";
  await rename(tree, parked);
  try {
    git(project, "worktree", "prune", "--expire=now");
  } finally {
    await rename(parked, tree);
  }
  await expect(commands.run("write_text_file", { path, content: "after" })).rejects.toThrow(
    "outside",
  );
  expect(await readFile(path, "utf8")).toBe("before");
});

/** The two Git pointers shared by a linked checkout and its owning repository. */
async function linkFixtureWorktree(project: string, tree: string) {
  const admin = join(project, ".git", "worktrees", "linked");
  await mkdir(admin, { recursive: true });
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(admin, "gitdir"), join(tree, ".git") + "\n");
  await writeFile(join(tree, ".git"), "gitdir: " + admin + "\n");
}

/** A worktree of the first project and a separate checkout. */
async function worktreeFixture(root: string, projects: { cwd: string }[]) {
  const tree = join(root, "tree");
  const checkout = join(root, "other-checkout");
  await mkdir(tree);
  await linkFixtureWorktree(projects[0].cwd, tree);
  await mkdir(join(checkout, ".git"), { recursive: true });
  const path = join(tree, "hello.txt");
  await writeFile(path, "hello");
  vi.mocked(hostWorktrees).mockImplementation(async (cwd) => ({
    defaultRoot: cwd,
    worktrees: cwd === projects[0].cwd ? [{ path: tree, missing: false } as never] : [],
  }));
  return { tree, path, other: join(checkout, "outside.txt") };
}

it("refuses a path outside every checkout without listing worktrees", async () => {
  const { root, projects, commands } = await setup();
  await worktreeFixture(root, projects);
  await expect(commands.run("read_text_file", { path: join(root, "outside.txt") })).rejects.toThrow(
    "outside",
  );
  expect(hostWorktrees).not.toHaveBeenCalled();
});

it("keeps admitting a known worktree after the rescan TTL without listing every project again", async () => {
  const { root, projects, commands } = await setup();
  const { path, other } = await worktreeFixture(root, projects);
  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start);
  try {
    await commands.run("read_text_file", { path });
    expect(hostWorktrees).toHaveBeenCalledTimes(105);
    clock.mockReturnValue(start + 60_000);
    expect(await commands.run("read_text_file", { path })).toBe("hello");
    expect(hostWorktrees).toHaveBeenCalledTimes(105);
    // An unknown path still asks every project once its lists are older than the TTL.
    await expect(commands.run("read_text_file", { path: other })).rejects.toThrow("outside");
    expect(hostWorktrees).toHaveBeenCalledTimes(210);
    clock.mockReturnValue(start + 11 * 60_000);
    await commands.run("read_text_file", { path });
    expect(hostWorktrees).toHaveBeenCalledTimes(315);
  } finally {
    clock.mockRestore();
  }
});

/** Two plain projects and an unrelated checkout holding two files, with a controllable registry. */
async function missFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-misses-")));
  roots.push(root);
  const projects = [join(root, "project-a"), join(root, "project-b")].map((cwd) => ({ cwd }));
  const checkout = join(root, "checkout");
  for (const folder of [...projects.map((project) => project.cwd), checkout]) await mkdir(folder);
  await linkFixtureWorktree(projects[0].cwd, checkout);
  await writeFile(join(checkout, "a.txt"), "a");
  await writeFile(join(checkout, "b.txt"), "b");
  const store = { projects: () => projects, projectRegistryVersion: 0, attachmentDir: root };
  const commands = new WorkspaceCommands(
    store as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  const listing = (...paths: string[]) =>
    vi.mocked(hostWorktrees).mockImplementation(async (cwd) => ({
      defaultRoot: cwd,
      worktrees: paths.map((path) => ({ path, missing: false }) as never),
    }));
  const read = (name: string) => commands.run("read_text_file", { path: join(checkout, name) });
  return { commands, store, projects, checkout, listing, read };
}

it("scans once for sibling paths denied inside one checkout, and rescans after the TTL", async () => {
  const { listing, read, checkout } = await missFixture();
  listing();
  const wall = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const mono = vi.spyOn(performance, "now").mockReturnValue(5_000);
  try {
    await expect(read("a.txt")).rejects.toThrow("outside");
    expect(hostWorktrees).toHaveBeenCalledTimes(2);
    await expect(read("b.txt")).rejects.toThrow("outside");
    await expect(read("a.txt")).rejects.toThrow("outside");
    expect(hostWorktrees).toHaveBeenCalledTimes(2);
    // A worktree created outside this Host shows up once the denial expires.
    listing(checkout);
    wall.mockReturnValue(1_000_000 + 11_000);
    mono.mockReturnValue(5_000 + 11_000);
    expect(await read("b.txt")).toBe("b");
    expect(hostWorktrees).toHaveBeenCalledTimes(4);
  } finally {
    wall.mockRestore();
    mono.mockRestore();
  }
});

it("admits a newly registered project immediately despite a remembered denial", async () => {
  const { listing, read, store, projects, checkout } = await missFixture();
  listing();
  await expect(read("a.txt")).rejects.toThrow("outside");
  expect(hostWorktrees).toHaveBeenCalledTimes(2);
  projects.push({ cwd: checkout });
  store.projectRegistryVersion++;
  expect(await read("a.txt")).toBe("a");
  expect(hostWorktrees).toHaveBeenCalledTimes(2);
});

it("never remembers a denial from a failed worktree listing", async () => {
  const { listing, read, checkout } = await missFixture();
  const wall = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  try {
    vi.mocked(hostWorktrees).mockRejectedValue(new Error("git failed"));
    await expect(read("a.txt")).rejects.toThrow("outside");
    // Within the listing cache the failed entry is reused, still without proving a denial.
    await expect(read("b.txt")).rejects.toThrow("outside");
    listing(checkout);
    wall.mockReturnValue(1_000_000 + 6_000);
    expect(await read("a.txt")).toBe("a");
  } finally {
    wall.mockRestore();
  }
});

it("neither admits from nor remembers a scan that raced invalidateRoots", async () => {
  const { commands, listing, read, checkout } = await missFixture();
  let invalidate = true;
  vi.mocked(hostWorktrees).mockImplementation(async (cwd) => {
    if (invalidate) commands.invalidateRoots();
    return { defaultRoot: cwd, worktrees: [{ path: checkout, missing: false } as never] };
  });
  await expect(read("a.txt")).rejects.toThrow("outside");
  // The scan and its single retry were both stale; nothing was admitted or remembered.
  invalidate = false;
  listing(checkout);
  expect(await read("a.txt")).toBe("a");
});

it("retries once against current roots when invalidateRoots races a scan", async () => {
  const { commands, read, checkout } = await missFixture();
  let first = true;
  vi.mocked(hostWorktrees).mockImplementation(async (cwd) => {
    const stale = first;
    first = false;
    if (stale) commands.invalidateRoots();
    // The stale scan still lists a root that has since been removed.
    return {
      defaultRoot: cwd,
      worktrees: stale ? [{ path: checkout, missing: false } as never] : [],
    };
  });
  await expect(read("a.txt")).rejects.toThrow("outside");
  expect(hostWorktrees).toHaveBeenCalledTimes(4);
});

it("refuses a versioned save over a file changed since it was read and chains saves", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "doc.txt");
  await writeFile(path, "base");
  const read = async () =>
    (await commands.run("read_text_file", { path, withVersion: true })) as {
      text: string;
      version: string;
    };
  const save = async (content: string, baseVersion?: string) =>
    (await commands.run("write_text_file", { path, content, baseVersion })) as { version: string };
  // A plain read keeps its string result.
  expect(await commands.run("read_text_file", { path })).toBe("base");
  const first = await read();
  const second = await read();
  expect(second).toEqual(first);
  // Two editors on one version: the first save wins, the second is refused and writes nothing.
  const saved = await save("first", first.version);
  await expect(save("second", second.version)).rejects.toMatchObject({ code: "FILE_CHANGED" });
  expect(await readFile(path, "utf8")).toBe("first");
  // The returned version chains the next save and matches a fresh read.
  expect((await read()).version).toBe(saved.version);
  const chained = await save("third", saved.version);
  await save("fourth", chained.version);
  expect(await readFile(path, "utf8")).toBe("fourth");
});

it("detects an external change between the versioned read and the save", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "doc.txt");
  await writeFile(path, "base");
  const { version } = (await commands.run("read_text_file", { path, withVersion: true })) as {
    version: string;
  };
  await writeFile(path, "agent edit!");
  await expect(
    commands.run("write_text_file", { path, content: "mine", baseVersion: version }),
  ).rejects.toThrow("FILE_CHANGED");
  expect(await readFile(path, "utf8")).toBe("agent edit!");
  await rm(path);
  await expect(
    commands.run("write_text_file", { path, content: "mine", baseVersion: version }),
  ).rejects.toThrow("FILE_CHANGED");
  expect((await readdir(projects[104].cwd)).length).toBe(0);
});

it("still overwrites without a baseVersion", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "doc.txt");
  await writeFile(path, "base");
  await writeFile(path, "agent edit!");
  await commands.run("write_text_file", { path, content: "old client" });
  expect(await readFile(path, "utf8")).toBe("old client");
});

it("does not report a version for a file replaced right after the rename", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "doc.txt");
  await writeFile(path, "base");
  renameHooks.after = async () => {
    renameHooks.after = undefined;
    await rm(path);
    await writeFile(path, "external edit after rename");
  };
  await expect(commands.run("write_text_file", { path, content: "mine" })).rejects.toThrow(
    "FILE_CHANGED",
  );
});

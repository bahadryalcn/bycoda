import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { createManagedWorkspaceRegistry } from "./managed-workspaces";
import { createWorkspaceCreationProgress } from "./workspace-creation-progress";
import { createCreationRun } from "./workspace-creation";
import { createWorkspacePolicyResolver } from "../workspaces/workspace-policy";
import {
  createExtraWorktree,
  deleteStaleFetchRefs,
  invalidateHostWorktrees,
  removeSiblingWorktree,
  rollbackExtraWorktree,
  siblingBlocker,
} from "../git/git-worktrees";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
  invalidateHostWorktrees();
});

const gitAt = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function makeRepo(parent: string, name: string, commit = true) {
  const dir = join(parent, name);
  mkdirSync(dir);
  gitAt(dir, "init", "-q", "-b", "main");
  gitAt(dir, "config", "user.name", "Test");
  gitAt(dir, "config", "user.email", "test@example.com");
  gitAt(dir, "config", "core.autocrlf", "false");
  gitAt(dir, "config", "commit.gpgsign", "false");
  if (commit) {
    writeFileSync(join(dir, "source.txt"), `${name}\n`);
    gitAt(dir, "add", ".");
    gitAt(dir, "commit", "-qm", "baseline");
  }
  return dir;
}

async function fixture(options: Parameters<typeof createManagedWorkspaceRegistry>[2] = {}) {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-creation-test-")));
  const cwd = makeRepo(parent, "repo");
  const store = new HostStore(join(parent, "host.db"));
  await store.ready;
  const project = await store.addProject(cwd, "Repo");
  const progress = createWorkspaceCreationProgress();
  const policy = createWorkspacePolicyResolver(store, { hostPolicy: { root: join(parent, "wt") } });
  const registry = createManagedWorkspaceRegistry(store, policy, {
    creationProgress: progress,
    ...options,
  });
  cleanup.push(async () => {
    await store.close();
    if (!parent.startsWith(join(realpathSync.native(tmpdir()), "bycoda-creation-test-")))
      throw new Error("Unsafe test cleanup");
    rmSync(parent, { recursive: true, force: true });
  });
  const request = {
    projectId: project.id,
    environmentId: "local",
    owner: { kind: "session" as const, id: "session-a" },
    slug: "work",
    idempotencyKey: "create-a",
    choice: { defaultMode: "worktree" as const },
  };
  return { parent, cwd, store, project, progress, policy, registry, request };
}

const branches = (cwd: string) => gitAt(cwd, "branch", "--list", "by/*");

it("creates a sibling worktree per extra repository on the primary's branch and replays them", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({
    ...f.request,
    repositories: [extra],
    progressId: "p1",
  });
  const branch = result.workspace.branchRef.replace("refs/heads/", "");
  expect(result.baseSource).toBe("local");
  const path = result.extraWorktrees?.[extra];
  expect(path).toBeTruthy();
  expect(gitAt(path!, "symbolic-ref", "--short", "HEAD")).toBe(branch);
  expect(gitAt(path!, "rev-parse", "HEAD")).toBe(gitAt(extra, "rev-parse", "main"));
  expect(gitAt(extra, "config", `branch.${branch}.bycodaWorkspace`)).toBe(
    `sibling:${result.workspace.id}`,
  );
  expect(f.progress.get("p1")).toMatchObject({
    phase: "done",
    stages: [
      { id: "fetch", status: "skipped" },
      { id: "checkout", status: "done", percent: 100 },
      { id: "submodules", status: "skipped" },
      { id: "setup", status: "skipped" },
      { id: "agent", status: "pending" },
    ],
  });
  const replay = await f.registry.prepare({ ...f.request, repositories: [extra] });
  expect(replay.workspace.id).toBe(result.workspace.id);
  expect(replay.extraWorktrees).toEqual(result.extraWorktrees);
});

it("rejects invalid repository lists before creating anything", async () => {
  const f = await fixture();
  const plain = join(f.parent, "plain");
  mkdirSync(plain);
  const nested = join(f.cwd, "nested");
  mkdirSync(nested);
  gitAt(nested, "init", "-q", "-b", "main");
  const extras = Array.from({ length: 9 }, (_, index) => join(f.parent, `r${index}`));
  for (const repositories of [["relative/dir"], [plain], [nested], [f.cwd], extras])
    await expect(f.registry.prepare({ ...f.request, repositories })).rejects.toThrow();
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(existsSync(join(f.parent, "wt"))).toBe(false);
});

it("leaves nothing behind when a later repository fails, and a retry starts fresh", async () => {
  const f = await fixture();
  const good = makeRepo(f.parent, "good");
  const empty = makeRepo(f.parent, "empty", false);
  await expect(f.registry.prepare({ ...f.request, repositories: [good, empty] })).rejects.toThrow(
    "no commit",
  );
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(readdirSync(join(f.parent, "wt"))).toEqual([]);
  expect(branches(f.cwd)).toBe("");
  expect(branches(good)).toBe("");
  expect(gitAt(f.cwd, "for-each-ref", "refs/bycoda/")).toBe("");
  expect(gitAt(good, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  // The same idempotency key retries as a new creation once the second repository is usable.
  writeFileSync(join(empty, "a.txt"), "a\n");
  gitAt(empty, "add", ".");
  gitAt(empty, "commit", "-qm", "first");
  const retried = await f.registry.prepare({ ...f.request, repositories: [good, empty] });
  expect(Object.keys(retried.extraWorktrees ?? {})).toEqual([good, empty]);
});

it("cancel after checkout removes every worktree it made and marks the progress cancelled", async () => {
  let cancelOnComplete = false;
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const save = f.store.saveWorkspaceOperation.bind(f.store);
  vi.spyOn(f.store, "saveWorkspaceOperation").mockImplementation(async (op, phase) => {
    await save(op, phase);
    if (cancelOnComplete && op.phase === "complete") f.progress.cancel("p-cancel");
  });
  cancelOnComplete = true;
  await expect(
    f.registry.prepare({ ...f.request, repositories: [extra], progressId: "p-cancel" }),
  ).rejects.toThrow("cancelled");
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(readdirSync(join(f.parent, "wt"))).toEqual([]);
  expect(branches(f.cwd)).toBe("");
  expect(branches(extra)).toBe("");
  expect(f.progress.get("p-cancel").phase).toBe("cancelled");
  cancelOnComplete = false;
  const retried = await f.registry.prepare({ ...f.request, repositories: [extra] });
  expect(existsSync(retried.workspace.path)).toBe(true);
});

it("cancel before git runs rolls the registered creation back", async () => {
  const f = await fixture({
    beforeMaterialize: async () => {
      f.progress.cancel("p-early");
    },
  });
  await expect(f.registry.prepare({ ...f.request, progressId: "p-early" })).rejects.toThrow(
    "cancelled",
  );
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(branches(f.cwd)).toBe("");
});

it("falls back to the local base when there is no upstream or the remote branch is gone", async () => {
  const f = await fixture();
  const none = await f.registry.prepare({ ...f.request, baseFromRemote: true });
  expect(none.baseSource).toBe("local");
  const origin = join(f.parent, "origin.git");
  gitAt(f.parent, "init", "-q", "--bare", "-b", "main", origin);
  gitAt(f.cwd, "remote", "add", "origin", origin);
  gitAt(f.cwd, "config", "branch.main.remote", "origin");
  gitAt(f.cwd, "config", "branch.main.merge", "refs/heads/gone");
  const gone = await f.registry.prepare({
    ...f.request,
    owner: { kind: "session", id: "session-b" },
    idempotencyKey: "create-b",
    baseFromRemote: true,
  });
  expect(gone.baseSource).toBe("local");
});

it("starts from the fetched remote commit and fails visibly when the fetch fails", async () => {
  const f = await fixture();
  const origin = join(f.parent, "origin.git");
  gitAt(f.parent, "init", "-q", "--bare", "-b", "main", origin);
  gitAt(f.cwd, "remote", "add", "origin", origin);
  gitAt(f.cwd, "push", "-q", "-u", "origin", "main");
  const other = join(f.parent, "other");
  gitAt(f.parent, "clone", "-q", origin, other);
  gitAt(other, "config", "user.name", "Test");
  gitAt(other, "config", "user.email", "test@example.com");
  writeFileSync(join(other, "remote.txt"), "ahead\n");
  gitAt(other, "add", ".");
  gitAt(other, "commit", "-qm", "ahead");
  gitAt(other, "push", "-q", "origin", "main");
  const remoteTip = gitAt(other, "rev-parse", "HEAD");
  const localTip = gitAt(f.cwd, "rev-parse", "main");
  const result = await f.registry.prepare({ ...f.request, baseFromRemote: true, progressId: "r1" });
  expect(result.baseSource).toBe("remote");
  expect(result.workspace.baseCommit).toBe(remoteTip);
  expect(gitAt(result.workspace.path, "rev-parse", "HEAD")).toBe(remoteTip);
  expect(gitAt(f.cwd, "rev-parse", "main")).toBe(localTip);
  expect(f.progress.get("r1").stages[0]).toMatchObject({ id: "fetch", status: "done" });
  // The fetch lands in a private ref that is gone again, not in repository-global FETCH_HEAD.
  expect(gitAt(f.cwd, "for-each-ref", "refs/bycoda/fetch")).toBe("");

  gitAt(f.cwd, "remote", "set-url", "origin", join(f.parent, "missing.git"));
  await expect(
    f.registry.prepare({
      ...f.request,
      owner: { kind: "session", id: "session-b" },
      idempotencyKey: "create-b",
      baseFromRemote: true,
      progressId: "r2",
    }),
  ).rejects.toThrow("Could not fetch");
  expect(await f.store.managedWorkspaces({ ownerId: "session-b" })).toEqual([]);
  expect(f.progress.get("r2").phase).toBe("failed");
});

it("accepts the maximum of eight extra repositories besides the primary", async () => {
  const f = await fixture();
  const extras = Array.from({ length: 8 }, (_, index) => makeRepo(f.parent, `r${index}`));
  const result = await f.registry.prepare({ ...f.request, repositories: extras });
  expect(Object.keys(result.extraWorktrees ?? {}).sort()).toEqual([...extras].sort());
});

it("renames the primary and every extra-repository worktree and reports the new revision", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  const sibling = result.extraWorktrees![extra];
  const renamed = await f.registry.renameBranch({
    workspaceId: result.workspace.id,
    expectedRevision: result.workspace.revision,
    fragment: "Fix login",
    idempotencyKey: "rename-a",
  });
  expect(renamed).toEqual({
    branchRef: "refs/heads/by/fix-login",
    renamed: true,
    revision: result.workspace.revision + 1,
  });
  expect(gitAt(result.workspace.path, "symbolic-ref", "--short", "HEAD")).toBe("by/fix-login");
  expect(gitAt(sibling, "symbolic-ref", "--short", "HEAD")).toBe("by/fix-login");
  expect(gitAt(extra, "config", "branch.by/fix-login.bycodaWorkspace")).toBe(
    `sibling:${result.workspace.id}`,
  );
});

it("durably journals siblings so startup recovery removes them when the result was never saved", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const save = f.store.saveWorkspaceReceipt.bind(f.store);
  let crash = true;
  vi.spyOn(f.store, "saveWorkspaceReceipt").mockImplementation(async (scope, ...rest) => {
    // Simulates the Host dying right after the sibling exists, before the result is recorded.
    if (crash && scope === "workspace.prepare.result") throw new Error("host crashed");
    return save(scope, ...rest);
  });
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow(
    "host crashed",
  );
  const [workspace] = await f.store.managedWorkspaces();
  const branch = workspace.branchRef.replace("refs/heads/", "");
  expect(branches(extra)).toContain(branch);
  const [operation] = (await f.store.workspaceOperations(workspace.id)).filter(
    (candidate) => candidate.kind === "create",
  );
  expect(operation.id).toBeTruthy();
  await f.registry.recoverSiblings();
  expect(await f.store.uncommittedSiblingOperations()).toEqual([]);
  expect(branches(extra)).toBe("");
  expect(gitAt(extra, "worktree", "list", "--porcelain").split("worktree ").length).toBe(2);
  expect(existsSync(workspace.path)).toBe(true);
  crash = false;
  const retried = await f.registry.prepare({ ...f.request, repositories: [extra] });
  expect(retried.workspace.id).toBe(workspace.id);
  expect(existsSync(retried.extraWorktrees![extra])).toBe(true);
});

it("lists a workspace's committed siblings and removes one safely, keeping its branch", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  const siblings = await f.store.workspaceSiblings({
    workspaceId: result.workspace.id,
    committedOnly: true,
  });
  expect(siblings).toMatchObject([
    {
      repository: extra,
      path: result.extraWorktrees![extra],
      branch: result.workspace.branchRef.replace("refs/heads/", ""),
    },
  ]);
  const [sibling] = siblings;
  writeFileSync(join(sibling.path, "dirty.txt"), "uncommitted\n");
  expect(await siblingBlocker(sibling)).toContain("uncommitted");
  await expect(removeSiblingWorktree(sibling)).rejects.toThrow("uncommitted");
  expect(existsSync(sibling.path)).toBe(true);
  rmSync(join(sibling.path, "dirty.txt"));
  gitAt(extra, "worktree", "lock", sibling.path);
  expect(await siblingBlocker(sibling)).toContain("locked");
  gitAt(extra, "worktree", "unlock", sibling.path);
  await removeSiblingWorktree(sibling);
  expect(existsSync(sibling.path)).toBe(false);
  expect(branches(extra)).toContain(sibling.branch);
  await removeSiblingWorktree(sibling);
  expect(await siblingBlocker(sibling)).toBeNull();
});

it("keeps one journal row per sibling path and clears it on rollback", async () => {
  const f = await fixture();
  const row = { operationId: "op", workspaceId: "ws", repository: "/r", path: "/p", branch: "b" };
  for (let index = 0; index < 20; index++) await f.store.saveWorkspaceSibling(row);
  expect(await f.store.workspaceSiblings({ operationId: "op" })).toHaveLength(1);
  await f.store.deleteWorkspaceSibling("op", "/p");
  expect(await f.store.workspaceSiblings({ operationId: "op" })).toEqual([]);

  const good = makeRepo(f.parent, "good");
  const empty = makeRepo(f.parent, "empty", false);
  await expect(f.registry.prepare({ ...f.request, repositories: [good, empty] })).rejects.toThrow(
    "no commit",
  );
  expect(await f.store.uncommittedSiblingOperations()).toEqual([]);
});

it("recovers a killed checkout: a locked half-made sibling is replaced, an unjournaled one refused", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const path = join(f.parent, "wt-extra");
  const base = gitAt(extra, "rev-parse", "HEAD");
  const record = { repository: extra, path, branch: "by/12345678", base };
  gitAt(extra, "worktree", "add", "-b", record.branch, path);
  // What a killed `worktree add` leaves: a locked registration.
  gitAt(extra, "worktree", "lock", "--reason", "initializing", path);
  await expect(createExtraWorktree({ ...record, base, journal: [] })).rejects.toThrow(
    "already registered",
  );
  await createExtraWorktree({ ...record, base, journal: [record] });
  expect(gitAt(extra, "worktree", "list", "--porcelain")).not.toContain("locked");
  expect(gitAt(path, "symbolic-ref", "--short", "HEAD")).toBe(record.branch);
  expect(gitAt(path, "status", "--porcelain")).toBe("");
  // Rollback of a locked sibling needs the double force.
  gitAt(extra, "worktree", "lock", "--reason", "initializing", path);
  await rollbackExtraWorktree(record);
  expect(existsSync(path)).toBe(false);
  expect(branches(extra)).toBe("");
});

it("marks the primary and siblings again on a retry", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  const branch = result.workspace.branchRef.replace("refs/heads/", "");
  gitAt(f.cwd, "config", "--unset", `branch.${branch}.bycodaWorkspace`);
  gitAt(extra, "config", "--unset", `branch.${branch}.bycodaWorkspace`);
  await f.registry.prepare({ ...f.request, repositories: [extra] });
  expect(gitAt(f.cwd, "config", `branch.${branch}.bycodaWorkspace`)).toBe(result.workspace.id);
  expect(gitAt(extra, "config", `branch.${branch}.bycodaWorkspace`)).toBe(
    `sibling:${result.workspace.id}`,
  );
});

it("a retry that fails definitively removes the primary an earlier attempt left, so the owner can start over", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const save = f.store.saveWorkspaceReceipt.bind(f.store);
  let crash = true;
  vi.spyOn(f.store, "saveWorkspaceReceipt").mockImplementation(async (scope, ...rest) => {
    if (crash && scope === "workspace.prepare.result") throw new Error("host crashed");
    return save(scope, ...rest);
  });
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow(
    "host crashed",
  );
  crash = false;
  const [workspace] = await f.store.managedWorkspaces();
  const branch = workspace.branchRef.replace("refs/heads/", "");
  await f.registry.recoverSiblings();
  // The sibling's branch name is now taken by someone else: the retry cannot succeed.
  gitAt(extra, "branch", branch);
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow(
    "already exists",
  );
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(branches(f.cwd)).toBe("");
  expect(existsSync(workspace.path)).toBe(false);
  gitAt(extra, "branch", "-D", branch);
  const fresh = await f.registry.prepare({
    ...f.request,
    idempotencyKey: "create-new",
    repositories: [extra],
  });
  expect(existsSync(fresh.workspace.path)).toBe(true);
});

it("a cancel that arrives after the success claim loses; one before it wins", async () => {
  const f = await fixture();
  const save = f.store.saveWorkspaceReceipt.bind(f.store);
  vi.spyOn(f.store, "saveWorkspaceReceipt").mockImplementation(async (scope, ...rest) => {
    // Past the last cancel check, at the moment the result is recorded.
    if (scope === "workspace.prepare.result") f.progress.cancel("late");
    return save(scope, ...rest);
  });
  const result = await f.registry.prepare({ ...f.request, progressId: "late" });
  expect(existsSync(result.workspace.path)).toBe(true);
  expect(f.progress.get("late").phase).toBe("done");

  const registry = createWorkspaceCreationProgress();
  registry.create("race");
  expect(registry.cancel("race").phase).toBe("cancelled");
  expect(registry.complete("race")).toBe(false);
  registry.create("race-2");
  expect(registry.complete("race-2")).toBe(true);
  expect(registry.cancel("race-2").phase).toBe("done");
});

it("binds a progress id to the device that started it", () => {
  const registry = createWorkspaceCreationProgress();
  registry.bindOwner("p", "device-a");
  registry.create("p");
  expect(() => registry.get("p", "device-b")).toThrow("not found");
  expect(() => registry.cancel("p", "device-b")).toThrow("not found");
  expect(() => registry.bindOwner("p", "device-b")).toThrow("in use");
  expect(registry.get("p", "device-a").phase).toBe("running");
  expect(registry.cancel("p", "device-a").phase).toBe("cancelled");
});

it("reports checkout progress as structured repository fields", () => {
  const registry = createWorkspaceCreationProgress();
  const run = createCreationRun(registry, "structured");
  run.total = 3;
  run.checkout(0, 100);
  expect(registry.get("structured").stages.find((stage) => stage.id === "checkout")).toEqual({
    id: "checkout",
    status: "running",
    percent: 33,
    repositoryIndex: 2,
    repositoryCount: 3,
  });
});

it("recovers siblings with one indexed query, not a receipt probe per completed creation", async () => {
  const f = await fixture();
  await f.registry.prepare({ ...f.request });
  const probe = vi.spyOn(f.store, "workspaceReceipt");
  await f.registry.recoverSiblings();
  expect(probe).not.toHaveBeenCalled();
});

it("an owner's own turn does not block the first-turn rename, a foreign activity does", async () => {
  let foreign = false;
  const f = await fixture({
    isActive: async () => true,
    isActiveForRename: async () => foreign,
  });
  const result = await f.registry.prepare({ ...f.request });
  foreign = true;
  await expect(
    f.registry.renameBranch({
      workspaceId: result.workspace.id,
      expectedRevision: result.workspace.revision,
      fragment: "first",
      idempotencyKey: "r1",
    }),
  ).rejects.toThrow("idle");
  foreign = false;
  // The revision from prepare is stale after heartbeats; the rename still applies.
  await f.store.updateManagedWorkspace(
    { ...result.workspace, revision: result.workspace.revision + 1 },
    result.workspace.revision,
  );
  expect(
    await f.registry.renameBranch({
      workspaceId: result.workspace.id,
      expectedRevision: result.workspace.revision,
      fragment: "first",
      idempotencyKey: "r2",
    }),
  ).toMatchObject({ branchRef: "refs/heads/by/first", renamed: true });
  // A later prepare retry reports the current branch, not the frozen receipt.
  const replay = await f.registry.prepare({ ...f.request });
  expect(replay.workspace.branchRef).toBe("refs/heads/by/first");
});

it("rollback never destroys work: a dirty worktree or a moved branch is kept", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const path = join(f.parent, "wt-extra");
  const base = gitAt(extra, "rev-parse", "HEAD");
  const record = { repository: extra, path, branch: "by/12345678", base };
  await createExtraWorktree({ ...record, journal: [] });
  writeFileSync(join(path, "work.txt"), "mine\n");
  await expect(rollbackExtraWorktree(record)).rejects.toThrow("uncommitted");
  expect(existsSync(join(path, "work.txt"))).toBe(true);
  rmSync(join(path, "work.txt"));
  writeFileSync(join(path, "commit.txt"), "c\n");
  gitAt(path, "add", ".");
  gitAt(path, "commit", "-qm", "moved");
  await rollbackExtraWorktree(record);
  expect(existsSync(path)).toBe(false);
  // The branch moved off its creation commit: it holds a commit and stays.
  expect(branches(extra)).toContain("by/12345678");
});

it("journal rows of a reported creation are never loaded as rollback candidates", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  const [operation] = (await f.store.workspaceOperations(result.workspace.id)).filter(
    (candidate) => candidate.kind === "create",
  );
  expect(await f.store.workspaceSiblings({ operationId: operation.id })).toEqual([]);
  expect(await f.store.hasCommittedSiblings(operation.id)).toBe(true);
  // A replay that fails after the result exists leaves everything in place.
  vi.spyOn(f.store, "workspaceReceipt");
  await f.registry.prepare({ ...f.request, repositories: [extra] });
  expect(existsSync(result.workspace.path)).toBe(true);
  expect(existsSync(result.extraWorktrees![extra])).toBe(true);
});

it("a retry's rollback keeps a primary that holds uncommitted work", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const save = f.store.saveWorkspaceReceipt.bind(f.store);
  let crash = true;
  vi.spyOn(f.store, "saveWorkspaceReceipt").mockImplementation(async (scope, ...rest) => {
    if (crash && scope === "workspace.prepare.result") throw new Error("host crashed");
    return save(scope, ...rest);
  });
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow(
    "host crashed",
  );
  crash = false;
  const [workspace] = await f.store.managedWorkspaces();
  const branch = workspace.branchRef.replace("refs/heads/", "");
  await f.registry.recoverSiblings();
  writeFileSync(join(workspace.path, "user.txt"), "work\n");
  gitAt(extra, "branch", branch);
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow(
    "cleanup is incomplete",
  );
  expect(existsSync(join(workspace.path, "user.txt"))).toBe(true);
  expect(await f.store.managedWorkspace(workspace.id)).not.toBeNull();
});

it("boot recovery never throws: a vanished sibling repository drops its row, a broken rename stays pending", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const save = f.store.saveWorkspaceReceipt.bind(f.store);
  vi.spyOn(f.store, "saveWorkspaceReceipt").mockImplementation(async (scope, ...rest) => {
    if (scope === "workspace.prepare.result") throw new Error("host crashed");
    return save(scope, ...rest);
  });
  await expect(f.registry.prepare({ ...f.request, repositories: [extra] })).rejects.toThrow();
  rmSync(extra, { recursive: true, force: true });
  await expect(f.registry.recoverSiblings()).resolves.toBeUndefined();
  expect(await f.store.uncommittedSiblingOperations()).toEqual([]);
  const [workspace] = await f.store.managedWorkspaces();
  await f.store.saveWorkspaceBranchRename(workspace.id, "by/gone-a", "by/gone-b");
  await expect(f.registry.recoverBranchRenames()).resolves.toBeUndefined();
});

it("rename follows into the sibling rows so the workspace stays removable", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  await f.registry.renameBranch({
    workspaceId: result.workspace.id,
    expectedRevision: 0,
    fragment: "rows",
    idempotencyKey: "rn",
  });
  const [sibling] = await f.store.workspaceSiblings({
    workspaceId: result.workspace.id,
    committedOnly: true,
  });
  expect(sibling.branch).toBe("by/rows");
  expect(await siblingBlocker(sibling)).toBeNull();
});

it("a revision bumped during the rename does not fail the registry write", async () => {
  let bumped = false;
  const f = await fixture({
    isActiveForRename: async () => {
      if (!bumped) {
        bumped = true;
        const current = (await f.store.managedWorkspaces())[0];
        await f.store.updateManagedWorkspace(
          { ...current, revision: current.revision + 1 },
          current.revision,
        );
      }
      return false;
    },
  });
  const result = await f.registry.prepare({ ...f.request });
  const renamed = await f.registry.renameBranch({
    workspaceId: result.workspace.id,
    expectedRevision: 0,
    fragment: "bump",
    idempotencyKey: "rb",
  });
  expect(renamed).toMatchObject({ branchRef: "refs/heads/by/bump", renamed: true });
  expect((await f.store.managedWorkspace(result.workspace.id))?.branchRef).toBe(
    "refs/heads/by/bump",
  );
  expect(await f.store.pendingWorkspaceBranchRenames()).toEqual([]);
});

it("a rename that fails in a sibling reverts from the real Git state and fails closed on unreadable config", async () => {
  const f = await fixture();
  const extra = makeRepo(f.parent, "extra");
  const result = await f.registry.prepare({ ...f.request, repositories: [extra] });
  const old = result.workspace.branchRef.replace("refs/heads/", "");
  // A stale lock makes the sibling's `branch -m` fail after the primary already moved.
  const lock = join(extra, ".git", "refs", "heads", "by", "locked.lock");
  mkdirSync(join(extra, ".git", "refs", "heads", "by"), { recursive: true });
  writeFileSync(lock, "");
  await expect(
    f.registry.renameBranch({
      workspaceId: result.workspace.id,
      expectedRevision: 0,
      fragment: "locked",
      idempotencyKey: "rl",
    }),
  ).rejects.toThrow();
  expect(gitAt(result.workspace.path, "symbolic-ref", "--short", "HEAD")).toBe(old);
  expect(gitAt(result.extraWorktrees![extra], "symbolic-ref", "--short", "HEAD")).toBe(old);
  expect(await f.store.pendingWorkspaceBranchRenames()).toEqual([]);
  rmSync(lock);
  // Unreadable sibling config: no one can tell whether an upstream exists, so nothing is renamed.
  const config = join(extra, ".git", "config");
  const original = readFileSync(config, "utf8");
  writeFileSync(config, `${original}\n[broken\n`);
  await expect(
    f.registry.renameBranch({
      workspaceId: result.workspace.id,
      expectedRevision: 0,
      fragment: "fine",
      idempotencyKey: "rf",
    }),
  ).rejects.toThrow();
  writeFileSync(config, original);
  expect(gitAt(result.workspace.path, "symbolic-ref", "--short", "HEAD")).toBe(old);
});

it("crossed multi-repository creations do not deadlock on each other's gates", async () => {
  const f = await fixture();
  const other = makeRepo(f.parent, "other");
  const otherProject = await f.store.addProject(other, "Other");
  const [a, b] = await Promise.all([
    f.registry.prepare({ ...f.request, repositories: [other] }),
    f.registry.prepare({
      ...f.request,
      projectId: otherProject.id,
      owner: { kind: "session", id: "session-b" },
      idempotencyKey: "create-b",
      repositories: [f.cwd],
    }),
  ]);
  expect(existsSync(a.workspace.path)).toBe(true);
  expect(existsSync(b.workspace.path)).toBe(true);
});

it("deletes stale fetch landing refs", async () => {
  const f = await fixture();
  gitAt(f.cwd, "update-ref", "refs/bycoda/fetch/stale", gitAt(f.cwd, "rev-parse", "HEAD"));
  await deleteStaleFetchRefs(f.cwd);
  expect(gitAt(f.cwd, "for-each-ref", "refs/bycoda/fetch")).toBe("");
});

it("progress ids nobody bound are unreachable for a client", async () => {
  const f = await fixture();
  await f.registry.prepare({ ...f.request, progressId: "unbound" });
  expect(() => f.progress.get("unbound", "device-a")).toThrow("not found");
  expect(() => f.progress.cancel("unbound", "device-a")).toThrow("not found");
  expect(f.progress.get("unbound").phase).toBe("done");
});

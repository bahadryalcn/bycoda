import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostStore } from "./store";
import { createManagedWorkspaceRegistry } from "./managed-workspaces";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import { createExecutionActivityReservations } from "./workspace-cleanup";
import { hostGitRepositoryKey } from "./git-mutations";
import { GitTurnHistory, gitText, turnGit } from "./turn-git-history";
import { createManagedNativeTurns } from "./managed-native-turns";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { ownerId: "device-one", authorizationId: "trusted" };
const secondOwner = { ownerId: "device-two", authorizationId: "trusted" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "managed-native-turns-"));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  await mkdir(repo);
  await turnGit(repo, ["init", "-b", "main"]);
  await turnGit(repo, ["config", "user.name", "Test"]);
  await turnGit(repo, ["config", "user.email", "test@example.test"]);
  await writeFile(join(repo, "source.txt"), "baseline\n");
  await turnGit(repo, ["add", "."]);
  await turnGit(repo, ["commit", "-m", "baseline"]);
  const db = join(root, "host.db");
  const compose = async () => {
    const store = new HostStore(db);
    cleanups.push(() => store.close());
    await store.ready;
    const policy = createWorkspacePolicyResolver(store, {
      hostPolicy: { root: join(root, "worktrees") },
    });
    const registry = createManagedWorkspaceRegistry(store, policy);
    const workspace = async (id: string) => {
      const value = await registry.get({ workspaceId: id });
      if (
        !value ||
        (await hostGitRepositoryKey(value.path)) !== value.repositoryId ||
        (await gitText(value.path, ["symbolic-ref", "HEAD"])) !== value.branchRef
      )
        throw new Error("Managed workspace identity changed");
      const project = await store.project(value.projectId);
      const registered = (await gitText(project.cwd, ["worktree", "list", "--porcelain", "-z"]))
        .split("\0\0")
        .some(
          (record) =>
            record
              .split("\0")
              .some(
                (line) =>
                  line.startsWith("worktree ") &&
                  resolve(line.slice(9)).toLowerCase() === resolve(value.path).toLowerCase(),
              ) && record.split("\0").includes(`branch ${value.branchRef}`),
        );
      if (!registered) throw new Error("Managed worktree is not registered");
      return value;
    };
    const activity = createExecutionActivityReservations({
      get: workspace,
      probe: async () => [],
      pending: async (id) =>
        (await registry.listOperations(id)).some((op) => op.phase !== "complete"),
      persistence: store.workspaceActivityPersistence(),
      operation: (id) => registry.getOperation(id),
    });
    const history = new GitTurnHistory({ root: join(root, "private-history"), workspace });
    let writable = true;
    const native = createManagedNativeTurns({
      workspace,
      history,
      activity,
      assertWritable: async () => {
        if (!writable) throw new Error("Workspace recovery pending");
      },
      authorize: async (value) =>
        [owner.ownerId, secondOwner.ownerId].includes(value.ownerId) &&
        value.authorizationId === "trusted",
    });
    return {
      store,
      registry,
      activity,
      history,
      native,
      block: () => {
        writable = false;
      },
    };
  };
  const graph = await compose();
  const project = await graph.store.addProject(repo, "Native project");
  const { workspace } = await graph.registry.prepare({
    projectId: project.id,
    environmentId: graph.store.environmentId,
    owner: { kind: "session", id: "native-session" },
    slug: "Native session",
    idempotencyKey: "native-workspace",
    choice: { defaultMode: "worktree" },
  });
  return {
    ...graph,
    root,
    repo,
    workspace,
    compose,
    request: {
      workspaceId: workspace.id,
      sessionId: "native-session",
      userBlockId: "user-one",
      runId: "run-one",
      conversationRevision: 1,
    },
  };
}

it("captures real native turn commits with durable owner binding and idempotent before/end receipts", async () => {
  const f = await fixture();
  const first = await f.native.begin(f.request, owner);
  expect(first.before.status).toBe("complete");
  const binding = await readFile(
    join(f.root, "private-history", "native-turns", f.workspace.id, "user-one.json"),
    "utf8",
  );
  expect(binding).not.toContain(owner.ownerId);
  expect(binding).not.toContain(owner.authorizationId);
  expect(JSON.parse(binding).ownerFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const pending = await f.native.status(f.request, owner);
  expect(pending.activity?.ownerId).toMatch(/^native-turn:[a-f0-9]{64}$/);
  expect(await f.native.begin(f.request, owner)).toEqual(first);
  expect(await f.activity.list(f.workspace.id)).toHaveLength(1);
  await writeFile(join(f.workspace.path, "source.txt"), "native implementation\n");
  await turnGit(f.workspace.path, ["add", "."]);
  await turnGit(f.workspace.path, ["commit", "-m", "native turn implementation"]);
  const ended = await f.native.end(f.request, owner);
  expect(ended.after?.status).toBe("complete");
  if (ended.after?.status !== "complete") throw new Error("Missing after snapshot");
  expect(ended.after.snapshot.head).toBe(await gitText(f.workspace.path, ["rev-parse", "HEAD"]));
  expect(await f.activity.list(f.workspace.id)).toEqual([]);
  expect(await f.native.end(f.request, owner)).toEqual(ended);
  expect(await f.native.begin(f.request, owner)).toEqual(ended);
  const laterWriter = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "shell",
    ownerId: "later-turn-shell",
  });
  expect(await f.native.end(f.request, owner)).toEqual(ended);
  expect(await f.native.begin(f.request, owner)).toEqual(ended);
  expect((await f.activity.list(f.workspace.id)).map((value) => value.id)).toEqual([
    laterWriter.id,
  ]);
  await f.activity.stop(laterWriter.id);
  await f.store.close();
  const reopened = await f.compose();
  expect(await reopened.native.status(f.request, owner)).toEqual({ record: ended, activity: null });
  await expect(reopened.native.end(f.request, secondOwner)).rejects.toThrow("another owner device");
}, 120_000);

it("rejects untrusted ownership, another writer and changed accepted turn identities", async () => {
  const f = await fixture();
  await expect(f.native.begin(f.request, { ...owner, authorizationId: "forged" })).rejects.toThrow(
    "authenticated owner",
  );
  await expect(f.native.begin({ ...f.request, sessionId: "other-session" }, owner)).rejects.toThrow(
    "does not own",
  );
  const shell = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "shell",
    ownerId: "another-writer",
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  await f.activity.stop(shell.id);
  const start = f.activity.start.bind(f.activity);
  let racedActivity: string | undefined;
  const startSpy = vi.spyOn(f.activity, "start").mockImplementation(async (input) => {
    const accepted = await start(input);
    racedActivity = (
      await start({ workspaceId: f.workspace.id, kind: "shell", ownerId: "racing-shell" })
    ).id;
    return accepted;
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  startSpy.mockRestore();
  expect((await f.activity.list(f.workspace.id)).map((value) => value.id)).toEqual([racedActivity]);
  await f.activity.stop(racedActivity!);
  await f.native.begin(f.request, owner);
  await expect(f.native.begin(f.request, secondOwner)).rejects.toThrow("another owner device");
  await expect(f.native.begin({ ...f.request, conversationRevision: 2 }, owner)).rejects.toThrow(
    "revision changed",
  );
  await expect(f.native.end({ ...f.request, runId: "other-run" }, owner)).rejects.toThrow(
    "identity changed",
  );
  await expect(f.native.status(f.request, secondOwner)).rejects.toThrow("another owner device");
  f.block();
  await expect(f.native.end(f.request, owner)).rejects.toThrow("recovery pending");
  expect((await f.native.status(f.request, owner)).activity).not.toBeNull();
}, 120_000);

it("retains failed after-capture activity and resumes the same durable marker after host reconstruction", async () => {
  const f = await fixture();
  await f.native.begin(f.request, owner);
  const firstActivity = (await f.native.status(f.request, owner)).activity!;
  await writeFile(join(f.workspace.path, "source.txt"), "finished native changes\n");
  vi.spyOn(f.history, "capture").mockRejectedValueOnce(
    new Error("temporary after capture failure"),
  );
  await expect(f.native.end(f.request, owner)).rejects.toThrow("temporary after capture failure");
  expect((await f.native.status(f.request, owner)).activity?.id).toBe(firstActivity.id);
  await f.store.close();
  const reopened = await f.compose();
  expect((await reopened.native.status(f.request, owner)).activity?.id).toBe(firstActivity.id);
  expect((await reopened.native.end(f.request, owner)).after?.status).toBe("complete");
  expect(await reopened.activity.list(f.workspace.id)).toEqual([]);
}, 120_000);

it("does not authorize execution after failed before capture and permits an explicit capture retry", async () => {
  const f = await fixture();
  vi.spyOn(f.history, "capture").mockRejectedValueOnce(
    new Error("temporary before capture failure"),
  );
  await expect(f.native.begin(f.request, owner)).rejects.toThrow(
    "temporary before capture failure",
  );
  expect(await f.activity.list(f.workspace.id)).toEqual([]);
  expect((await f.native.begin(f.request, owner)).before.status).toBe("complete");
  const marker = (await f.native.status(f.request, owner)).activity!;
  await f.activity.stop(marker.id);
  await expect(f.native.end(f.request, owner)).rejects.toThrow("activity is missing");
}, 120_000);

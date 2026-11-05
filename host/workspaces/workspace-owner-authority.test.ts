import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { HostStore } from "../store";
import { createManagedWorkspaceRegistry } from "../managed/managed-workspaces";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import { guardedRemoveWorkspace } from "../workspace-cleanup";
import { withHostGitMutation } from "../git/git-mutations";
import * as gitMutations from "../git/git-mutations";
import type { ManagedWorkspace } from "./workspace-contracts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-workspace-authority-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "repo"),
    managedRoot = join(root, "managed"),
    path = join(managedRoot, "checkout");
  await mkdir(cwd);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "retained.txt"), "preserve");
  await exec("git", ["init", "-q", "-b", "main"], { cwd, windowsHide: true });
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  const project = await store.addProject(cwd, "Fixture");
  const workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: join(cwd, ".git"),
    projectId: project.id,
    environmentId: "local",
    owner: { kind: "task", id: "task" },
    path,
    branchRef: "refs/heads/fixture",
    baseRef: "refs/heads/main",
    baseCommit: "0".repeat(40),
    targetBranchRef: "refs/heads/main",
    state: "finished",
    directoryState: "present",
    revision: 1,
    pinned: false,
    lastActivityAt: 1,
    finishedAt: 1,
  };
  await store.insertManagedWorkspace(workspace);
  return { root, cwd, managedRoot, path, workspace, store };
}
it("checks current request and owner proof again after the actual repository mutex", async () => {
  const f = await fixture();
  let allowed = true;
  const registry = createManagedWorkspaceRegistry(f.store, createWorkspacePolicyResolver(f.store), {
    authorizeOwner: async () => allowed,
  });
  const entered = gate(),
    release = gate();
  const blocker = withHostGitMutation(f.cwd, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const queued = gate();
  const serialize = gitMutations.withHostGitMutation;
  vi.spyOn(gitMutations, "withHostGitMutation").mockImplementation((...args) => {
    queued.resolve();
    return serialize(...args);
  });
  const pending = f.store.db.withAuthorization(
    async () => allowed,
    () =>
      registry.pin(
        { workspaceId: "workspace", expectedRevision: 1, idempotencyKey: "pin", pinned: true },
        { ownerId: "owner", authorizationId: "trusted" },
      ),
  );
  const rejected = expect(pending).rejects.toThrow();
  await queued.promise;
  allowed = false;
  release.resolve();
  await blocker;
  await rejected;
  expect((await f.store.managedWorkspace("workspace"))?.revision).toBe(1);
});
it("blocks direct workspace storage mutation even inside an inherited SQL owner", async () => {
  const f = await fixture();
  let allowed = true;
  await expect(
    f.store.db.withAuthorization(
      async () => allowed,
      () =>
        f.store.db.scope(async () => {
          allowed = false;
          await f.store.updateManagedWorkspace({ ...f.workspace, revision: 2, pinned: true }, 1);
        }),
    ),
  ).rejects.toThrow();
  expect((await f.store.managedWorkspace("workspace"))?.pinned).toBe(false);
});
it("revocation after removal discovery leaves the actual source intact", async () => {
  const f = await fixture();
  let allowed = true;
  await expect(
    guardedRemoveWorkspace({
      projectCwd: f.cwd,
      managedRoot: f.managedRoot,
      path: f.path,
      branchRef: f.workspace.branchRef,
      archiveRoot: join(f.root, "archive"),
      operationId: "remove",
      inUse: async () => {
        allowed = false;
        return false;
      },
      assertAuthorized: async () => {
        if (!allowed) throw new Error("revoked");
      },
    }),
  ).rejects.toThrow("revoked");
  expect(await readFile(join(f.path, "retained.txt"), "utf8")).toBe("preserve");
});
it("rechecks removal after its Git mutex wait", async () => {
  const f = await fixture();
  const entered = gate(),
    release = gate();
  let allowed = true;
  const blocker = withHostGitMutation(f.cwd, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const pending = guardedRemoveWorkspace({
    projectCwd: f.cwd,
    managedRoot: f.managedRoot,
    path: f.path,
    branchRef: f.workspace.branchRef,
    archiveRoot: join(f.root, "archive"),
    operationId: "remove",
    inUse: () => false,
    assertAuthorized: async () => {
      if (!allowed) throw new Error("revoked");
    },
  });
  const rejected = expect(pending).rejects.toThrow("revoked");
  allowed = false;
  release.resolve();
  await blocker;
  await rejected;
  expect(await readFile(join(f.path, "retained.txt"), "utf8")).toBe("preserve");
});

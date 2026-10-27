import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { createWorkspacePolicyResolver, projectRepositoryIdentity } from "./workspace-policy";
import { DEFAULT_WORKSPACE_POLICY, type WorkspacePolicyOverride } from "./workspace-contracts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { ownerId: "owner", authorizationId: "trusted-transport-proof" };
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-policy-")),
    repository = join(directory, "project");
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repository, windowsHide: true, stdio: "pipe" })
      .toString()
      .trim();
  git("init", "-b", "main");
  git("config", "user.name", "Policy tests");
  git("config", "user.email", "policy@example.invalid");
  writeFileSync(join(repository, "source.txt"), "committed");
  git("add", ".");
  git("commit", "-m", "baseline");
  const sibling = join(directory, "sibling");
  git("worktree", "add", "-b", "sibling", sibling);
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await store.addProject(repository, "Project"),
    other = await store.addProject(sibling, "Sibling");
  return { store, project, other, directory };
}

describe("project workspace policy", () => {
  it("defaults coding work to the current checkout, retaining active directories forever", async () => {
    const { store, project } = await fixture();
    expect(
      await createWorkspacePolicyResolver(store).get({
        projectId: project.id,
        environmentId: "host",
      }),
    ).toEqual({
      revision: 0,
      resolved: { policy: DEFAULT_WORKSPACE_POLICY, appliedScopes: ["host"] },
    });
    expect(DEFAULT_WORKSPACE_POLICY.defaultMode).toBe("current");
  });
  it("shares canonical project policy across sibling worktrees and merges nested owner choices", async () => {
    const { store, project, other, directory } = await fixture();
    expect(await projectRepositoryIdentity(store, project.id)).toBe(
      await projectRepositoryIdentity(store, other.id),
    );
    const service = createWorkspacePolicyResolver(store, {
      hostPolicy: { disk: { budgetBytes: 5000 }, retention: { idle: 1000 } },
    });
    await service.update(
      {
        projectId: project.id,
        environmentId: "host",
        expectedRevision: 0,
        idempotencyKey: "policy-1",
        policy: {
          defaultMode: "worktree",
          root: join(directory, "managed"),
          disk: { warningRatio: 0.5 },
          retention: { finished: "never" },
        },
      },
      owner,
    );
    const resolved = await service.resolve({
      projectId: other.id,
      environmentId: "host",
      choice: { defaultMode: "current", disk: { minimumFreeBytes: 100 } },
    });
    expect(resolved.appliedScopes).toEqual(["host", "project", "owner"]);
    expect(resolved.policy.defaultMode).toBe("current");
    expect(resolved.policy.retention).toEqual({
      ...DEFAULT_WORKSPACE_POLICY.retention,
      idle: 1000,
      finished: "never",
    });
    expect(resolved.policy.disk).toEqual({
      budgetBytes: 5000,
      warningRatio: 0.5,
      minimumFreeBytes: 100,
    });
    expect(
      (await service.get({ projectId: other.id, environmentId: "different-host" })).revision,
    ).toBe(0);
    expect(
      (await service.resolve({ projectId: project.id, environmentId: "host" })).policy.defaultMode,
    ).toBe("worktree");
  });
  it("resolves policy for plain folders without requiring a Git repository", async () => {
    const { store, directory } = await fixture();
    const folder = join(directory, "plain-folder");
    mkdirSync(folder);
    const project = await store.addProject(folder, "Plain folder");
    const service = createWorkspacePolicyResolver(store);
    expect(
      (await service.resolve({ projectId: project.id, environmentId: "host" })).policy.defaultMode,
    ).toBe("current");
    await service.update(
      {
        projectId: project.id,
        environmentId: "host",
        expectedRevision: 0,
        idempotencyKey: "plain-worktree",
        policy: { defaultMode: "worktree" },
      },
      owner,
    );
    expect(
      (await service.resolve({ projectId: project.id, environmentId: "host" })).policy.defaultMode,
    ).toBe("worktree");
    expect(
      (
        await service.resolve({
          projectId: project.id,
          environmentId: "host",
          choice: { defaultMode: "current" },
        })
      ).policy.defaultMode,
    ).toBe("current");
  });
  it("persists idempotent receipts, rejects changed payloads and stale revisions, and replaces overrides", async () => {
    const { store, project } = await fixture(),
      service = createWorkspacePolicyResolver(store);
    const request = {
      projectId: project.id,
      environmentId: "host",
      expectedRevision: 0,
      idempotencyKey: "replace",
      policy: { pinned: true },
    };
    const response = await service.update(request, owner);
    expect(await createWorkspacePolicyResolver(store).update(request, owner)).toEqual(response);
    await expect(
      service.update({ ...request, policy: { pinned: false } }, owner),
    ).rejects.toMatchObject({ code: "WORKSPACE_IDEMPOTENCY_CONFLICT" });
    await expect(
      service.update({ ...request, idempotencyKey: "stale" }, owner),
    ).rejects.toMatchObject({ code: "WORKSPACE_POLICY_REVISION_CONFLICT" });
    const replacement = await service.update(
      { ...request, expectedRevision: 1, idempotencyKey: "clear", policy: {} },
      owner,
    );
    expect(replacement.revision).toBe(2);
    expect(replacement.resolved.policy.pinned).toBe(false);
  });
  it("serializes concurrent writers against the same project revision", async () => {
    const { store, project } = await fixture(),
      service = createWorkspacePolicyResolver(store);
    const results = await Promise.allSettled(
      ["one", "two"].map((idempotencyKey) =>
        service.update(
          {
            projectId: project.id,
            environmentId: "host",
            expectedRevision: 0,
            idempotencyKey,
            policy: { pinned: true },
          },
          owner,
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it.each([
    { retention: { active: 1000 } },
    { retention: { idle: -1 } },
    { retention: { merged: Infinity } },
    { disk: { warningRatio: 2 } },
    { disk: { budgetBytes: NaN } },
    { root: "relative/path" },
    { integrationBranchRef: "refs/heads/../main" },
    { integrationBranchRef: "refs/heads/topic.lock" },
    { defaultMode: "fallback" },
    { retention: { unknown: "never" } },
  ])("rejects unsafe overrides %j", async (policy) => {
    const { store, project } = await fixture();
    await expect(
      createWorkspacePolicyResolver(store).update(
        {
          projectId: project.id,
          environmentId: "host",
          expectedRevision: 0,
          idempotencyKey: "invalid",
          policy: policy as WorkspacePolicyOverride,
        },
        owner,
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_POLICY_INVALID" });
  });
  it("requires trusted owner authorization before mutation", async () => {
    const { store, project } = await fixture();
    await expect(
      createWorkspacePolicyResolver(store).update(
        {
          projectId: project.id,
          environmentId: "host",
          expectedRevision: 0,
          idempotencyKey: "unauthorized",
          policy: {},
        },
        { ownerId: "", authorizationId: "" },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_OWNER_REQUIRED" });
  });
});

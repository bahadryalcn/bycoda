import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { createWorkspaceFeatureClaims } from "./feature-claims";
import { projectRepositoryIdentity } from "./workspace-policy";
import type { ManagedWorkspace } from "./workspace-contracts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-claims-")),
    repository = join(directory, "project");
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repository, windowsHide: true, stdio: "pipe" })
      .toString()
      .trim();
  git("init", "-b", "main");
  git("config", "user.name", "Claim tests");
  git("config", "user.email", "claim@example.invalid");
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
  const repositoryId = await projectRepositoryIdentity(store, project.id);
  const make = (id: string, projectId: string): ManagedWorkspace => ({
    id,
    projectId,
    repositoryId,
    environmentId: "host",
    owner: { kind: "session", id: `session-${id}` },
    path: join(directory, `wt-${id}`),
    branchRef: `refs/heads/bycoda/s/test-${id}`,
    baseRef: "refs/heads/main",
    baseCommit: git("rev-parse", "HEAD"),
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 0,
    lastActivityAt: 1,
    pinned: false,
  });
  const first = make("first", project.id),
    second = make("second", other.id);
  await store.insertManagedWorkspace(first);
  await store.insertManagedWorkspace(second);
  return { store, project, other, first, second, service: createWorkspaceFeatureClaims(store) };
}
const mutation = (workspaceId: string, key = "acquire", revision = 0) => ({
  workspaceId,
  idempotencyKey: key,
  expectedRevision: revision,
});

describe("live feature claims", () => {
  it("returns an existing claim to a competing sibling workspace and lists canonical project claims", async () => {
    const { store, service, first, second, other } = await fixture();
    const request = { ...mutation(first.id), featureKey: "editor" },
      result = await service.acquire(request);
    expect(result.acquired).toBe(true);
    expect(await service.acquire(request)).toEqual(result);
    const competing = await service.acquire({ ...mutation(second.id), featureKey: "editor" });
    expect(competing).toEqual({
      acquired: false,
      conflicts: result.acquired ? [result.claim] : [],
    });
    expect(await service.list({ projectId: other.id })).toEqual(
      result.acquired ? [result.claim] : [],
    );
    expect((await store.managedWorkspace(first.id))?.revision).toBe(1);
    expect((await store.managedWorkspace(second.id))?.revision).toBe(0);
    await expect(service.acquire({ ...request, featureKey: "different" })).rejects.toMatchObject({
      code: "WORKSPACE_IDEMPOTENCY_CONFLICT",
    });
  });
  it("atomically grants only one of two concurrent unscoped writers", async () => {
    const { service, first, second } = await fixture();
    const results = await Promise.all(
      [first, second].map((value) =>
        service.acquire({ ...mutation(value.id), featureKey: "settings" }),
      ),
    );
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.filter((result) => !result.acquired)).toHaveLength(1);
  });
  it("permits explicit independent subscopes and blocks overlapping or whole-feature claims", async () => {
    const { service, first, second } = await fixture();
    expect(
      (
        await service.acquire({
          ...mutation(first.id),
          featureKey: "settings",
          scope: "desktop/editor",
        })
      ).acquired,
    ).toBe(true);
    expect(
      (await service.acquire({ ...mutation(second.id), featureKey: "settings", scope: "mobile" }))
        .acquired,
    ).toBe(true);
    expect(
      (
        await service.acquire({
          ...mutation(second.id, "overlap", 1),
          featureKey: "settings",
          scope: "desktop",
        })
      ).acquired,
    ).toBe(false);
    expect(
      (await service.acquire({ ...mutation(second.id, "whole", 1), featureKey: "settings" }))
        .acquired,
    ).toBe(false);
  });
  it("only releases the selected workspace's claim and preserves duplicate receipts", async () => {
    const { service, first, second, project } = await fixture();
    const result = await service.acquire({ ...mutation(first.id), featureKey: "composer" });
    if (!result.acquired) throw new Error("Expected acquisition");
    expect(
      await service.release({ ...mutation(second.id, "foreign"), claimId: result.claim.id }),
    ).toEqual({ released: false });
    expect(await service.list({ projectId: project.id })).toHaveLength(1);
    const release = { ...mutation(first.id, "release", 1), claimId: result.claim.id };
    expect(await service.release(release)).toEqual({ released: true });
    expect(await service.release(release)).toEqual({ released: true });
    expect(await service.list({ projectId: project.id })).toHaveLength(0);
    expect(
      (await service.acquire({ ...mutation(second.id, "take-over"), featureKey: "composer" }))
        .acquired,
    ).toBe(true);
  });
  it("rejects stale workspace revisions and closed owners", async () => {
    const { store, service, first } = await fixture();
    await store.updateManagedWorkspace({ ...first, state: "abandoned", revision: 1 }, 0);
    await expect(
      service.acquire({ ...mutation(first.id), featureKey: "editor" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT" });
    await expect(
      service.acquire({ ...mutation(first.id, "closed", 1), featureKey: "editor" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CLOSED" });
  });
  it("fences claim writes while a durable operation requires recovery", async () => {
    const { store, service, first } = await fixture();
    const acquired = await service.acquire({ ...mutation(first.id), featureKey: "editor" });
    if (!acquired.acquired) throw new Error("Expected acquisition");
    const plannedWorkspace = (await store.managedWorkspace(first.id))!;
    await store.saveWorkspaceOperation(
      {
        id: "blocked-create",
        kind: "create",
        workspaceId: first.id,
        idempotencyKey: "create",
        expectedRevision: 0,
        phase: "blocked",
        resumePhase: "materialized",
        createdAt: 1,
        updatedAt: 2,
        plannedWorkspace,
      },
      null,
    );
    await expect(
      service.acquire({ ...mutation(first.id, "new", 1), featureKey: "other" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_RECOVERY_REQUIRED" });
    await expect(
      service.release({ ...mutation(first.id, "release", 1), claimId: acquired.claim.id }),
    ).rejects.toMatchObject({ code: "WORKSPACE_RECOVERY_REQUIRED" });
    expect(await service.acquire({ ...mutation(first.id), featureKey: "editor" })).toEqual(
      acquired,
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_POLICY,
  type ManagedWorkspace,
  type WorkspaceCleanupPlan,
  type WorkspacePolicy,
} from "./workspace-contracts";
import type { WorkspaceRemovalService } from "./workspace-service-contracts";
import {
  createWorkspaceRetentionScheduler,
  evaluateWorkspaceStorage,
  measureWorkspaceStorage,
  WORKSPACE_RETENTION_INTERVAL_MS,
  workspaceRetentionEligibility,
  workspaceStorageWarning,
} from "./workspace-retention";

const day = 86_400_000;
const now = 30 * day;
const workspace = (changes: Partial<ManagedWorkspace> = {}): ManagedWorkspace => ({
  id: "workspace",
  repositoryId: "repo",
  projectId: "project",
  environmentId: "local",
  owner: { kind: "session", id: "owner" },
  path: "/managed/wt-workspace",
  branchRef: "refs/heads/bycoda/s/test-123456789012",
  baseRef: "refs/heads/main",
  baseCommit: "abc",
  targetBranchRef: "refs/heads/main",
  state: "idle",
  directoryState: "present",
  revision: 1,
  lastActivityAt: 0,
  pinned: false,
  ...changes,
});
const policy = (): WorkspacePolicy => structuredClone(DEFAULT_WORKSPACE_POLICY);
function schedulerFixture(initial = workspace()) {
  let current = initial;
  const plan = vi.fn<WorkspaceRemovalService["plan"]>(
    async () =>
      ({
        token: "token",
        expiresAt: now + 60_000,
        workspaceId: current.id,
        expectedRevision: current.revision,
        path: current.path,
        branchRef: current.branchRef,
        head: "abc",
        statusFingerprint: "fingerprint",
        dirty: false,
        preservationRequired: false,
        blockers: [],
        links: [],
      }) satisfies WorkspaceCleanupPlan,
  );
  const apply = vi.fn<WorkspaceRemovalService["apply"]>(async () => ({
    operationId: "removal",
    workspaceId: current.id,
    directoryState: "removed" as const,
    workspaceRevision: current.revision + 1,
    retainedBranchRef: current.branchRef,
    recoveryIds: [],
  }));
  const activePolicy = policy();
  const scheduler = createWorkspaceRetentionScheduler({
    list: async () => [current],
    get: async () => structuredClone(current),
    policy: async () => activePolicy,
    removal: { plan, apply },
    now: () => now,
  });
  return {
    scheduler,
    plan,
    apply,
    policy: activePolicy,
    set: (value: ManagedWorkspace) => {
      current = value;
    },
  };
}

describe("retention eligibility", () => {
  it.each([
    ["idle", 14],
    ["finished", 7],
    ["merged", 1],
    ["abandoned", 7],
  ] as const)("uses %s lifecycle duration and extends it on meaningful activity", (state, days) => {
    const value = workspace({ state, finishedAt: 0, mergedAt: 0, closedAt: 0 });
    expect(workspaceRetentionEligibility(value, policy(), days * day - 1).eligible).toBe(false);
    expect(workspaceRetentionEligibility(value, policy(), days * day).eligible).toBe(true);
    expect(
      workspaceRetentionEligibility({ ...value, lastActivityAt: 2 * day }, policy(), days * day)
        .eligible,
    ).toBe(false);
    expect(value.state).toBe(state);
  });
  it("honors Never, pins and active work even after long inactivity", () => {
    const settings = policy();
    settings.retention.idle = "never";
    expect(workspaceRetentionEligibility(workspace(), settings, now).eligible).toBe(false);
    expect(workspaceRetentionEligibility(workspace({ pinned: true }), policy(), now).eligible).toBe(
      false,
    );
    expect(
      workspaceRetentionEligibility(workspace({ state: "active" }), policy(), now).eligible,
    ).toBe(false);
    const pinnedPolicy = policy();
    pinnedPolicy.pinned = true;
    expect(workspaceRetentionEligibility(workspace(), pinnedPolicy, now).eligible).toBe(false);
  });
  it("blocks missing lifecycle timestamps and invalid periods", () => {
    expect(
      workspaceRetentionEligibility(workspace({ state: "finished" }), policy(), now).eligible,
    ).toBe(false);
    const settings = policy();
    settings.retention.idle = Number.NaN;
    expect(workspaceRetentionEligibility(workspace(), settings, now).eligible).toBe(false);
  });
});

describe("retention scheduler", () => {
  afterEach(() => vi.useRealTimers());
  it("runs startup, lifecycle and hourly cleanup without changing lifecycle", async () => {
    vi.useFakeTimers();
    const fixture = schedulerFixture();
    expect((await fixture.scheduler.start())?.removed).toEqual(["workspace"]);
    await fixture.scheduler.onLifecycle("workspace");
    await vi.advanceTimersByTimeAsync(WORKSPACE_RETENTION_INTERVAL_MS);
    expect(fixture.apply).toHaveBeenCalledTimes(3);
    expect(fixture.apply.mock.calls[0]?.[1]).toEqual({ kind: "retentionScheduler" });
    fixture.scheduler.stop();
    await vi.advanceTimersByTimeAsync(WORKSPACE_RETENTION_INTERVAL_MS);
    expect(fixture.apply).toHaveBeenCalledTimes(3);
  });
  it("keeps dirty and unknown status without treating pressure as deletion authority", async () => {
    const fixture = schedulerFixture();
    fixture.plan.mockImplementationOnce(async () => ({
      token: "t",
      expiresAt: now + day,
      workspaceId: "workspace",
      expectedRevision: 1,
      path: "path",
      branchRef: "branch",
      head: "head",
      statusFingerprint: "dirty",
      dirty: true,
      preservationRequired: true,
      blockers: [],
      links: [],
    }));
    expect((await fixture.scheduler.run({ trigger: "startup" })).blocked[0]?.reason).toBe(
      "Cleanup blocked: uncommitted changes",
    );
    fixture.plan.mockRejectedValueOnce(new Error("Git status unknown"));
    expect((await fixture.scheduler.run({ trigger: "hourly" })).blocked[0]?.reason).toBe(
      "Git status unknown",
    );
    expect(fixture.apply).not.toHaveBeenCalled();
    fixture.policy.retention.idle = "never";
    await fixture.scheduler.run({ trigger: "hourly" });
    expect(fixture.plan).toHaveBeenCalledTimes(2);
  });
  it("rechecks policy and revision immediately before applying", async () => {
    const fixture = schedulerFixture();
    const original = fixture.plan.getMockImplementation()!;
    fixture.plan.mockImplementationOnce(async () => {
      const result = await original({ workspaceId: "workspace", expectedRevision: 1 });
      fixture.set(workspace({ revision: 2, pinned: true }));
      return result;
    });
    const result = await fixture.scheduler.run({ trigger: "lifecycle" });
    expect(result.blocked[0]?.reason).toBe("Workspace changed during cleanup planning");
    expect(fixture.apply).not.toHaveBeenCalled();
  });
  it("disk pressure cannot shorten retention or authorize cleanup with unknown storage", async () => {
    const fixture = schedulerFixture(workspace({ lastActivityAt: now }));
    const pressured = evaluateWorkspaceStorage("root", {
      materializedBytes: 60 * 1024 ** 3,
      sharedCacheBytes: null,
      recoveryBytes: null,
      freeBytes: 10 * 1024 ** 3,
    });
    expect(pressured.materialization).toBe("paused");
    expect((await fixture.scheduler.onStoragePressure()).removed).toEqual([]);
    expect(fixture.plan).not.toHaveBeenCalled();
    fixture.set(workspace());
    fixture.policy.retention.idle = "never";
    await fixture.scheduler.onStoragePressure();
    expect(fixture.apply).not.toHaveBeenCalled();
    const unknown = evaluateWorkspaceStorage("root", {
      materializedBytes: null,
      freeBytes: null,
      sharedCacheBytes: null,
      recoveryBytes: null,
    });
    expect(unknown.materialization).toBe("unknown");
    expect(unknown.materializedBytes).toBeNull();
    expect(unknown.requiredFreeBytes).toBeNull();
  });
  it("reports a lifecycle inventory failure without rejecting the transition hook", async () => {
    const failure = new Error("Registry unavailable");
    const onError = vi.fn();
    const fixture = schedulerFixture();
    const scheduler = createWorkspaceRetentionScheduler({
      list: async () => [],
      get: async () => {
        throw failure;
      },
      policy: async () => policy(),
      removal: { plan: fixture.plan, apply: fixture.apply },
      onError,
    });
    await expect(scheduler.onLifecycle("workspace")).resolves.toEqual({
      removed: [],
      blocked: [{ workspaceId: "workspace", reason: "Registry unavailable" }],
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });
  it("offers clean finished/merged quick deletion before age expiry with owner authority", async () => {
    const fixture = schedulerFixture(
      workspace({ state: "finished", finishedAt: now, lastActivityAt: now }),
    );
    const authority = { ownerId: "owner", authorizationId: "confirmed" };
    await fixture.scheduler.run({ trigger: "lifecycle" });
    expect(fixture.apply).not.toHaveBeenCalled();
    await fixture.scheduler.quickDelete("workspace", authority);
    expect(fixture.apply.mock.calls[0]?.[1]).toEqual(authority);
    fixture.set(workspace());
    await expect(fixture.scheduler.quickDelete("workspace", authority)).rejects.toThrow(
      "finished or merged",
    );
  });
});

describe("storage policy", () => {
  it("warns at 80 percent, pauses at the budget/free-space floor and preserves unknowns", () => {
    const measure = {
      materializedBytes: 40 * 1024 ** 3,
      sharedCacheBytes: 5,
      recoveryBytes: 6,
      freeBytes: 30 * 1024 ** 3,
    };
    const status = evaluateWorkspaceStorage("root", measure);
    expect(status.budgetBytes).toBe(50 * 1024 ** 3);
    expect(status.materialization).toBe("allowed");
    expect(workspaceStorageWarning(status)).toBe(true);
    const budget = evaluateWorkspaceStorage("root", {
      ...measure,
      materializedBytes: 55 * 1024 ** 3,
    });
    expect(budget.materialization).toBe("paused");
    expect(budget.requiredFreeBytes).toBe(5 * 1024 ** 3);
    const free = evaluateWorkspaceStorage("root", { ...measure, freeBytes: 19 * 1024 ** 3 });
    expect(free.materialization).toBe("paused");
    expect(free.requiredFreeBytes).toBe(1024 ** 3);
    const unknown = evaluateWorkspaceStorage("root", { ...measure, materializedBytes: null });
    expect(unknown.materialization).toBe("unknown");
    expect(unknown.requiredFreeBytes).toBeNull();
    expect(workspaceStorageWarning(unknown)).toBeNull();
  });
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  it.each([false, true])(
    "measures files and hardlinks without following dependency links (linked ancestor: %s)",
    async (linkedAncestor) => {
      const root = mkdtempSync(join(tmpdir(), "workspace-storage-"));
      roots.push(root);
      const actual = join(root, "actual");
      mkdirSync(actual);
      const ancestor = linkedAncestor ? join(root, "alias") : actual;
      if (linkedAncestor)
        symlinkSync(actual, ancestor, process.platform === "win32" ? "junction" : "dir");
      const managed = join(ancestor, "managed");
      const first = join(managed, "first");
      const second = join(managed, "second");
      const cache = join(root, "cache");
      const recovery = join(root, "recovery");
      const sentinel = join(root, "sentinel");
      for (const path of [first, second, cache, recovery, sentinel])
        mkdirSync(path, { recursive: true });
      writeFileSync(join(cache, "dependency"), "dependency");
      linkSync(join(cache, "dependency"), join(first, "dependency"));
      writeFileSync(join(first, "source"), "source");
      linkSync(join(first, "source"), join(second, "source"));
      writeFileSync(join(recovery, "rescue"), "rescue");
      writeFileSync(join(sentinel, "outside"), "external source must not count");
      symlinkSync(
        sentinel,
        join(first, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const status = await measureWorkspaceStorage({
        root: managed,
        workspaces: [
          { path: realpathSync(first), directoryState: "present" },
          { path: second, directoryState: "present" },
        ],
        sharedCacheRoots: [cache],
        recoveryRoots: [recovery],
      });
      expect(status.materializedBytes).toBe(6);
      expect(status.sharedCacheBytes).toBe(10);
      expect(status.recoveryBytes).toBe(6);
      expect(status.freeBytes).not.toBeNull();
    },
  );
  it("does not follow a linked root, count outside paths, or turn missing directories into zero", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-storage-"));
    roots.push(root);
    const actual = join(root, "actual");
    mkdirSync(actual);
    const linked = join(root, "linked");
    symlinkSync(actual, linked, process.platform === "win32" ? "junction" : "dir");
    expect(
      (await measureWorkspaceStorage({ root: linked, workspaces: [] })).materializedBytes,
    ).toBeNull();
    expect(
      (
        await measureWorkspaceStorage({
          root: actual,
          workspaces: [{ path: join(root, "outside"), directoryState: "present" }],
        })
      ).materializedBytes,
    ).toBeNull();
    expect(
      (
        await measureWorkspaceStorage({
          root: actual,
          workspaces: [{ path: join(actual, "missing"), directoryState: "present" }],
        })
      ).materializedBytes,
    ).toBeNull();
  });
});

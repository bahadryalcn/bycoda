import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as identity from "./build-identity";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { createHostServer } from "./server";
import { HostStore } from "./store";
import type { BuildIdentity, ManagedWorkspace, SessionRewindPlan } from "./workspace-contracts";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function fixture(buildIdentity: BuildIdentity | null = null) {
  vi.spyOn(identity, "readHostBuildIdentity").mockReturnValue(buildIdentity);
  const root = mkdtempSync(join(tmpdir(), "bycoda-managed-rpc-"));
  const target = join(root, "repo");
  mkdirSync(target);
  git(target, "init", "-q", "-b", "main");
  git(target, "config", "user.name", "Managed RPC Test");
  git(target, "config", "user.email", "managed-rpc@example.test");
  git(target, "config", "commit.gpgsign", "false");
  git(target, "config", "core.autocrlf", "false");
  writeFileSync(join(target, "source.txt"), "baseline source\n");
  writeFileSync(join(target, "owner.txt"), "baseline owner\n");
  git(target, "add", ".");
  git(target, "commit", "-qm", "RPC baseline");
  const store = new HostStore(join(root, "host.db"));
  const provider: HostProvider = {
    async send(input) {
      writeFileSync(join(input.cwd, "source.txt"), `${input.text}\n`);
      git(input.cwd, "add", "source.txt");
      git(input.cwd, "commit", "-qm", input.text);
    },
    stop: async () => {},
    cancel: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(store, { codex: provider });
  const project = await engine.openProject(target);
  const server = await createHostServer(engine, ["codex"]);
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (!root.startsWith(join(tmpdir(), "bycoda-managed-rpc-")))
      throw new Error("Unsafe RPC fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const device = await store.issueDevice("Owner test device");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const request = async (method: string, params: unknown = {}, token = device.token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  const call = async <T = any>(method: string, params: unknown = {}): Promise<T> => {
    const result = await request(method, params);
    expect(result.status, `${method}: ${result.value.error ?? ""}`).toBe(200);
    expect(result.value.error, method).toBeUndefined();
    return result.value.result as T;
  };
  const projectScope = { projectId: project.id, environmentId: store.environmentId };
  await call("projects.workspacePolicy.update", {
    ...projectScope,
    expectedRevision: 0,
    idempotencyKey: "rpc-fixture-policy",
    policy: {
      root: join(root, "worktrees"),
      disk: { budgetBytes: 1024 ** 3, warningRatio: 0.8, minimumFreeBytes: 1 },
    },
  });
  return { root, target, store, projectScope, server, device, request, call };
}

it("dispatches revision-bound pin, host rewind/Undo, approved delivery and cleanup over authenticated HTTP", async () => {
  const f = await fixture();
  const descriptor = await f.call("environment.describe");
  expect(descriptor.capabilities).toEqual(
    expect.arrayContaining([
      "workspaces.managed.v1",
      "workspaces.policy.v1",
      "workspaces.delivery.v1",
      "workspaces.pr-publication.v1",
      "workspaces.lifecycle.v1",
      "workspaces.pinning.v1",
      "sessions.git-rewind.v1",
      "sessions.git-rewind-undo.v1",
    ]),
  );
  expect(descriptor.buildIdentity).toBeUndefined();
  expect(descriptor.capabilities).not.toContain("build.identity.v1");
  const sessionId = randomUUID();
  const prepared = await f.call("workspaces.prepare", {
    ...f.projectScope,
    idempotencyKey: "rpc-workspace",
    owner: { kind: "session", id: sessionId },
    slug: "RPC writer",
  });
  const workspaceId = prepared.workspace.id as string;
  const workspace = () => f.call<ManagedWorkspace>("workspaces.get", { workspaceId });
  const pinRequest = {
    workspaceId,
    expectedRevision: prepared.workspace.revision,
    idempotencyKey: "pin-workspace",
    pinned: true,
  };
  expect((await f.request("workspaces.pin", pinRequest, "invalid-token")).status).toBe(401);
  const pinned = await f.call<ManagedWorkspace>("workspaces.pin", pinRequest);
  expect(pinned.pinned).toBe(true);
  expect(pinned.revision).toBe(pinRequest.expectedRevision + 1);
  expect(await f.call("workspaces.pin", pinRequest)).toEqual(pinned);
  const stalePin = await f.request("workspaces.pin", {
    ...pinRequest,
    idempotencyKey: "stale-pin",
    pinned: false,
  });
  expect(stalePin.status).toBe(400);
  expect(stalePin.value.error).toMatch(/revision/i);
  await f.call("workspaces.pin", {
    ...pinRequest,
    expectedRevision: pinned.revision,
    idempotencyKey: "unpin-workspace",
    pinned: false,
  });
  const created = await f.call("commands.dispatch", {
    type: "create",
    commandId: "rpc-create-session",
    workspaceId,
    projectId: f.projectScope.projectId,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  expect(created.sessionId).toBe(sessionId);
  const grant = await f.call("conversation.access.issue", { sessionId });
  for (const method of [
    "workspaces.pin",
    "workspaces.delivery.merge",
    "workspaces.cleanup.apply",
  ]) {
    const denied = await f.request(method, pinRequest, grant.token);
    expect(denied.status).toBe(400);
    expect(denied.value.error).toMatch(/credential|conversation|owner|scope/i);
  }
  const editor = await f.call("workspaces.activities.start", {
    workspaceId,
    kind: "editor",
    dirtyBuffer: true,
  });
  expect(await f.call("workspaces.activities.list", { workspaceId })).toContainEqual(
    expect.objectContaining({ id: editor.id, kind: "editor", dirtyBuffer: true }),
  );
  const editingPlan = await f.call("workspaces.cleanup.plan", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
  });
  expect(editingPlan.blockers.join(" ")).toMatch(/use|activity/i);
  const otherDevice = await f.store.issueDevice("Other owner device");
  const foreignStop = await f.request(
    "workspaces.activities.stop",
    { workspaceId, activityId: editor.id },
    otherDevice.token,
  );
  expect(foreignStop.status).toBe(400);
  expect(foreignStop.value.error).toMatch(/not owned/i);
  expect(
    await f.call("workspaces.activities.stop", { workspaceId, activityId: editor.id }),
  ).toEqual({ stopped: true });
  const storage = await f.call("workspaces.storage.status", f.projectScope);
  expect(storage.materialization).toBe("allowed");
  expect(storage.materializedBytes).toBeGreaterThan(0);
  const initialHead = git(prepared.workspace.path, "rev-parse", "HEAD");
  await f.call("commands.dispatch", {
    type: "send",
    commandId: "rpc-commit-turn",
    sessionId,
    text: "committed over owner transport",
  });
  await vi.waitFor(
    async () => {
      expect((await f.call("sessions.get", { sessionId })).status).toBe("idle");
      expect(
        (await f.server.managedWorkspaces.history.get(workspaceId, "rpc-commit-turn"))?.after
          ?.status,
      ).toBe("complete");
    },
    { timeout: 60_000, interval: 100 },
  );
  const committedHead = git(prepared.workspace.path, "rev-parse", "HEAD");
  expect(committedHead).not.toBe(initialHead);
  const transcript = await f.call("sessions.get", { sessionId });
  const plan = await f.call<SessionRewindPlan>("sessions.rewind.plan", {
    workspaceId,
    sessionId,
    expectedRevision: (await workspace()).revision,
    expectedConversationRevision: transcript.revision,
    direction: "rewind",
    userBlockId: "rpc-commit-turn",
  });
  const rewound = await f.call("sessions.rewind.apply", {
    workspaceId,
    sessionId,
    expectedRevision: plan.expectedRevision,
    expectedConversationRevision: plan.expectedConversationRevision,
    planToken: plan.token,
    idempotencyKey: "rpc-rewind",
  });
  expect(git(prepared.workspace.path, "rev-parse", "HEAD")).toBe(initialHead);
  expect((await f.call("sessions.get", { sessionId })).revision).toBe(rewound.conversationRevision);
  const undoPlan = await f.call<SessionRewindPlan>("sessions.rewind.plan", {
    workspaceId,
    sessionId,
    expectedRevision: rewound.workspaceRevision,
    expectedConversationRevision: rewound.conversationRevision,
    direction: "undo",
    operationId: rewound.operationId,
  });
  const undone = await f.call("sessions.rewind.undo", {
    workspaceId,
    sessionId,
    expectedRevision: undoPlan.expectedRevision,
    expectedConversationRevision: undoPlan.expectedConversationRevision,
    planToken: undoPlan.token,
    idempotencyKey: "rpc-undo",
  });
  expect(git(prepared.workspace.path, "rev-parse", "HEAD")).toBe(committedHead);
  expect((await f.call("sessions.get", { sessionId })).revision).toBe(undone.conversationRevision);
  await f.call("workspaces.finish", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
    idempotencyKey: "rpc-finish",
  });
  writeFileSync(join(f.target, "owner.txt"), "dirty owner file survives HTTP delivery\n");
  const targetStatus = git(f.target, "status", "--porcelain=v1");
  const review = await f.call("workspaces.delivery.review", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
    action: "merge",
  });
  expect(review.blockers).toEqual([]);
  const merged = await f.call("workspaces.delivery.merge", {
    workspaceId,
    expectedRevision: review.expectedRevision,
    planToken: review.token,
    idempotencyKey: "rpc-approved-merge",
  });
  expect(merged.sourceHead).toBe(committedHead);
  expect((await workspace()).state).toBe("merged");
  expect(git(f.target, "status", "--porcelain=v1")).toBe(targetStatus);
  expect(readFileSync(join(f.target, "owner.txt"), "utf8")).toBe(
    "dirty owner file survives HTTP delivery\n",
  );
  const cleanupPlan = await f.call("workspaces.cleanup.plan", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
  });
  expect(cleanupPlan.blockers).toEqual([]);
  expect(
    (await f.call("workspaces.cleanup.status", { workspaceId })).workspace.directoryState,
  ).toBe("present");
  const removed = await f.call("workspaces.cleanup.apply", {
    workspaceId,
    expectedRevision: cleanupPlan.expectedRevision,
    planToken: cleanupPlan.token,
    idempotencyKey: "rpc-remove-directory",
  });
  expect(removed.directoryState).toBe("removed");
  expect(existsSync(prepared.workspace.path)).toBe(false);
  expect(
    (await f.call("workspaces.cleanup.status", { workspaceId })).workspace.directoryState,
  ).toBe("removed");
  expect(git(f.target, "rev-parse", prepared.workspace.branchRef)).toBe(committedHead);
});

it("advertises the executable build identity capability only when its reader supplies an identity", async () => {
  const stamp: BuildIdentity = {
    schemaVersion: 1,
    buildId: "rpc-build",
    version: "0.0.0-test",
    channel: "test",
    mode: "debug",
    repositoryId: "rpc-repository",
    branch: "rpc-branch",
    head: "a".repeat(40),
    sourceFingerprint: "b".repeat(64),
    dirtyPaths: [],
    capturedAt: 123,
    components: { web: "rpc-build", native: "rpc-build", host: "rpc-build" },
    includedSources: [],
  };
  const f = await fixture(stamp);
  const descriptor = await f.call("environment.describe");
  expect(descriptor.buildIdentity).toEqual(stamp);
  expect(descriptor.capabilities).toContain("build.identity.v1");
});

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import type {
  ManagedWorkspace,
  SessionRewindPlan,
  SessionRewindReceipt,
} from "./workspace-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import {
  GitSessionRewindService,
  type ConversationRewindAdapter,
  type DurableRewindOperation,
  type GitSessionRewindOptions,
} from "./session-rewind";
import { durableWrite, refComponent } from "./turn-git-history";

// Synthetic external ports only: the real temp SQLite Host floor is exercised,
// while no provider, Git repository, checkpoint or native writer is launched.
vi.mock("./git-mutations", () => ({
  withHostGitMutation: async (_cwd: string, work: () => Promise<unknown>) => work(),
}));
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Apply = WorkspaceRpcRequest<"sessions.rewind.apply">;
function fingerprint(request: Apply, direction = "rewind") {
  return hash([
    request.workspaceId,
    request.sessionId,
    request.expectedRevision,
    request.expectedConversationRevision,
    request.planToken,
    request.idempotencyKey,
    direction,
    ...(request.authorityGeneration === undefined
      ? []
      : [["authorityGeneration", request.authorityGeneration]]),
  ]);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-rewind-authority-"));
  cleanups.push(async () => {
    const target = resolve(root);
    if (
      resolve(join(target, "..")) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-rewind-authority-")
    )
      throw new Error("refusing unexpected fixture cleanup");
    await rm(target, { recursive: true, force: true });
  });
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  async function floor(generation?: number) {
    await store.db.prepare("DELETE FROM host_authority_heads WHERE session_id=?").run("session");
    if (generation !== undefined)
      await store.db
        .prepare("INSERT INTO host_authority_heads VALUES (?,?,?,?,?)")
        .run(store.environmentId, "session", generation, "fixture-migration", "host-active");
  }
  await floor(2);
  const workspace = {
    id: "workspace",
    path: root,
    revision: 8,
    owner: { kind: "session", id: "session" },
    branchRef: "refs/heads/fixture",
  } as ManagedWorkspace;
  const plan: SessionRewindPlan = {
    authorityGeneration: 2,
    token: "preview",
    expiresAt: 60000,
    direction: "rewind",
    workspaceId: workspace.id,
    sessionId: "session",
    userBlockId: "owner",
    expectedRevision: 8,
    expectedConversationRevision: 12,
    branchRef: workspace.branchRef,
    currentHead: "current",
    targetHead: "target",
    statusFingerprint: "fingerprint",
    removedUserBlockIds: ["owner"],
    affectedCommits: [],
    affectedPaths: [],
    blockers: [],
    published: false,
    merged: false,
  };
  const request: Apply = {
    authorityGeneration: 2,
    workspaceId: workspace.id,
    sessionId: "session",
    expectedRevision: 8,
    expectedConversationRevision: 12,
    planToken: plan.token,
    idempotencyKey: "original-key",
  };
  const receipt: SessionRewindReceipt = {
    authorityGeneration: 2,
    operationId: "operation",
    sessionId: "session",
    workspaceId: workspace.id,
    direction: "rewind",
    workspaceRevision: 9,
    conversationRevision: 13,
    head: "target",
  };
  let operation: DurableRewindOperation | null = null;
  const registry = {
    findOperation: vi.fn(async () => operation),
    getOperation: vi.fn(async () => operation),
    listOperations: vi.fn(async () => []),
    saveOperation: vi.fn(),
    update: vi.fn(),
  };
  const history = {
    workspace: vi.fn(async () => workspace),
    get: vi.fn(async () => ({
      sessionId: "session",
      branchRef: workspace.branchRef,
      before: { status: "complete", snapshot: { head: "target", paths: [] } },
    })),
    capture: vi.fn(),
    retain: vi.fn(),
    restore: vi.fn(),
    fingerprint: vi.fn(async () => "fingerprint"),
    snapshotFingerprint: vi.fn(() => "fingerprint"),
  };
  const conversation: ConversationRewindAdapter = {
    read: vi.fn(async () => ({ revision: 12, userBlockIds: ["owner"] })),
    settle: vi.fn(async () => {}),
    withSessionGate: vi.fn(async (_id, work) => work()),
    rescue: vi.fn(async () => "rescue"),
    restore: vi.fn(async () => ({ revision: 13 })),
    receipt: vi.fn(async () => null),
    complete: vi.fn(async () => {}),
  };
  const activity = { reserve: vi.fn(), release: vi.fn() };
  const guard = vi.fn(async (id: string, generation?: number) => {
    await store.assertAuthority(id, generation);
  });
  const options: GitSessionRewindOptions = {
    root,
    assertAuthority: guard,
    now: () => 1000,
    conversation,
    registry: registry as unknown as GitSessionRewindOptions["registry"],
    history: history as unknown as GitSessionRewindOptions["history"],
    activity: activity as unknown as GitSessionRewindOptions["activity"],
  };
  const service = new GitSessionRewindService(options);
  await durableWrite(
    join(root, "plans", `${refComponent(plan.token)}.json`),
    JSON.stringify({ plan, target: { head: "target", paths: [] } }),
  );
  return {
    root,
    store,
    floor,
    options,
    plan,
    request,
    receipt,
    registry,
    history,
    conversation,
    activity,
    guard,
    service,
    setOperation(phase: DurableRewindOperation["phase"], finalized = false, legacy = false) {
      const retainedPlan = { ...plan };
      const retainedRequest = { ...request };
      if (legacy) {
        delete retainedPlan.authorityGeneration;
        delete retainedRequest.authorityGeneration;
      }
      operation = {
        id: "operation",
        kind: "rewind",
        phase,
        finalized,
        workspaceId: "workspace",
        idempotencyKey: "original-key",
        expectedRevision: 8,
        createdAt: 1,
        updatedAt: 1,
        plan: retainedPlan,
        target: { head: "target", paths: [] } as never,
        reservationId: "retained-reservation",
        rescueUserBlockIds: ["owner"],
        requestFingerprint: fingerprint(retainedRequest),
        ...(phase === "complete"
          ? { receipt: legacy ? { ...receipt, authorityGeneration: undefined } : receipt }
          : {}),
      };
      return operation;
    },
  };
}

it.each([undefined, 1, 3])(
  "rejects a migrated plan/apply generation %s before external work",
  async (generation) => {
    const f = await fixture();
    await expect(
      f.service.plan({
        ...f.request,
        direction: "rewind",
        userBlockId: "owner",
        authorityGeneration: generation,
      }),
    ).rejects.toThrow("committed current generation");
    await expect(
      f.service.apply({ ...f.request, authorityGeneration: generation }),
    ).rejects.toThrow("committed current generation");
    expect(f.history.workspace).not.toHaveBeenCalled();
    expect(f.history.capture).not.toHaveBeenCalled();
    expect(f.conversation.settle).not.toHaveBeenCalled();
    expect(f.activity.reserve).not.toHaveBeenCalled();
  },
);

it("rechecks a plan after waiting for the session gate before capturing any Git/checkpoint state", async () => {
  const f = await fixture();
  vi.mocked(f.conversation.withSessionGate).mockImplementation(async (_id, work) => {
    await f.floor(3);
    return work();
  });
  await expect(
    f.service.plan({ ...f.request, direction: "rewind", userBlockId: "owner" }),
  ).rejects.toThrow("committed current generation");
  expect(f.history.capture).not.toHaveBeenCalled();
  expect(f.conversation.read).not.toHaveBeenCalled();
});

it("rechecks authority after asynchronous boundary reads before a plan's Git capture", async () => {
  const f = await fixture();
  f.history.get.mockImplementation(async () => {
    await f.floor(3);
    return {
      sessionId: "session",
      branchRef: "refs/heads/fixture",
      before: { status: "complete", snapshot: { head: "target", paths: [] } },
    };
  });
  await expect(
    f.service.plan({ ...f.request, direction: "rewind", userBlockId: "owner" }),
  ).rejects.toThrow("committed current generation");
  expect(f.history.capture).not.toHaveBeenCalled();
});

it("rejects replacing a reviewed old generation with the fresh head before settle/reserve", async () => {
  const f = await fixture();
  await f.floor(3);
  await expect(f.service.apply({ ...f.request, authorityGeneration: 3 })).rejects.toThrow(
    "preview is stale",
  );
  expect(f.conversation.settle).not.toHaveBeenCalled();
  expect(f.activity.reserve).not.toHaveBeenCalled();
});

it("rechecks an admitted apply after settle before reservation or Git/file effects", async () => {
  const f = await fixture();
  vi.mocked(f.conversation.settle).mockImplementation(async () => {
    await f.floor(3);
  });
  await expect(f.service.apply(f.request)).rejects.toThrow("committed current generation");
  expect(f.conversation.settle).toHaveBeenCalledTimes(1);
  expect(f.activity.reserve).not.toHaveBeenCalled();
  expect(f.history.capture).not.toHaveBeenCalled();
  expect(f.conversation.rescue).not.toHaveBeenCalled();
  expect(f.history.restore).not.toHaveBeenCalled();
});

it.each(["prepared", "git-restored", "conversation-restored", "complete"] as const)(
  "holds unfinished %s recovery at its retained generation without releasing or replaying effects",
  async (phase) => {
    const f = await fixture();
    f.setOperation(phase);
    await f.floor(3);
    await expect(f.service.recover("operation")).rejects.toThrow("committed current generation");
    expect(f.conversation.withSessionGate).not.toHaveBeenCalled();
    expect(f.history.restore).not.toHaveBeenCalled();
    expect(f.conversation.restore).not.toHaveBeenCalled();
    expect(f.conversation.complete).not.toHaveBeenCalled();
    expect(f.activity.release).not.toHaveBeenCalled();
  },
);

it.each(["checkpoint-rescue", "git-restore", "conversation-restore"] as const)(
  "rechecks retained authority after asynchronous recovery reads before %s",
  async (effect) => {
    const f = await fixture();
    const operation = f.setOperation(
      effect === "conversation-restore" ? "git-restored" : "prepared",
    );
    operation.rescue = { head: "before", paths: [] } as never;
    if (effect !== "checkpoint-rescue") operation.transcriptRescueId = "retained-rescue";
    f.activity.reserve.mockResolvedValue({ id: "retained-reservation" });
    if (effect === "git-restore") {
      vi.mocked(f.conversation.read).mockImplementation(async () => {
        await f.floor(3);
        return { revision: 12, userBlockIds: ["owner"] };
      });
    } else {
      f.history.fingerprint.mockImplementation(async () => {
        await f.floor(3);
        return "fingerprint";
      });
    }
    await expect(f.service.recover("operation")).rejects.toThrow("committed current generation");
    expect(f.history.restore).not.toHaveBeenCalled();
    expect(f.conversation.rescue).not.toHaveBeenCalled();
    expect(f.conversation.restore).not.toHaveBeenCalled();
    expect(f.activity.release).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "returns the exact committed receipt after floor advance (finalized=%s), with no new effects",
  async (finalized) => {
    const f = await fixture();
    f.setOperation("complete", finalized);
    await f.floor(3);
    expect(await f.service.apply(f.request)).toEqual(f.receipt);
    expect(f.history.restore).not.toHaveBeenCalled();
    expect(f.conversation.complete).not.toHaveBeenCalled();
    expect(f.activity.release).not.toHaveBeenCalled();
    expect(f.conversation.settle).not.toHaveBeenCalled();
    await expect(f.service.apply({ ...f.request, authorityGeneration: 3 })).rejects.toThrow(
      "another rewind request",
    );
  },
);

it("preserves legacy fingerprint bytes and historical receipt readability without injecting a generation", async () => {
  const f = await fixture();
  f.setOperation("complete", true, true);
  const legacy = { ...f.request };
  delete legacy.authorityGeneration;
  expect(await f.service.apply(legacy)).toEqual({ ...f.receipt, authorityGeneration: undefined });
  expect(f.guard).not.toHaveBeenCalled();
});

it("leaves untouched legacy admission unchanged while requiring an explicit durable guard", async () => {
  const f = await fixture();
  await f.floor();
  f.history.get.mockRejectedValue(new Error("legacy fixture boundary reached"));
  const legacy = { ...f.request };
  delete legacy.authorityGeneration;
  await expect(
    f.service.plan({ ...legacy, direction: "rewind", userBlockId: "owner" }),
  ).rejects.toThrow("legacy fixture boundary reached");
  expect(f.guard).toHaveBeenCalledWith("session", undefined);
  expect(
    () => new GitSessionRewindService({ ...f.options, assertAuthority: undefined } as never),
  ).toThrow("durable authority guard");
});

it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, "2", null])(
  "rejects malformed rewind generation %s before lookup/effects",
  async (generation) => {
    const f = await fixture();
    await expect(
      f.service.apply({ ...f.request, authorityGeneration: generation as number }),
    ).rejects.toThrow("Invalid rewind authority generation");
    expect(f.registry.findOperation).not.toHaveBeenCalled();
    expect(f.guard).not.toHaveBeenCalled();
  },
);

import { afterEach, expect, it, vi } from "vitest";
import {
  runRoomManagementTurn,
  type RoomManagementTurnState,
  type RoomManagementResult,
  type RoomManagementCall,
  type RoomManagementAdmission,
} from "./assistant-management-turn";
import { roomManagementInput } from "./assistant-management-dispatch";
import { roomManagementDiscovery } from "./assistant-management-dispatch";

function fixture() {
  let saved: RoomManagementTurnState | null = null;
  let authorized = true,
    visible = true;
  let projectCwd = "/old-project";
  const controller = new AbortController();
  const admission = {
    environmentId: "host",
    deviceHash: "owner-device",
    authorized: async () => authorized,
  };
  const input = {
    operationId: "reply:room:owner-request",
    ownerMessageId: "owner-message",
    threadId: "room",
    execution: { harness: "codex", model: "saved-reply" },
    tokenCap: 100000,
    context: "Accepted owner request",
    admission,
    signal: controller.signal,
    validateContext: async () => visible,
    validateAccounts: async () => visible,
    validateProjects: async (proofs: { projectId: string; cwd: string }[]) =>
      proofs.every((proof) => proof.cwd === projectCwd),
  };
  const model = vi.fn(async () => ({
    text: JSON.stringify({ type: "final", text: "Read complete" }),
    tokens: 20,
  }));
  const tool = vi.fn(
    async (
      call: RoomManagementCall,
      _admission: RoomManagementAdmission,
    ): Promise<RoomManagementResult> => ({
      value: { state: "completed", item: "verified output" },
      source: {
        environmentId: "host",
        threadId: call.threadId,
        family: call.family,
        action: call.action,
        ...(call.projectId ? { projectId: call.projectId, projectCwd: "/old-project" } : {}),
        ...(call.accountId ? { accountId: call.accountId } : {}),
      },
      contributorProjectIds: call.projectId ? [call.projectId] : [],
      ...(call.family === "social" && !call.projectId
        ? {
            contributorAccounts: call.accountId
              ? [{ accountId: call.accountId, version: "grant-v1" }]
              : [],
          }
        : {}),
    }),
  );
  const ports = {
    load: async () => saved,
    save: async (state: RoomManagementTurnState) => {
      saved = structuredClone(state);
    },
    model,
    tool,
  };
  return {
    input,
    ports,
    model,
    tool,
    controller,
    get saved() {
      return saved;
    },
    revoke: () => {
      authorized = false;
    },
    hide: () => {
      visible = false;
    },
    retarget: () => {
      projectCwd = "/new-project";
    },
  };
}
const decision = (action: string, input = {}, projectId?: string) => ({
  text: JSON.stringify({
    type: "tool",
    family: "conversation",
    action,
    input,
    ...(projectId ? { projectId } : {}),
  }),
  tokens: 10,
});
it("does not disclose a project result after its identity is retargeted", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce(decision("tasks.get", { id: "task" }, "project"));
  const original = f.tool.getMockImplementation()!;
  f.tool.mockImplementationOnce(async (call, admission) => {
    const result = await original(call, admission);
    f.retarget();
    return result;
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow(
    "project source became unavailable or changed",
  );
  expect(f.model).toHaveBeenCalledTimes(1);
});
afterEach(() => vi.useRealTimers());

it("discovers, describes and reads exact project data before a final readback", async () => {
  const f = fixture();
  f.model
    .mockResolvedValueOnce(decision("tools.search", { query: "tasks", limit: 2 }))
    .mockResolvedValueOnce(decision("tools.describe", { ids: ["conversation:tasks.get"] }))
    .mockResolvedValueOnce(decision("tasks.get", { id: "task" }, "project"));
  const result = await runRoomManagementTurn(f.input, f.ports);
  expect(result).toMatchObject({
    text: "Read complete",
    tokens: 50,
    contributorProjectIds: ["project"],
  });
  expect(f.tool.mock.calls.map(([call]) => call.action)).toEqual([
    "tools.search",
    "tools.describe",
    "tasks.get",
  ]);
  expect(f.model.mock.calls.at(-1)![0]).toContain("verified output");
  expect(f.saved?.phase).toBe("settled");
  await runRoomManagementTurn(f.input, f.ports);
  expect(f.tool).toHaveBeenCalledTimes(3);
  expect(f.model).toHaveBeenCalledTimes(4);
  f.revoke();
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("revoked");
});

it("holds uncertain effects across reconstruction without replaying a single tool", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce(
    decision("preferences.patch", {
      requestId: "model-chosen",
      expectedRevision: "r",
      change: { kind: "theme", value: "dark" },
    }),
  );
  f.tool.mockImplementationOnce(async (call) => {
    expect(call.requestId).toMatch(/^room-[a-f0-9]{64}$/);
    expect(call.input.requestId).toBe(call.requestId);
    expect(f.saved?.phase).toBe("tool-pending");
    throw new Error("Native acknowledgement lost");
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("acknowledgement lost");
  expect(f.saved).toMatchObject({ phase: "held-uncertain", calls: [{ status: "unknown" }] });
  await expect(runRoomManagementTurn(f.input, { ...f.ports })).rejects.toThrow("uncertain outcome");
  expect(f.tool).toHaveBeenCalledTimes(1);
  expect(f.model).toHaveBeenCalledTimes(1);
});

it("returns uncertain original receipts while keeping uncertain mutations held", async () => {
  for (const action of ["remote.result", "inbox.result", "preferences.status"]) {
    const f = fixture();
    f.model.mockResolvedValueOnce(decision(action, { requestId: "original" }));
    const original = f.tool.getMockImplementation()!;
    f.tool.mockImplementationOnce(async (call, admission) => {
      expect(call.input.requestId).toBe("original");
      return {
        ...(await original(call, admission)),
        value: { requestId: "original", state: "uncertain" },
      };
    });
    await expect(runRoomManagementTurn(f.input, f.ports)).resolves.toMatchObject({
      text: "Read complete",
    });
    expect(f.tool).toHaveBeenCalledOnce();
  }
  const f = fixture();
  f.model.mockResolvedValueOnce(
    decision("preferences.patch", {
      requestId: "new",
      expectedRevision: "r",
      change: { kind: "theme", value: "dark" },
    }),
  );
  const original = f.tool.getMockImplementation()!;
  f.tool.mockImplementationOnce(async (call, admission) => ({
    ...(await original(call, admission)),
    value: { state: "uncertain" },
  }));
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("outcome is unknown");
  expect(f.saved).toMatchObject({ phase: "held-uncertain" });
  expect(f.model).toHaveBeenCalledOnce();
});

it("preserves receipt/entity references while assigning only actual mutation identities", () => {
  expect(
    roomManagementInput("conversation", "preferences.status", { requestId: "original" }, "next")
      .requestId,
  ).toBe("original");
  expect(
    roomManagementInput("conversation", "crews.resolve", { requestId: "directive" }, "next"),
  ).toMatchObject({ requestId: "directive", operationId: "next" });
});

it("revalidates privacy after a tool and before feeding its result to another model", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce(decision("tasks.get", { id: "task" }, "project"));
  f.tool.mockImplementationOnce(async (call) => {
    f.hide();
    return {
      value: "private output",
      source: {
        environmentId: "host",
        threadId: "room",
        family: "conversation",
        action: call.action,
        projectId: "project",
      },
    };
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("private or changed");
  expect(f.model).toHaveBeenCalledTimes(1);
  expect(f.saved?.phase).toBe("held-uncertain");
});

it("bounds pending tool observation and fences late completion from resuming the turn", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: (result: RoomManagementResult) => void;
  f.model.mockResolvedValueOnce(decision("tools.list"));
  let received!: RoomManagementAdmission;
  f.tool.mockImplementationOnce((_call, admission) => {
    received = admission;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const work = runRoomManagementTurn(f.input, f.ports);
  const failure = expect(work).rejects.toThrow("uncertain after its deadline");
  await vi.advanceTimersByTimeAsync(120001);
  await failure;
  expect(f.saved?.phase).toBe("held-uncertain");
  expect(received.signal?.aborted).toBe(true);
  expect(await received.authorized()).toBe(false);
  finish({
    value: {},
    source: {
      environmentId: "host",
      threadId: "room",
      family: "conversation",
      action: "tools.list",
    },
    contributorProjectIds: [],
  });
  await Promise.resolve();
  expect(f.saved?.phase).toBe("held-uncertain");
  expect(f.model).toHaveBeenCalledTimes(1);
});

it("stop interrupts pending tool observation without claiming the underlying effect stopped", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce(decision("tools.list"));
  f.tool.mockImplementationOnce(async () => {
    f.controller.abort();
    return new Promise(() => {});
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("stopped");
  expect(f.saved).toMatchObject({ phase: "held-uncertain", calls: [{ status: "unknown" }] });
});

it("holds unknown receipts and missing usage never becomes measured zero", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce(decision("tools.list"));
  f.tool.mockResolvedValueOnce({
    value: { state: "unknown" },
    source: {
      environmentId: "host",
      threadId: "room",
      family: "conversation",
      action: "tools.list",
    },
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow("outcome is unknown");
  expect(f.model).toHaveBeenCalledTimes(1);
  const g = fixture();
  g.model.mockResolvedValueOnce({
    text: JSON.stringify({ type: "final", text: "Owner reply" }),
    tokens: undefined as unknown as number,
  });
  expect((await runRoomManagementTurn(g.input, g.ports)).tokens).toBeUndefined();
});

it("rejects model identity injection and aggregate-budget excess before any effect", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce({
    text: JSON.stringify({
      type: "tool",
      family: "conversation",
      action: "tools.list",
      input: {},
      threadId: "foreign",
    }),
    tokens: 1,
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow();
  expect(f.tool).not.toHaveBeenCalled();
  const g = fixture();
  g.model.mockResolvedValueOnce({ ...decision("tools.list"), tokens: g.input.tokenCap + 1 });
  await expect(runRoomManagementTurn(g.input, g.ports)).rejects.toThrow(
    "aggregate token allowance",
  );
  expect(g.tool).not.toHaveBeenCalled();
});

it("completes realistic bounded discovery, read, write and readback within the default 8000 token reservation", async () => {
  const f = fixture();
  f.input.tokenCap = 8000;
  const plans = [
    decision("tools.search", { query: "tasks", limit: 3 }, "project"),
    decision(
      "tools.describe",
      { ids: ["conversation:tasks.get", "conversation:tasks.update"], maxChars: 3000 },
      "project",
    ),
    decision("tasks.get", { id: "task-one" }, "project"),
    decision(
      "tasks.update",
      { id: "task-one", expectedVersion: 1, patch: { title: "Owner-reviewed title" } },
      "project",
    ),
    decision("tasks.get", { id: "task-one" }, "project"),
    {
      text: JSON.stringify({
        type: "final",
        text: "Updated task title; readback confirms Owner-reviewed title.",
      }),
      tokens: 0,
    },
  ];
  let index = 0;
  f.model.mockImplementation(async (prompt) => {
    const answer = plans[index++];
    return { ...answer, tokens: Math.ceil(Buffer.byteLength(prompt + answer.text, "utf8") / 4) };
  });
  f.tool.mockImplementation(async (call) => ({
    source: {
      environmentId: "host",
      threadId: "room",
      family: call.family,
      action: call.action,
      projectId: "project",
      projectCwd: "/old-project",
    },
    contributorProjectIds: ["project"],
    value: ["tools.search", "tools.describe"].includes(call.action)
      ? roomManagementDiscovery(call.action, call.input, "project")
      : {
          id: "task-one",
          title: index < 4 ? "Original title" : "Owner-reviewed title",
          version: index < 4 ? 1 : 2,
          state: "ready",
        },
  }));
  const result = await runRoomManagementTurn(f.input, f.ports);
  expect(result.tokens).toBeLessThanOrEqual(8000);
  expect(f.tool.mock.calls.map(([call]) => call.action)).toEqual([
    "tools.search",
    "tools.describe",
    "tasks.get",
    "tasks.update",
    "tasks.get",
  ]);
});

it("binds projectless social tool decisions and results to the exact account", async () => {
  const f = fixture();
  f.model.mockResolvedValueOnce({
    text: JSON.stringify({
      type: "tool",
      family: "social",
      action: "inbox.list",
      accountId: "account-a",
      input: {},
    }),
    tokens: 10,
  });
  await runRoomManagementTurn(f.input, f.ports);
  expect(f.tool.mock.calls[0][0]).toMatchObject({
    threadId: "room",
    accountId: "account-a",
    family: "social",
  });
  const bad = fixture();
  bad.model.mockResolvedValueOnce({
    text: JSON.stringify({
      type: "tool",
      family: "social",
      action: "inbox.list",
      accountId: "account-a",
      input: {},
    }),
    tokens: 10,
  });
  bad.tool.mockImplementationOnce(async (call) => ({
    value: {},
    source: {
      environmentId: "host",
      threadId: call.threadId,
      family: call.family,
      action: call.action,
      accountId: "account-b",
    },
    contributorProjectIds: [],
  }));
  await expect(runRoomManagementTurn(bad.input, bad.ports)).rejects.toThrow(
    "result source changed",
  );
});

it("holds account provenance across provider awaits and rejects a revoked reply", async () => {
  const f = fixture();
  let allowed = true;
  f.input.validateAccounts = async (proofs) =>
    allowed &&
    proofs.every((proof) => proof.accountId === "account-a" && proof.version === "grant-v1");
  f.model.mockResolvedValueOnce({
    text: JSON.stringify({
      type: "tool",
      family: "social",
      action: "inbox.list",
      accountId: "account-a",
      input: {},
    }),
    tokens: 10,
  });
  f.model.mockImplementationOnce(async () => {
    allowed = false;
    return { text: JSON.stringify({ type: "final", text: "private data" }), tokens: 10 };
  });
  await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow(
    "account access became unavailable",
  );
  expect(f.saved?.result).toBeUndefined();
});

it("fails closed when account provenance is missing or names another account", async () => {
  for (const contributorAccounts of [
    undefined,
    [{ accountId: "account-b", version: "grant-v1" }],
  ]) {
    const f = fixture();
    f.model.mockResolvedValueOnce({
      text: JSON.stringify({
        type: "tool",
        family: "social",
        action: "inbox.list",
        accountId: "account-a",
        input: {},
      }),
      tokens: 10,
    });
    f.tool.mockImplementationOnce(async (call) => ({
      value: {},
      source: {
        environmentId: "host",
        threadId: call.threadId,
        family: call.family,
        action: call.action,
        accountId: "account-a",
      },
      contributorProjectIds: [],
      ...(contributorAccounts ? { contributorAccounts } : {}),
    }));
    await expect(runRoomManagementTurn(f.input, f.ports)).rejects.toThrow(
      contributorAccounts
        ? "account contributor scope changed"
        : "account provenance is unavailable",
    );
    expect(f.saved?.result).toBeUndefined();
  }
});

it("retains verified Native library provenance across the model turn and blocks revoked sources", async () => {
  const f = fixture();
  const proof = {
    environmentId: "host",
    threadId: "room",
    installationId: "installation",
    issuer: "issuer",
    registryRevision: "revision",
    visibilityEpoch: 1,
    policyGeneration: "policy",
  };
  let valid = true;
  const input = { ...f.input, validateNativeProofs: async () => valid };
  f.model.mockResolvedValueOnce(decision("observations.read", { nativeLibrary: true }));
  f.tool.mockImplementationOnce(async (call) => ({
    value: { events: [] },
    source: {
      environmentId: "host",
      threadId: call.threadId,
      family: call.family,
      action: call.action,
      nativeLibrary: true,
    },
    contributorProjectIds: [],
    contributorNativeProofs: [proof],
  }));
  const result = await runRoomManagementTurn(input, f.ports);
  expect(result.contributorNativeProofs).toEqual([proof]);
  expect(f.saved?.calls[0].contributorNativeProofs).toEqual([proof]);
  valid = false;
  await expect(runRoomManagementTurn(input, f.ports)).rejects.toThrow(
    "Native library source became unavailable or changed",
  );
});

import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), scope: vi.fn(() => ({ stableStorageKeys: { groups: [] } })) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("./roomPrivacyScope", () => ({ readRoomPrivacyScope: mocks.scope }));

it("only requests closed recovery after an explicit owner action", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 }) : Promise.reject(new Error("Privacy lock state is unavailable")));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"));
  const original = mocks.invoke.mock.calls.find(([command]) => command === "control_privacy_projection_transition")![1];
  expect(original.recoverClosed).toBeUndefined();
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const recovery = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  expect(recovery.operationId).toBe(original.operationId);
  expect(recovery.recoverClosed).toBe(true);
});

it("keeps the recovery payload unchanged after an uncertain acknowledgement", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 }) : Promise.reject(new Error("Privacy lock state is unavailable")));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"));
  mocks.invoke.mockRejectedValue(new Error("unknown"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow("unknown");
  const first = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const retried = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  expect(retried).toEqual(first);
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("rebases a confirmed pre-commit scope change for a new owner review", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 }) : Promise.reject(new Error("Privacy lock state is unavailable")));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"));
  mocks.invoke.mockRejectedValue(new Error("Privacy scope changed during recovery"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow("Privacy scope changed during recovery");
  const old = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockImplementation((command: string) => Promise.resolve({ revision: command === "control_privacy_projection_read" ? 4 : 5 }));
  await model.rebuildClosedRoomPrivacyProjection();
  const next = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  expect(next.operationId).not.toBe(old.operationId);
  expect(next.rebaseFrom).toBe(old.operationId);
  expect(next.snapshot).toEqual({ groups: ["changed"] });
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("reads the exact committed receipt before rebasing a changed post-commit scope", async () => {
  vi.resetModules(); mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [], assignments: {} } } as never);
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 }) : Promise.reject(new Error("Privacy lock state is unavailable")));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"));
  mocks.invoke.mockRejectedValue(new Error("Privacy policy changed before commit"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow("Privacy policy changed before commit");
  const old = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 5, operationId: old.operationId, snapshot: { assignments: {}, groups: [] } }) : Promise.resolve({ revision: 6 }));
  await model.rebuildClosedRoomPrivacyProjection();
  const next = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition").at(-1)![1];
  expect(next.operationId).not.toBe(old.operationId);
  expect(next.rebaseApplied).toBe(true);
  expect(next.rebaseFrom).toBe(old.operationId);
  expect(next.rebaseSnapshot).toEqual(old.snapshot);
  expect(next.rebaseExpected).toBe(old.expected);
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("holds failed qualification and retries the same operation identity", async () => {
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 })
    : Promise.reject(new Error("unknown")));
  const model = await import("./roomPrivacyProjection");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const observer = vi.fn();
  const stopBroken = model.subscribeRoomPrivacyStatus(() => { throw new Error("listener failed"); });
  const stopObserver = model.subscribeRoomPrivacyStatus(observer);
  model.activateRoomPrivacyProjection();
  expect(model.getRoomPrivacyStatus().pending).toBe(true);
  expect(() => model.requireRoomPrivacyAdmission()).toThrow("Room privacy protection is not confirmed.");
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("unknown"));
  expect(() => model.requireRoomPrivacyAdmission()).toThrow("Room privacy protection is not confirmed.");
  const first = mocks.invoke.mock.calls.find(([command]) => command === "control_privacy_projection_transition")![1];
  mocks.invoke.mockResolvedValueOnce({ revision: 5 });
  model.retryRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null }));
  expect(() => model.requireRoomPrivacyAdmission()).not.toThrow();
  const attempts = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_transition");
  expect(attempts).toHaveLength(2);
  expect(attempts[1][1]).toEqual(first);
  expect(observer).toHaveBeenCalled();
  expect(log).toHaveBeenCalled();
  stopBroken();
  stopObserver();
  log.mockRestore();
});

it("waits for native drain before mutation and preserves state on failed begin", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 1 }) : Promise.resolve({ revision: 2 }));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_begin"
    ? gate : Promise.resolve({ revision: 2 }));
  const mutate = vi.fn(() => "saved");
  const work = model.withRoomPrivacyMutation(mutate, "native-pending");
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("control_privacy_projection_begin", expect.objectContaining({ workspaceRequestId: "native-pending" })));
  expect(mutate).not.toHaveBeenCalled();
  release();
  await expect(work).resolves.toBe("saved");
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_begin"
    ? Promise.reject(new Error("drain failed")) : Promise.resolve({ revision: 2 }));
  const rejected = vi.fn();
  await expect(model.withRoomPrivacyMutation(rejected)).rejects.toThrow("drain failed");
  expect(rejected).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValue({ revision: 3 });
  await expect(model.withRoomPrivacyMutation(rejected)).rejects.toThrow("drain failed");
  expect(rejected).not.toHaveBeenCalled();
  const failedBegin = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_begin").at(-1)![1];
  model.retryRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null }));
  const begins = mocks.invoke.mock.calls.filter(([command]) => command === "control_privacy_projection_begin");
  expect(begins.at(-1)![1]).toEqual(failedBegin);
  expect(rejected).not.toHaveBeenCalled();
  const token = await model.withRoomPrivacyMutation((issued) => {
    expect(() => model.requirePrivacyMutationToken(issued)).not.toThrow();
    return issued;
  });
  expect(() => model.requirePrivacyMutationToken(token)).toThrow("Privacy mutation token is no longer active.");
});

it("does not run a later queued mutation after an earlier begin fails", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 1 }) : Promise.resolve({ revision: 2 }));
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  let rejectBegin!: (error: Error) => void;
  mocks.invoke.mockImplementation((command: string) => command === "control_privacy_projection_begin"
    ? new Promise((_, reject) => { rejectBegin = reject; }) : Promise.resolve({ revision: 2 }));
  const firstWrite = vi.fn();
  const secondWrite = vi.fn();
  const first = model.withRoomPrivacyMutation(firstWrite);
  const second = model.withRoomPrivacyMutation(secondWrite);
  const firstRejected = expect(first).rejects.toThrow("drain failed");
  const secondRejected = expect(second).rejects.toThrow("drain failed");
  await vi.waitFor(() => expect(rejectBegin).toBeDefined());
  rejectBegin(new Error("drain failed"));
  await firstRejected;
  await secondRejected;
  expect(firstWrite).not.toHaveBeenCalled();
  expect(secondWrite).not.toHaveBeenCalled();
});

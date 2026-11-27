import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  scope: vi.fn(() => ({ stableStorageKeys: { groups: [] } })),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("./roomPrivacyScope", () => ({ readRoomPrivacyScope: mocks.scope }));

it("offers a plain retry for a held Host failure and clears it for the next mutation", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  const failure = "RPC_WS_REMOTE: The Host operation could not be confirmed";
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error(failure)),
  );
  const model = await import("./roomPrivacyProjection");
  expect(model.canRetryRoomPrivacyProjection()).toBe(false);
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe(failure));
  await expect(model.withRoomPrivacyMutation(() => "folder")).rejects.toThrow(failure);
  expect(model.canRetryRoomPrivacyProjection()).toBe(true);
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "control_privacy_projection_read" ? { revision: 4 } : { revision: 5 },
    ),
  );
  await model.recoverRoomPrivacyProjection();
  expect(model.canRetryRoomPrivacyProjection()).toBe(false);
  await expect(model.withRoomPrivacyMutation(() => "folder")).resolves.toBe("folder");
  model.deactivateRoomPrivacyProjection();
});

it("does not offer a plain retry when closed recovery is required", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("Privacy lock state is unavailable")),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"),
  );
  expect(model.canRetryRoomPrivacyProjection()).toBe(false);
  model.deactivateRoomPrivacyProjection();
});

it("only requests closed recovery after an explicit owner action", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("Privacy lock state is unavailable")),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"),
  );
  const original = mocks.invoke.mock.calls.find(
    ([command]) => command === "control_privacy_projection_transition",
  )![1];
  expect(original.recoverClosed).toBeUndefined();
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const recovery = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(recovery.operationId).toBe(original.operationId);
  expect(recovery.recoverClosed).toBe(true);
});

it("offers owner rebuild when the live policy diverged from the saved one", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  const diverged = "Privacy policy has not been acknowledged by this window";
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error(diverged)),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe(diverged));
  expect(model.canRetryRoomPrivacyProjection()).toBe(false);
  expect(model.canRebuildRoomPrivacyProjection()).toBe(true);
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const recovery = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(recovery.recoverClosed).toBe(true);
  expect(model.getRoomPrivacyStatus().error).toBeNull();
  model.deactivateRoomPrivacyProjection();
});

it("rebases a change that failed inside its lease onto an owner rebuild", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  const diverged = "Privacy policy has not been acknowledged by this window";
  mocks.invoke.mockResolvedValue({ revision: 4 });
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_begin"
      ? Promise.reject(new Error(diverged))
      : Promise.resolve({ revision: 4 }),
  );
  await expect(model.withRoomPrivacyMutation(() => "folder")).rejects.toThrow(diverged);
  const held = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_begin")
    .at(-1)![1].operationId;
  expect(model.canRebuildRoomPrivacyProjection()).toBe(true);
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const recovery = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(recovery).toMatchObject({ expected: 5, recoverClosed: true, rebaseFrom: held });
  expect(recovery.operationId).not.toBe(held);
  model.deactivateRoomPrivacyProjection();
});

it("keeps the recovery payload unchanged after an uncertain acknowledgement", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("Privacy lock state is unavailable")),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"),
  );
  mocks.invoke.mockRejectedValue(new Error("unknown"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow("unknown");
  const first = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockResolvedValue({ revision: 5 });
  await model.rebuildClosedRoomPrivacyProjection();
  const retried = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(retried).toEqual(first);
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("rebases a confirmed pre-commit scope change for a new owner review", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("Privacy lock state is unavailable")),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"),
  );
  mocks.invoke.mockRejectedValue(new Error("Privacy scope changed during recovery"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow(
    "Privacy scope changed during recovery",
  );
  const old = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve({ revision: command === "control_privacy_projection_read" ? 4 : 5 }),
  );
  await model.rebuildClosedRoomPrivacyProjection();
  const next = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(next.operationId).not.toBe(old.operationId);
  expect(next.rebaseFrom).toBe(old.operationId);
  expect(next.snapshot).toEqual({ groups: ["changed"] });
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("reads the exact committed receipt before rebasing a changed post-commit scope", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [], assignments: {} } } as never);
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("Privacy lock state is unavailable")),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus().error).toBe("Privacy lock state is unavailable"),
  );
  mocks.invoke.mockRejectedValue(new Error("Privacy policy changed before commit"));
  await expect(model.rebuildClosedRoomPrivacyProjection()).rejects.toThrow(
    "Privacy policy changed before commit",
  );
  const old = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: ["changed"] } } as never);
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({
          revision: 5,
          operationId: old.operationId,
          snapshot: { assignments: {}, groups: [] },
        })
      : Promise.resolve({ revision: 6 }),
  );
  await model.rebuildClosedRoomPrivacyProjection();
  const next = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_transition")
    .at(-1)![1];
  expect(next.operationId).not.toBe(old.operationId);
  expect(next.rebaseApplied).toBe(true);
  expect(next.rebaseFrom).toBe(old.operationId);
  expect(next.rebaseSnapshot).toEqual(old.snapshot);
  expect(next.rebaseExpected).toBe(old.expected);
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
});

it("holds failed qualification and retries the same operation identity", async () => {
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 4 })
      : Promise.reject(new Error("unknown")),
  );
  const model = await import("./roomPrivacyProjection");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const observer = vi.fn();
  const stopBroken = model.subscribeRoomPrivacyStatus(() => {
    throw new Error("listener failed");
  });
  const stopObserver = model.subscribeRoomPrivacyStatus(observer);
  model.activateRoomPrivacyProjection();
  expect(model.getRoomPrivacyStatus().pending).toBe(true);
  expect(() => model.requireRoomPrivacyAdmission()).toThrow(
    "Room privacy protection is not confirmed.",
  );
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().error).toBe("unknown"));
  expect(() => model.requireRoomPrivacyAdmission()).toThrow(
    "Room privacy protection is not confirmed.",
  );
  const first = mocks.invoke.mock.calls.find(
    ([command]) => command === "control_privacy_projection_transition",
  )![1];
  mocks.invoke.mockResolvedValueOnce({ revision: 5 });
  model.retryRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null }),
  );
  expect(() => model.requireRoomPrivacyAdmission()).not.toThrow();
  const attempts = mocks.invoke.mock.calls.filter(
    ([command]) => command === "control_privacy_projection_transition",
  );
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
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 1 })
      : Promise.resolve({ revision: 2 }),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_begin" ? gate : Promise.resolve({ revision: 2 }),
  );
  const mutate = vi.fn(() => "saved");
  const work = model.withRoomPrivacyMutation(mutate, "native-pending");
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "control_privacy_projection_begin",
      expect.objectContaining({ workspaceRequestId: "native-pending" }),
    ),
  );
  expect(mutate).not.toHaveBeenCalled();
  release();
  await expect(work).resolves.toBe("saved");
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_begin"
      ? Promise.reject(new Error("drain failed"))
      : Promise.resolve({ revision: 2 }),
  );
  const rejected = vi.fn();
  await expect(model.withRoomPrivacyMutation(rejected)).rejects.toThrow("drain failed");
  expect(rejected).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValue({ revision: 3 });
  await expect(model.withRoomPrivacyMutation(rejected)).rejects.toThrow("drain failed");
  expect(rejected).not.toHaveBeenCalled();
  const failedBegin = mocks.invoke.mock.calls
    .filter(([command]) => command === "control_privacy_projection_begin")
    .at(-1)![1];
  model.retryRoomPrivacyProjection();
  await vi.waitFor(() =>
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null }),
  );
  const begins = mocks.invoke.mock.calls.filter(
    ([command]) => command === "control_privacy_projection_begin",
  );
  expect(begins.at(-1)![1]).toEqual(failedBegin);
  expect(rejected).not.toHaveBeenCalled();
  const token = await model.withRoomPrivacyMutation((issued) => {
    expect(() => model.requirePrivacyMutationToken(issued)).not.toThrow();
    return issued;
  });
  expect(() => model.requirePrivacyMutationToken(token)).toThrow(
    "Privacy mutation token is no longer active.",
  );
});

it("does not run a later queued mutation after an earlier begin fails", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve({ revision: 1 })
      : Promise.resolve({ revision: 2 }),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  let rejectBegin!: (error: Error) => void;
  mocks.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_begin"
      ? new Promise((_, reject) => {
          rejectBegin = reject;
        })
      : Promise.resolve({ revision: 2 }),
  );
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

it("keeps a held failure visible when retry cannot run on an inactive window", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  const model = await import("./roomPrivacyProjection");
  model.failRoomPrivacyProjection(new Error("held"));
  model.retryRoomPrivacyProjection();
  expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: "held" });
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("keeps privacy open when the change itself fails after its projection committed", async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve({ revision: command === "control_privacy_projection_read" ? 1 : 2 }),
  );
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(model.getRoomPrivacyStatus().pending).toBe(false));
  const unreachable = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
  const failing = () => Promise.reject(new Error(unreachable));
  await expect(model.withRoomPrivacyMutation(failing)).rejects.toThrow(unreachable);
  expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
  await expect(model.withRoomPrivacyMutation(() => "folder")).resolves.toBe("folder");
  model.deactivateRoomPrivacyProjection();
});

const BUSY = "RPC_WS_OVERLOAD: Host read capacity is busy; retry later.";
function transitions() {
  return mocks.invoke.mock.calls.filter(
    ([command]) => command === "control_privacy_projection_transition",
  );
}
async function startBusy(transition: (n: number) => unknown) {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  let n = 0;
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "control_privacy_projection_read") return Promise.resolve({ revision: 4 });
    return Promise.resolve().then(() => {
      const result = transition(++n);
      if (result instanceof Error) throw result;
      return result;
    });
  });
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  return model;
}

it("retries a transient Host overload automatically under the same operation", async () => {
  const model = await startBusy((n) => (n < 3 ? new Error(BUSY) : { revision: 5 }));
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: true, error: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: true, error: null });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
    const calls = transitions();
    expect(calls).toHaveLength(3);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(calls[2][1]).toEqual(calls[0][1]);
    expect(calls[0][1].operationId).toBeTruthy();
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

it("holds a non-transient failure without retrying", async () => {
  const model = await startBusy(() => new Error("unknown"));
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(model.getRoomPrivacyStatus().error).toBe("unknown");
    expect(transitions()).toHaveLength(1);
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

it("holds the overload once automatic retries are exhausted", async () => {
  const model = await startBusy(() => new Error(BUSY));
  try {
    await vi.advanceTimersByTimeAsync(31_000);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: BUSY });
    expect(transitions()).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transitions()).toHaveLength(6);
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

const INTERRUPTED =
  "RPC_WS_INTERRUPTED: Native Host connection did not return a result. The operation outcome is unknown; reconcile its command receipt before retrying.";
/** Settled unsent while the Host was down, for example during a Host update. */
const UNDISPATCHED = "RPC_WS_DEADLINE: Host request deadline elapsed before dispatch";
/** Active projection whose native commands fail with `message` when `fail` says so. */
async function startInterrupted(
  fail: (command: string, call: number) => boolean,
  message = INTERRUPTED,
) {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.invoke.mockReset();
  mocks.scope.mockReturnValue({ stableStorageKeys: { groups: [] } });
  const calls: Record<string, number> = {};
  mocks.invoke.mockImplementation((command: string) => {
    calls[command] = (calls[command] ?? 0) + 1;
    if (command === "control_privacy_projection_read") return Promise.resolve({ revision: 4 });
    if (fail(command, calls[command])) return Promise.reject(new Error(message));
    return Promise.resolve(
      command === "control_privacy_projection_transition" ? { revision: 5 } : undefined,
    );
  });
  const model = await import("./roomPrivacyProjection");
  model.activateRoomPrivacyProjection();
  await vi.advanceTimersByTimeAsync(0);
  expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
  return model;
}

it("keeps an applied change and reconciles an interrupted commit under the same operation", async () => {
  // Transition 1 is the activation drain; the change's own commit (2) and its first replay (3)
  // lose their native result, as when the native Host connection stalls or is replaced.
  const model = await startInterrupted(
    (command, call) => command === "control_privacy_projection_transition" && call > 1 && call < 4,
  );
  try {
    const apply = vi.fn(() => "unlocked");
    const result = model.withRoomPrivacyMutation(apply);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("unlocked");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: true, error: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
    const calls = transitions();
    expect(calls).toHaveLength(4);
    expect(calls[2][1]).toEqual(calls[1][1]);
    expect(calls[3][1]).toEqual(calls[1][1]);
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

it("refuses a change whose begin was interrupted and reconciles that begin in the background", async () => {
  const model = await startInterrupted(
    (command, call) => command === "control_privacy_projection_begin" && call === 1,
  );
  try {
    const apply = vi.fn(() => "unlocked");
    const result = model.withRoomPrivacyMutation(apply);
    const refused = expect(result).rejects.toThrow(INTERRUPTED);
    await vi.advanceTimersByTimeAsync(0);
    await refused;
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
    const begins = mocks.invoke.mock.calls.filter(
      ([command]) => command === "control_privacy_projection_begin",
    );
    expect(begins).toHaveLength(2);
    expect(begins[1][1]).toEqual({ operationId: begins[0][1].operationId });
    await expect(model.withRoomPrivacyMutation(() => "next")).resolves.toBe("next");
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

it.each([
  UNDISPATCHED,
  "RPC_WS_UNAVAILABLE: Host connection is unavailable before dispatch",
])("replays a begin that was settled unsent before dispatch instead of holding it: %s", async (
  message,
) => {
  const model = await startInterrupted(
    (command, call) => command === "control_privacy_projection_begin" && call === 1,
    message,
  );
  try {
    const refused = expect(model.withRoomPrivacyMutation(() => "unlocked")).rejects.toThrow(
      message,
    );
    await vi.advanceTimersByTimeAsync(0);
    await refused;
    await vi.advanceTimersByTimeAsync(0);
    expect(model.getRoomPrivacyStatus()).toEqual({ pending: false, error: null });
    await expect(model.withRoomPrivacyMutation(() => "next")).resolves.toBe("next");
  } finally {
    model.deactivateRoomPrivacyProjection();
    vi.useRealTimers();
  }
});

it("stops waiting to retry when the window deactivates", async () => {
  const model = await startBusy(() => new Error(BUSY));
  try {
    await vi.advanceTimersByTimeAsync(0);
    model.deactivateRoomPrivacyProjection();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(model.getRoomPrivacyStatus().error).toBe("Room privacy window is unavailable.");
    expect(transitions()).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

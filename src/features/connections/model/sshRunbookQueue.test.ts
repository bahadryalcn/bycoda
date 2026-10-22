// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  pending: vi.fn(),
  list: vi.fn(),
  trigger: vi.fn(),
  start: vi.fn(),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("./sshRunbooks", () => ({
  pendingSshRunbookIntents: native.pending,
  listSshRunbooks: native.list,
  triggerSshRunbookIntent: native.trigger,
  startSshRunbook: native.start,
}));
const intent = {
  id: "intent-1",
  automationId: "book",
  revision: 2,
  trigger: "scheduled",
  createdAt: 1,
  status: "pendingReview",
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  native.pending.mockResolvedValue([intent]);
  native.trigger.mockResolvedValue(intent);
});
it("deduplicates overlapping native pending polls without executing or triggering", async () => {
  const queue = await import("./sshRunbookQueue");
  let answer: (value: any) => void = () => {};
  native.pending.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const first = queue.refreshSshRunbookQueue();
  const second = queue.refreshSshRunbookQueue();
  expect(second).toBe(first);
  expect(native.pending).toHaveBeenCalledOnce();
  answer([intent]);
  await first;
  expect(queue.useSshRunbookQueue()).toEqual({ intents: [intent], error: "" });
  expect(native.trigger).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
});
it("keeps the last native intent projection on failures and clears the error on recovery", async () => {
  const queue = await import("./sshRunbookQueue");
  await queue.refreshSshRunbookQueue();
  native.pending.mockRejectedValueOnce(new Error("offline"));
  await queue.refreshSshRunbookQueue();
  expect(queue.useSshRunbookQueue()).toEqual({ intents: [intent], error: "Error: offline" });
  native.pending.mockResolvedValueOnce([]);
  await queue.refreshSshRunbookQueue();
  expect(queue.useSshRunbookQueue()).toEqual({ intents: [], error: "" });
  expect(native.start).not.toHaveBeenCalled();
});
it("filters explicit startup associations and creates pending metadata only", async () => {
  native.list.mockResolvedValue([
    { id: "matched", revision: 5, triggers: { startupServerIds: ["server"] } },
    { id: "other", revision: 7, triggers: { startupServerIds: ["elsewhere"] } },
    { id: "manual", revision: 1, triggers: null },
  ]);
  const queue = await import("./sshRunbookQueue");
  await queue.requestSshStartupReviews("server");
  expect(native.trigger).toHaveBeenCalledExactlyOnceWith("matched", 5, "server");
  expect(native.pending).toHaveBeenCalledOnce();
  expect(native.start).not.toHaveBeenCalled();
});
it("retains visible pending reviews when startup association lookup fails", async () => {
  const queue = await import("./sshRunbookQueue");
  await queue.refreshSshRunbookQueue();
  native.list.mockRejectedValueOnce(new Error("definitions unavailable"));
  await queue.requestSshStartupReviews("server");
  expect(queue.useSshRunbookQueue()).toEqual({
    intents: [intent],
    error: "Error: definitions unavailable",
  });
  expect(native.trigger).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
});
it("rejects non-pending native records without replacing the previous projection", async () => {
  const queue = await import("./sshRunbookQueue");
  await queue.refreshSshRunbookQueue();
  native.pending.mockResolvedValueOnce([{ ...intent, status: "consumed" }]);
  await queue.refreshSshRunbookQueue();
  expect(queue.useSshRunbookQueue()).toEqual({
    intents: [intent],
    error: "Error: Invalid SSH review queue",
  });
});

it("rejects malformed revisions, trigger kinds and duplicate intent identities", async () => {
  const queue = await import("./sshRunbookQueue");
  await queue.refreshSshRunbookQueue();
  for (const records of [
    [{ ...intent, revision: NaN }],
    [{ ...intent, revision: 1.5 }],
    [{ ...intent, trigger: "unknown" }],
    [intent, { ...intent }],
  ]) {
    native.pending.mockResolvedValueOnce(records);
    await queue.refreshSshRunbookQueue();
    expect(queue.useSshRunbookQueue()).toEqual({
      intents: [intent],
      error: "Error: Invalid SSH review queue",
    });
  }
  expect(native.start).not.toHaveBeenCalled();
});

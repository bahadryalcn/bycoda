import { expect, it, vi } from "vitest";
import { VoiceToolActivity, type VoiceToolActivityEntry } from "./voiceToolActivity";
it("stops observation without claiming effect cancellation, retains original request and accepts late result", async () => {
  let entries: readonly VoiceToolActivityEntry[] = [];
  const activity = new VoiceToolActivity((value) => {
    entries = value;
  });
  let resolve!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const result = activity.run(
    { name: "tasks.start", target: "Project", projectPath: "/p", requestId: "original-request" },
    execute,
  );
  await Promise.resolve();
  activity.stopWaiting(entries[0].id);
  expect(await result).toMatchObject({ status: "uncertain", requestId: "original-request" });
  expect(entries[0].state).toBe("uncertain");
  resolve({ status: "queued" });
  await vi.waitFor(() =>
    expect(entries[0]).toMatchObject({ state: "returned", outcome: "queued" }),
  );
  expect(execute).toHaveBeenCalledOnce();
});
it("bounds a hung observer and consumes late failures without replay", async () => {
  vi.useFakeTimers();
  let entries: readonly VoiceToolActivityEntry[] = [];
  const activity = new VoiceToolActivity((value) => {
    entries = value;
  });
  let reject!: (cause: unknown) => void;
  const result = activity.run(
    { name: "files.write", target: "Project", projectPath: "/p" },
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await vi.advanceTimersByTimeAsync(35_000);
  expect(await result).toMatchObject({ status: "uncertain", observationId: entries[0].id });
  reject(new Error("connection lost"));
  await Promise.resolve();
  expect(entries[0].state).toBe("uncertain");
  vi.useRealTimers();
});
it("waits beyond the network deadline only after an explicit owner card is mounted", async () => {
  vi.useFakeTimers();
  let entries: readonly VoiceToolActivityEntry[] = [];
  const activity = new VoiceToolActivity((value) => {
    entries = value;
  });
  let finish!: (value: unknown) => void;
  const result = activity.run(
    { name: "present_choices", target: "Project", projectPath: "/p" },
    (_active, waitForOwner) => {
      waitForOwner();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(entries[0].state).toBe("waiting-owner");
  finish({ status: "answered" });
  expect(await result).toEqual({ status: "answered" });
  vi.useRealTimers();
});
it.each([
  [{ state: "uncertain" }, "uncertain", "uncertain"],
  [{ state: "pending" }, "uncertain", "pending"],
  [{ status: "pending" }, "uncertain", "pending"],
  [{ state: "failed", error: "Approval required" }, "failed", "failed"],
  [{ state: "completed" }, "returned", "completed"],
  [{ error: "Action rejected" }, "failed", undefined],
  [{ result: { state: "completed" } }, "returned", undefined],
])(
  "reports receipt state without inventing operation completion from nested data: %j",
  async (result, state, outcome) => {
    let entries: readonly VoiceToolActivityEntry[] = [];
    const activity = new VoiceToolActivity((value) => {
      entries = value;
    });
    await activity.run(
      { name: "preferences.set", target: "Project", projectPath: "/p" },
      async () => result,
    );
    expect(entries[0]).toMatchObject({ state, outcome });
  },
);
it("bounds unresolved history while returning every original request identity and releasing observer timers", async () => {
  vi.useFakeTimers();
  try {
    let entries: readonly VoiceToolActivityEntry[] = [];
    const activity = new VoiceToolActivity((value) => {
      entries = value;
    });
    const observations = Array.from({ length: 25 }, (_, index) =>
      activity.run(
        {
          name: "preferences.set",
          target: "Project",
          projectPath: "/p",
          requestId: `original-${index}`,
        },
        () => new Promise(() => undefined),
      ),
    );
    await vi.advanceTimersByTimeAsync(35_000);
    const receipts = await Promise.all(observations);
    expect(receipts.map((receipt) => (receipt as { requestId: string }).requestId)).toEqual(
      Array.from({ length: 25 }, (_, index) => `original-${index}`),
    );
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ requestId: "original-5", state: "uncertain" });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

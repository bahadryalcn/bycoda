// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadStoredQueue, setSessionQueue } from "../../sessions/data/sessionStore";
import { resetRemoteQueuesForTests, useRemoteQueue } from "./useRemoteQueue";

vi.mock("../../sessions/data/sessionStore", () => ({
  loadStoredQueue: vi.fn(),
  setSessionQueue: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
let queue: ReturnType<typeof useRemoteQueue>;
function Probe({ owner }: { owner: string }) {
  queue = useRemoteQueue(owner);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  resetRemoteQueuesForTests();
  vi.mocked(setSessionQueue).mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["timer", "focus", "online"])(
  "recovers an unread saved queue on %s without writing or releasing it",
  async (event) => {
    vi.useFakeTimers();
    const stored = [{ id: "old", text: "saved draft", attachments: [] }];
    vi.mocked(loadStoredQueue)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(stored);
    await act(async () => root.render(createElement(Probe, { owner: "saved" })));
    expect(queue.loaded).toBe(false);
    await act(async () => {
      if (event === "timer") await vi.advanceTimersByTimeAsync(6_000);
      else window.dispatchEvent(new Event(event));
    });
    expect(queue.loaded).toBe(true);
    expect(queue.error).toBeUndefined();
    expect(queue.queue.status).toBe("restored");
    expect(queue.queue.messages).toEqual(stored);
    expect(setSessionQueue).not.toHaveBeenCalled();
  },
);

it("holds a failed storage read without overwriting the unread queue and recovers on retry", async () => {
  vi.mocked(loadStoredQueue).mockRejectedValueOnce(new Error("storage unavailable"));
  await act(async () => root.render(createElement(Probe, { owner: "saved" })));
  expect(queue.loaded).toBe(false);
  expect(queue.error).toBe("storage unavailable");
  await act(async () => {
    queue.enqueue({ id: "new", text: "new draft", attachments: [] });
    queue.release();
  });
  expect(setSessionQueue).not.toHaveBeenCalled();
  const stored = [
    {
      id: "old",
      text: "saved draft",
      attachments: [],
      modelTarget: { harness: "codex" as const, model: "gpt", modelSettings: { effort: "high" } },
    },
  ];
  vi.mocked(loadStoredQueue).mockResolvedValueOnce(stored);
  await act(async () => queue.retry());
  expect(queue.loaded).toBe(true);
  expect(queue.error).toBeUndefined();
  expect(queue.queue).toEqual({ messages: stored, status: "restored" });
  expect(setSessionQueue).not.toHaveBeenCalled();
  await act(async () => queue.enqueue({ id: "new", text: "new draft", attachments: [] }));
  expect(setSessionQueue).toHaveBeenCalledWith("saved", [
    ...stored,
    { id: "new", text: "new draft", attachments: [] },
  ]);
});

it("ignores a late storage result after changing the conversation", async () => {
  let finish!: (messages: never[]) => void;
  vi.mocked(loadStoredQueue).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(Probe, { owner: "old" })));
  vi.mocked(loadStoredQueue).mockResolvedValueOnce([]);
  await act(async () => root.render(createElement(Probe, { owner: "new" })));
  await act(async () => finish([{ id: "late", text: "old", attachments: [] }] as never[]));
  expect(queue.queue.messages).toEqual([]);
  await act(async () => queue.enqueue({ id: "new", text: "new", attachments: [] }));
  expect(setSessionQueue).toHaveBeenCalledExactlyOnceWith("new", [
    { id: "new", text: "new", attachments: [] },
  ]);
});

it("undoes removal once with a new identity and preserves a restored hold", async () => {
  const stored = [{ id: "old", text: "saved", attachments: [], deliveryUnknown: true as const }];
  vi.mocked(loadStoredQueue).mockResolvedValueOnce(stored);
  await act(async () => root.render(createElement(Probe, { owner: "undo" })));
  let receipt!: Exclude<ReturnType<typeof queue.removeUndoable>, false>;
  await act(async () => {
    const removed = queue.removeUndoable("old");
    if (!removed) throw new Error("removal failed");
    receipt = removed;
  });
  expect(queue.queue.messages).toEqual([]);
  await act(async () => {
    expect(receipt.undo()).toBe(true);
  });
  expect(queue.queue.messages).toHaveLength(1);
  expect(queue.queue.messages[0]).toMatchObject({ text: "saved", deliveryUnknown: true });
  expect(queue.queue.messages[0].id).not.toBe("old");
  expect(queue.queue.status).toBe("restored");
  const restoredId = queue.queue.messages[0].id;
  await act(async () => {
    queue.remove(restoredId);
    receipt.undo();
  });
  expect(queue.queue.messages).toEqual([]);
});

it.each(["chronological", "reverse"] as const)(
  "keeps the original order across several removals undone in %s order",
  async (order) => {
    const rows = ["a", "b", "c"].map((id) => ({ id, text: id, attachments: [] }));
    vi.mocked(loadStoredQueue).mockResolvedValueOnce(rows);
    await act(async () => root.render(createElement(Probe, { owner: `undo-${order}` })));
    const receipts: Exclude<ReturnType<typeof queue.removeUndoable>, false>[] = [];
    await act(async () => {
      for (const row of rows) {
        const receipt = queue.removeUndoable(row.id);
        if (!receipt) throw new Error("removal failed");
        receipts.push(receipt);
      }
    });
    if (order === "reverse") receipts.reverse();
    for (const receipt of receipts)
      await act(async () => {
        expect(receipt.undo()).toBe(true);
      });
    expect(queue.queue.messages.map((row) => row.text)).toEqual(["a", "b", "c"]);
  },
);

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
  vi.unstubAllGlobals();
});

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

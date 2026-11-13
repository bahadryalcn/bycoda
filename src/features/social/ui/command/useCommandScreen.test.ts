// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { useCommandScreen } from "./useCommandScreen";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const plan = { planId: "one", steps: [] };
function makeClient() {
  const ai = {
    summary: vi.fn(async () => ({ sentToday: 1 })),
    actions: vi.fn(async (_input?: { cursor?: string }) => ({
      items: [] as { id: string; at: number }[],
      next: undefined as string | undefined,
    })),
    command: vi.fn(async (_input: unknown) => plan),
    runPlan: vi.fn(async (_input: unknown) => ({
      results: [] as { stepId: string; status: string }[],
    })),
    report: vi.fn(async () => ({ done: [], results: [], suggestions: [] })),
    undo: vi.fn(async () => ({})),
  };
  return { ai, request: vi.fn() };
}
let root: Root;
let state!: ReturnType<typeof useCommandScreen>;
function render(client: ReturnType<typeof makeClient>, projectId = "p1", active = true) {
  // Keep component identity stable across scope/activation changes.
  act(() => root.render(createElement(StableProbe, { client, projectId, active })));
}
function StableProbe({
  client,
  projectId,
  active,
}: {
  client: ReturnType<typeof makeClient>;
  projectId: string;
  active: boolean;
}) {
  state = useCommandScreen(client as unknown as SocialClient, projectId, active);
  return null;
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("serializes conflicting operations even before React renders busy state", async () => {
  const client = makeClient();
  const pending = deferred<typeof plan>();
  client.ai.command.mockReturnValueOnce(pending.promise);
  render(client);
  await settle();
  act(() => state.setText("First"));
  await act(async () => {
    void state.submit();
    void state.submit();
    state.loadReport("week");
  });
  expect(client.ai.command).toHaveBeenCalledTimes(1);
  expect(client.ai.report).not.toHaveBeenCalled();
  await act(async () => pending.resolve(plan));
  expect(state.busy).toBeUndefined();
});

it("blocks new planning during execution and binds results to that plan", async () => {
  const client = makeClient();
  const running = deferred<{ results: { stepId: string; status: string }[] }>();
  client.ai.runPlan.mockReturnValueOnce(running.promise);
  render(client);
  await settle();
  act(() => state.setText("First"));
  await act(async () => {
    await state.submit();
  });
  act(() => state.runPlan());
  act(() => state.setText("Second"));
  await act(async () => {
    await state.submit();
  });
  expect(client.ai.command).toHaveBeenCalledTimes(1);
  await act(async () => running.resolve({ results: [{ stepId: "s1", status: "done" }] }));
  expect(state.plan?.planId).toBe("one");
  expect(state.results.s1?.status).toBe("done");
  expect(state.text).toBe("Second");
});

it.each(["resolve", "reject"] as const)(
  "rejects stale planning %s after changing project",
  async (outcome) => {
    const client = makeClient();
    const old = deferred<typeof plan>();
    client.ai.command.mockReturnValueOnce(old.promise);
    render(client);
    await settle();
    act(() => state.setText("Keep local input"));
    act(() => {
      void state.submit();
    });
    render(client, "p2");
    await settle();
    await act(async () => {
      if (outcome === "resolve") old.resolve(plan);
      else old.reject(new Error("Old scope error"));
    });
    expect(state.plan).toBeUndefined();
    expect(state.error).toBeUndefined();
    expect(state.text).toBe("");
    render(client, "p1");
    await settle();
    expect(state.text).toBe(outcome === "resolve" ? "" : "Keep local input");
    expect(state.busy).toBeUndefined();
  },
);

it("discards old execution results when project changes and permits work in the new scope", async () => {
  const client = makeClient();
  const old = deferred<{ results: { stepId: string; status: string }[] }>();
  client.ai.runPlan.mockReturnValueOnce(old.promise);
  render(client);
  await settle();
  act(() => state.setText("One"));
  await act(async () => {
    await state.submit();
  });
  act(() => state.runPlan());
  render(client, "p2");
  await settle();
  act(() => state.setText("Two"));
  await act(async () => {
    await state.submit();
  });
  await act(async () => old.resolve({ results: [{ stepId: "old", status: "done" }] }));
  expect(client.ai.command).toHaveBeenLastCalledWith({ text: "Two", projectId: "p2" });
  expect(state.results).toEqual({});
});

it("appends cursor pages without duplicates and retains older rows through refresh", async () => {
  const client = makeClient();
  client.ai.actions
    .mockResolvedValueOnce({ items: [{ id: "head", at: 3 }], next: "cursor-1" })
    .mockResolvedValueOnce({
      items: [
        { id: "head", at: 3 },
        { id: "old", at: 1 },
      ],
      next: "cursor-2",
    })
    .mockResolvedValueOnce({
      items: [
        { id: "new", at: 4 },
        { id: "head", at: 3 },
      ],
      next: "new-head",
    });
  render(client);
  await settle();
  await act(async () => {
    await state.loadMore();
  });
  expect(client.ai.actions).toHaveBeenLastCalledWith({ cursor: "cursor-1" });
  expect(state.actions?.map((item) => item.id)).toEqual(["head", "old"]);
  await act(async () => {
    await state.refresh();
  });
  expect(state.actions?.map((item) => item.id)).toEqual(["new", "head", "old"]);
  expect(state.next).toBe("cursor-2");
});

it("keeps rows and exact cursor on continuation error and retries it", async () => {
  const client = makeClient();
  client.ai.actions
    .mockResolvedValueOnce({ items: [{ id: "head", at: 3 }], next: "cursor" })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ items: [{ id: "old", at: 1 }], next: undefined });
  render(client);
  await settle();
  await act(async () => {
    await state.loadMore();
  });
  expect(state.moreError).toBe("Offline");
  expect(state.actions?.[0]?.id).toBe("head");
  expect(state.next).toBe("cursor");
  await act(async () => {
    await state.loadMore();
  });
  expect(state.next).toBeUndefined();
  expect(state.activityError).toBeUndefined();
  expect(state.moreError).toBeUndefined();
  expect(state.actions).toHaveLength(2);
});

it("refreshes on activation and while visible, pauses hidden polling, and retries partial read errors", async () => {
  vi.useFakeTimers();
  const client = makeClient();
  client.ai.actions.mockRejectedValueOnce(new Error("Offline"));
  render(client, "p1", false);
  await settle();
  expect(client.ai.actions).not.toHaveBeenCalled();
  render(client);
  await settle();
  expect(state.activityError).toBe("Could not load AI activity.");
  expect(state.summary).toMatchObject({ sentToday: 1 });
  await act(async () => {
    await state.refresh();
  });
  expect(state.activityError).toBeUndefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(client.ai.actions).toHaveBeenCalledTimes(3);
  render(client, "p1", false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(client.ai.actions).toHaveBeenCalledTimes(3);
  render(client);
  await settle();
  expect(client.ai.actions).toHaveBeenCalledTimes(4);
});

it("ignores stale activity and pagination results from another Host", async () => {
  const client = makeClient();
  const old = deferred<{ items: { id: string; at: number }[]; next: string | undefined }>();
  client.ai.actions.mockReturnValueOnce(old.promise);
  render(client);
  await settle();
  render(makeClient());
  await settle();
  await act(async () => old.resolve({ items: [{ id: "old-host", at: 1 }], next: "old" }));
  expect(state.actions).toEqual([]);
  expect(state.next).toBeUndefined();
});

it("reaches activity older than 50 entries and serializes continuation clicks", async () => {
  const client = makeClient();
  const next = deferred<{ items: { id: string; at: number }[]; next: string | undefined }>();
  client.ai.actions
    .mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({ id: `entry-${index}`, at: 100 - index })),
      next: "after-50",
    })
    .mockReturnValueOnce(next.promise);
  render(client);
  await settle();
  await act(async () => {
    void state.loadMore();
    void state.loadMore();
  });
  expect(client.ai.actions).toHaveBeenCalledTimes(2);
  expect(client.ai.actions).toHaveBeenLastCalledWith({ cursor: "after-50" });
  await act(async () => next.resolve({ items: [{ id: "entry-50", at: 1 }], next: undefined }));
  expect(state.actions).toHaveLength(51);
  expect(state.actions?.at(-1)?.id).toBe("entry-50");
});

it("retains scoped report results and draft text after switching away during generation", async () => {
  const client = makeClient();
  const report = deferred<{ done: never[]; results: never[]; suggestions: never[] }>();
  client.ai.report.mockReturnValueOnce(report.promise);
  render(client);
  await settle();
  act(() => state.setText("Original project text"));
  act(() => state.loadReport("week"));
  render(client, "p2");
  await settle();
  act(() => state.setText("New project text"));
  await act(async () => report.resolve({ done: [], results: [], suggestions: [] }));
  expect(state.report).toBeUndefined();
  expect(state.text).toBe("New project text");
  render(client);
  await settle();
  expect(state.text).toBe("Original project text");
  expect(state.report?.period).toBe("week");
});

it("refreshes through StrictMode lifecycle replay without waiting for the next poll", async () => {
  const client = makeClient();
  const old = deferred<{ items: { id: string; at: number }[]; next: string | undefined }>();
  client.ai.actions
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [{ id: "current", at: 2 }], next: undefined });
  act(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(StableProbe, { client, projectId: "p1", active: true }),
      ),
    ),
  );
  await settle();
  expect(state.actions?.map((item) => item.id)).toEqual(["current"]);
  await act(async () => old.resolve({ items: [{ id: "discarded", at: 1 }], next: undefined }));
  expect(state.actions?.map((item) => item.id)).toEqual(["current"]);
});

it.each([undefined, "old-tail"])(
  "reaches intervening activity after head refresh with old continuation %s",
  async (oldTail) => {
    const client = makeClient();
    client.ai.actions
      .mockResolvedValueOnce({ items: [{ id: "old-head", at: 3 }], next: "older" })
      .mockResolvedValueOnce({ items: [{ id: "old-row", at: 1 }], next: oldTail })
      .mockResolvedValueOnce({ items: [{ id: "new-head", at: 9 }], next: "gap" })
      .mockResolvedValueOnce({ items: [{ id: "middle", at: 7 }], next: "reconnect" })
      .mockResolvedValueOnce({ items: [{ id: "new-head", at: 9 }], next: "gap" })
      .mockResolvedValueOnce({
        items: [
          { id: "old-head", at: 3 },
          { id: "old-row", at: 1 },
        ],
        next: "tail",
      })
      .mockResolvedValueOnce({ items: [{ id: "oldest", at: 0 }], next: undefined });
    render(client);
    await settle();
    await act(async () => {
      await state.loadMore();
    });
    await act(async () => {
      await state.refresh();
    });
    expect(state.next).toBe("gap");
    expect(state.actions?.map((item) => item.id)).toEqual(["new-head", "old-head", "old-row"]);
    await act(async () => {
      await state.loadMore();
    });
    expect(client.ai.actions).toHaveBeenLastCalledWith({ cursor: "gap" });
    await act(async () => {
      await state.refresh();
    });
    expect(state.next).toBe("reconnect");
    await act(async () => {
      await state.loadMore();
    });
    await act(async () => {
      await state.loadMore();
    });
    expect(state.actions?.map((item) => item.id)).toEqual([
      "new-head",
      "middle",
      "old-head",
      "old-row",
      "oldest",
    ]);
    expect(state.next).toBeUndefined();
  },
);

it("serializes a head refresh behind pending continuation so old tail cannot replace its gap cursor", async () => {
  const client = makeClient();
  const tail = deferred<{ items: { id: string; at: number }[]; next: string | undefined }>();
  client.ai.actions
    .mockResolvedValueOnce({ items: [{ id: "old-head", at: 3 }], next: "older" })
    .mockReturnValueOnce(tail.promise)
    .mockResolvedValueOnce({ items: [{ id: "new-head", at: 9 }], next: "gap" });
  render(client);
  await settle();
  act(() => {
    void state.loadMore();
  });
  await act(async () => {
    await state.refresh();
  });
  expect(client.ai.actions).toHaveBeenCalledTimes(2);
  expect(state.loadingMore).toBe(true);
  await act(async () => tail.resolve({ items: [{ id: "old-row", at: 1 }], next: undefined }));
  await act(async () => {
    await state.refresh();
  });
  expect(client.ai.actions).toHaveBeenCalledTimes(3);
  expect(state.next).toBe("gap");
  expect(state.actions?.map((item) => item.id)).toEqual(["new-head", "old-head", "old-row"]);
});

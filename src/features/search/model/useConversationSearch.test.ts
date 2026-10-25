// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversationSearch } from "./useConversationSearch";
import type { SessionContentResult } from "../../sessions/data/sessionStore";
const { searchSessionContent, cancelSessionSearch } = vi.hoisted(() => ({
  searchSessionContent: vi.fn(),
  cancelSessionSearch: vi.fn(),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  searchSessionContent,
  cancelSessionSearch,
}));
let view: ReturnType<typeof useConversationSearch>;
function Consumer({ query, revision }: { query: string; revision?: string }) {
  view = useConversationSearch(true, { query }, revision);
  return null;
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const empty: SessionContentResult = {
  sessions: [],
  truncated: false,
  pending: 0,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  searchSessionContent.mockReset();
  cancelSessionSearch.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (query: string) => act(async () => root.render(createElement(Consumer, { query })));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it("invalidates completed results immediately after session inventory changes", async () => {
  const result: SessionContentResult = {
    ...empty,
    sessions: [
      {
        sessionId: "deleted",
        cwd: "/project",
        harness: "codex",
        title: "Deleted",
        titleRanges: [],
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        hitCount: 0,
        hits: [],
      },
    ],
  };
  searchSessionContent.mockResolvedValueOnce(result).mockResolvedValueOnce(empty);
  await act(async () =>
    root.render(createElement(Consumer, { query: "hello", revision: "before-delete" })),
  );
  await advance(200);
  expect(view.result.sessions[0]?.sessionId).toBe("deleted");
  await act(async () =>
    root.render(createElement(Consumer, { query: "hello", revision: "after-delete" })),
  );
  expect(view.result.sessions).toHaveLength(0);
  expect(view.loading).toBe(true);
  await advance(200);
  expect(view.result.sessions).toHaveLength(0);
  expect(searchSessionContent).toHaveBeenCalledTimes(2);
});

it("exposes a conversation error and recovers with Retry", async () => {
  searchSessionContent
    .mockRejectedValueOnce(new Error("index unavailable"))
    .mockResolvedValueOnce(empty);
  await render("hello");
  await advance(200);
  expect(view.error).toBe("index unavailable");
  expect(view.loading).toBe(false);
  await act(async () => view.retry());
  await advance(200);
  expect(searchSessionContent).toHaveBeenCalledTimes(2);
  expect(view.error).toBeNull();
});
it("cancels an old query and rejects its late result", async () => {
  let resolve!: (value: SessionContentResult) => void;
  searchSessionContent
    .mockReturnValueOnce(
      new Promise<SessionContentResult>((yes) => {
        resolve = yes;
      }),
    )
    .mockResolvedValueOnce(empty);
  await render("old");
  await advance(200);
  const owner = searchSessionContent.mock.calls[0][0].searchOwner;
  await render("new");
  expect(cancelSessionSearch).toHaveBeenCalledWith(owner);
  await advance(200);
  await act(async () => resolve({ ...empty, pending: 100, truncated: true }));
  expect(view.result).toEqual(empty);
  expect(view.error).toBeNull();
});
it("retains incomplete results if an indexing poll fails and stops polling until Retry", async () => {
  const partial = { ...empty, pending: 1, truncated: true };
  searchSessionContent
    .mockResolvedValueOnce(partial)
    .mockRejectedValueOnce(new Error("poll failed"));
  await render("hello");
  await advance(200);
  await advance(2000);
  expect(view.result).toEqual(partial);
  expect(view.error).toBe("poll failed");
  await advance(6000);
  expect(searchSessionContent).toHaveBeenCalledTimes(2);
});

it("shows healthy committed hits with a background index error and retries only on request", async () => {
  const healthy: SessionContentResult = {
    ...empty,
    pending: 1,
    indexError: "Index failed",
    sessions: [
      {
        sessionId: "healthy",
        cwd: "/repo",
        harness: "codex",
        title: "Healthy",
        titleRanges: [],
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        hitCount: 1,
        hits: [],
      },
    ],
  };
  searchSessionContent
    .mockResolvedValueOnce(healthy)
    .mockResolvedValueOnce({ ...healthy, indexError: undefined })
    .mockResolvedValue(empty);
  await render("needle");
  await advance(200);
  expect(view.result.sessions[0].sessionId).toBe("healthy");
  expect(view.error).toBe("Index failed");
  await advance(6000);
  expect(searchSessionContent).toHaveBeenCalledTimes(1);
  act(() => view.retry());
  await advance(200);
  expect(searchSessionContent.mock.calls[1][0].retryIndex).toBe(true);
  await advance(2000);
  expect(searchSessionContent).toHaveBeenCalledTimes(3);
  expect(searchSessionContent.mock.calls[2][0].retryIndex).toBeUndefined();
});

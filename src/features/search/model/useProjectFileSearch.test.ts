// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectFileSearch } from "./useProjectFileSearch";
import type { ProjectSearchResult } from "./search";

const bridge = vi.hoisted(() => ({ searchProject: vi.fn(), cancelProjectSearch: vi.fn() }));
vi.mock("./search", () => bridge);
let view: ReturnType<typeof useProjectFileSearch>;
function Consumer({ cwd, query }: { cwd: string; query: string }) {
  view = useProjectFileSearch(true, cwd, query);
  return null;
}
let root: Root;
let container: HTMLDivElement;
const result: ProjectSearchResult = {
  matches: [{ path: "/old/a.ts", relative: "a.ts", line: 1, column: 1, preview: "old query" }],
  truncated: false,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  bridge.searchProject.mockReset();
  bridge.cancelProjectSearch.mockReset().mockResolvedValue(undefined);
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
const render = (cwd: string, query: string) =>
  act(async () => root.render(createElement(Consumer, { cwd, query })));
const advance = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

it("hides previous-project and previous-query results before the next request starts", async () => {
  bridge.searchProject.mockResolvedValue(result);
  await render("/old", "old");
  await advance();
  expect(view.result).toEqual(result);
  await render("/new", "old");
  expect(view.result.matches).toEqual([]);
  expect(view.loading).toBe(true);
  await advance();
  await render("/new", "new");
  expect(view.result.matches).toEqual([]);
  expect(view.loading).toBe(true);
});

it("cancels a superseded project request and ignores its late completion", async () => {
  let finish!: (value: ProjectSearchResult) => void;
  bridge.searchProject.mockReturnValueOnce(
    new Promise<ProjectSearchResult>((resolve) => {
      finish = resolve;
    }),
  );
  await render("/old", "old");
  await advance();
  const searchId = bridge.searchProject.mock.calls[0][0].searchId;
  await render("/new", "new");
  expect(bridge.cancelProjectSearch).toHaveBeenCalledWith("/old", searchId);
  await act(async () => finish(result));
  expect(view.result.matches).toEqual([]);
});

it("keeps failure recoverable through Retry", async () => {
  bridge.searchProject
    .mockRejectedValueOnce(new Error("Search unavailable"))
    .mockResolvedValueOnce(result);
  await render("/old", "old");
  await advance();
  expect(view.error).toBe("Search unavailable");
  await act(async () => view.retry());
  await advance();
  expect(view.error).toBeNull();
  expect(view.result).toEqual(result);
});

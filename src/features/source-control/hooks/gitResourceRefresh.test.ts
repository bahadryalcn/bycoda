// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gitBranches, subscribeGitChanged } = vi.hoisted(() => ({
  gitBranches: vi.fn(),
  subscribeGitChanged: vi.fn((_listener: () => void) => () => {}),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitBranches,
  subscribeGitChanged,
  isGitWatched: () => true,
}));
vi.mock("../../connections/model/remoteHealth", () => ({ reportRemoteLoad: vi.fn() }));
vi.mock("../../projects/model/recents", () => ({ isRemoteProjectPath: () => false }));

import { resetGitResourceCache, useGitResource } from "./useGitResource";
import { useProjectBranchesState } from "./useProjectBranches";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGitResourceCache();
  gitBranches.mockReset();
  subscribeGitChanged.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("settles loading when a cached resource remounts inside its refresh interval", async () => {
  const read = vi.fn(async () => "cached result");
  function View() {
    const resource = useGitResource("/resource", "resource", true, read, false, 60_000);
    return createElement("output", null, `${resource.loading}:${resource.data}`);
  }
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toBe("false:cached result");
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(View)));
  expect(read).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("false:cached result");
});

it("re-reads branches when a checkout notification arrives during a read", async () => {
  let first!: (value: unknown) => void;
  let second!: (value: unknown) => void;
  gitBranches
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    );
  function View() {
    const state = useProjectBranchesState("/branch-notification-during-read", true);
    return createElement("output", null, state.branches?.current ?? "loading");
  }
  await act(async () => root.render(createElement(View)));
  const changed = subscribeGitChanged.mock.calls[0]?.[0] as unknown as () => void;
  await act(async () => {
    changed();
    changed();
  });
  expect(gitBranches).toHaveBeenCalledTimes(1);
  await act(async () => first({ current: "main", detached: false, branches: [] }));
  expect(gitBranches).toHaveBeenCalledTimes(2);
  await act(async () => second({ current: "feature", detached: false, branches: [] }));
  expect(container.textContent).toBe("feature");
});

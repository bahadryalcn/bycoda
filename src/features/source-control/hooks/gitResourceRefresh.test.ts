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

it("does not force a fresh cached resource after manually refreshing a different key", async () => {
  const readA = vi.fn(async () => "A");
  const readB = vi.fn(async () => "B");
  let key = "B";
  let resource: ReturnType<typeof useGitResource<string>>;
  function View() {
    resource = useGitResource("/switch", key, true, key === "A" ? readA : readB, false, 60_000);
    return null;
  }
  await act(async () => root.render(createElement(View)));
  key = "A";
  await act(async () => root.render(createElement(View)));
  await act(async () => resource.refresh());
  expect(readA).toHaveBeenCalledTimes(2);
  key = "B";
  await act(async () => root.render(createElement(View)));
  expect(resource!.data).toBe("B");
  expect(readB).toHaveBeenCalledTimes(1);
});

it.each(["resolve", "reject"] as const)(
  "follows a sibling's newer forced read when the superseded read later %ss",
  async (olderOutcome) => {
    let resolveOld!: (value: string) => void;
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (value: string) => void;
    const read = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveOld = resolve;
            rejectOld = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const resources: ReturnType<typeof useGitResource<string>>[] = [];
    function View({ index }: { index: number }) {
      resources[index] = useGitResource("/shared", "shared", true, read, false);
      return createElement("output", null, `${resources[index].data}:${resources[index].error}`);
    }
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(View, { index: 0 }),
          createElement(View, { index: 1 }),
        ),
      ),
    );
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => resources[1].refresh());
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => resolveNew("latest"));
    await act(async () =>
      olderOutcome === "resolve"
        ? resolveOld("obsolete")
        : rejectOld(new Error("obsolete failure")),
    );
    expect(resources.map((resource) => resource.data)).toEqual(["latest", "latest"]);
    expect(resources.map((resource) => resource.error)).toEqual([null, null]);
  },
);

it("preserves the newer forced failure for consumers awaiting superseded success", async () => {
  let resolveOld!: (value: string) => void;
  const read = vi
    .fn<() => Promise<string>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("current failure"));
  const resources: ReturnType<typeof useGitResource<string>>[] = [];
  function View({ index }: { index: number }) {
    resources[index] = useGitResource("/shared-error", "shared-error", true, read, false);
    return null;
  }
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(View, { index: 0 }),
        createElement(View, { index: 1 }),
      ),
    ),
  );
  await act(async () => resources[1].refresh());
  await act(async () => resolveOld("obsolete"));
  expect(resources.map((resource) => resource.data)).toEqual([null, null]);
  expect(resources.map((resource) => resource.error)).toEqual([
    "current failure",
    "current failure",
  ]);
});

it.each(["success", "failure"] as const)(
  "follows the latest %s across completed replacements while an older shared read remains pending",
  async (latestOutcome) => {
    let resolveOld!: (value: string) => void;
    const read = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce("intermediate");
    if (latestOutcome === "success") read.mockResolvedValueOnce("latest");
    else read.mockRejectedValueOnce(new Error("latest failure"));
    const resources: ReturnType<typeof useGitResource<string>>[] = [];
    function View({ index }: { index: number }) {
      resources[index] = useGitResource("/completion-gap", "completion-gap", true, read, false);
      return null;
    }
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(View, { index: 0 }),
          createElement(View, { index: 1 }),
        ),
      ),
    );
    await act(async () => resources[1].refresh());
    expect(resources[1].data).toBe("intermediate");
    await act(async () => resources[1].refresh());
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => resolveOld("obsolete"));
    if (latestOutcome === "success") {
      expect(resources.map((resource) => resource.data)).toEqual(["latest", "latest"]);
      expect(resources.map((resource) => resource.error)).toEqual([null, null]);
    } else {
      expect(resources.map((resource) => resource.error)).toEqual([
        "latest failure",
        "latest failure",
      ]);
      expect(resources[0].data).toBeNull();
      expect(resources[1].data).toBe("intermediate");
    }
  },
);

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

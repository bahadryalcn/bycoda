// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetGitSubmoduleCache, useGitSubmodules } from "./useGitSubmodules";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock("../../../platform/tauri/fs", () => ({
  invokeWorkspace: bridge.invoke,
  subscribeGitChanged: bridge.subscribe,
}));
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useGitSubmodules>;
function Harness({ cwd, enabled = true }: { cwd: string; enabled?: boolean }) {
  const value = useGitSubmodules([cwd], enabled);
  useLayoutEffect(() => {
    current = value;
  }, [value]);
  return createElement("span", null, JSON.stringify(value.modules));
}
beforeEach(() => {
  resetGitSubmoduleCache();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  bridge.invoke.mockReset();
  bridge.subscribe.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = (cwd: string, enabled = true) =>
  act(async () => root.render(createElement(Harness, { cwd, enabled })));

it("renders known submodules synchronously on remount while revalidating and survives failed revalidation", async () => {
  bridge.invoke.mockResolvedValueOnce(["core-pack"]);
  await render("/repo");
  await act(async () => root.unmount());
  root = createRoot(host);
  let reject!: (reason: Error) => void;
  bridge.invoke.mockImplementationOnce(
    () =>
      new Promise<string[]>((_resolve, no) => {
        reject = no;
      }),
  );
  await render("/repo");
  expect(current!.modules["/repo"]).toEqual(["/repo/core-pack"]);
  await act(async () => reject(new Error("offline")));
  expect(current!.modules["/repo"]).toEqual(["/repo/core-pack"]);
  expect(current!.error).toContain("offline");
});

it("keeps connected-machine identity and last good results on refresh failure or while disabled", async () => {
  bridge.invoke.mockResolvedValueOnce(["core-pack", "core-pack/nested"]);
  const cwd = "remote://mac/Users/me/repo";
  await render(cwd);
  expect(bridge.invoke).toHaveBeenCalledWith("git_submodules", { cwd });
  expect(current!.modules[cwd]).toEqual([`${cwd}/core-pack`, `${cwd}/core-pack/nested`]);
  bridge.invoke.mockRejectedValueOnce(new Error("offline"));
  await act(async () => current!.refresh());
  expect(current!.error).toContain("offline");
  expect(current!.modules[cwd]).toHaveLength(2);
  await render(cwd, false);
  expect(current!.modules[cwd]).toHaveLength(2);
});

it("ignores stale responses after changing projects and retries on focus", async () => {
  let resolveOld!: (value: string[]) => void;
  bridge.invoke.mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve) => {
        resolveOld = resolve;
      }),
  );
  await render("/old");
  bridge.invoke.mockResolvedValueOnce(["new-module"]);
  await render("/new");
  await act(async () => resolveOld(["old-module"]));
  expect(current!.modules).toEqual({ "/new": ["/new/new-module"] });
  bridge.invoke.mockResolvedValueOnce(["new-module", "another"]);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(current!.modules["/new"]).toHaveLength(2);
});

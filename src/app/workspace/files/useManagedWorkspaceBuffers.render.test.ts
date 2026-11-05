// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useManagedWorkspaceBuffers } from "./useManagedWorkspaceBuffers";
import type { FilePaneTab } from "../../../features/workspace/model/layout";
const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

it("does not sort/serialize unchanged editor snapshots on unrelated renders and reports new dirty state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const files: FilePaneTab[] = [{ id: "file", path: "/owned/a.ts", cwd: "/owned" }];
  const clean = new Set<string>();
  function Probe({ dirty }: { dirty: ReadonlySet<string>; tick: number }) {
    useManagedWorkspaceBuffers(files, dirty);
    return null;
  }
  const stringify = vi.spyOn(JSON, "stringify");
  const relevant = () =>
    stringify.mock.calls.filter(
      ([value]) => Array.isArray(value) && value[0]?.path === "/owned/a.ts",
    );
  try {
    for (let tick = 0; tick < 12; tick++)
      await act(async () => root.render(createElement(Probe, { dirty: clean, tick })));
    expect(relevant()).toHaveLength(1);
    await act(async () =>
      root.render(createElement(Probe, { dirty: new Set(["file"]), tick: 13 })),
    );
    expect(relevant()).toHaveLength(2);
    expect(native.invoke).toHaveBeenLastCalledWith("managed_workspace_buffers", {
      buffers: [{ path: "/owned/a.ts", dirty: true }],
    });
  } finally {
    await act(async () => root.unmount());
    stringify.mockRestore();
    vi.unstubAllGlobals();
  }
});

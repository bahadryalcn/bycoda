// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRemoteProject } from "./useRemoteProject";
import {
  openRemoteProject,
  rememberRemoteProject,
  remoteProjectFor,
  remoteProjectKey,
  type RemoteProject,
} from "./remoteProjects";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

it("subscribes to both writers and storage changes with stable, equivalent snapshots", async () => {
  const path = remoteProjectKey("env", "/repo");
  const seen: (RemoteProject | undefined)[] = [];
  const root = createRoot(document.createElement("div"));
  function Probe() {
    seen.push(useRemoteProject(path));
    return null;
  }
  try {
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBeUndefined();
    act(() => {
      rememberRemoteProject("env", { id: "first", cwd: "/repo", name: "repo" });
    });
    expect(seen).toHaveLength(2);
    expect(seen.at(-1)).toEqual(remoteProjectFor(path));
    const saved = seen.at(-1);
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(saved);
    const renders = seen.length;
    act(() => {
      rememberRemoteProject("env", { id: "first", cwd: "/repo", name: "repo" });
    });
    expect(seen).toHaveLength(renders);
    await act(async () => {
      await openRemoteProject(async () => ({ id: "second", cwd: "/repo" }), "env", "/repo");
    });
    expect(seen).toHaveLength(renders + 1);
    expect(seen.at(-1)).toEqual(remoteProjectFor(path));
    expect(seen.at(-1)?.projectId).toBe("second");
    act(() => {
      localStorage.setItem(
        "bycoda.remote-projects.v2",
        JSON.stringify({ legacy: { ...saved, projectId: "external" } }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.remote-projects.v2" }));
    });
    expect(seen.at(-1)).toEqual(remoteProjectFor(path));
    expect(seen.at(-1)?.projectId).toBe("external");
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(seen.at(-1)).toBeUndefined();
  } finally {
    act(() => root.unmount());
  }
});

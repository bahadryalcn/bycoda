// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveAdditionalDirs,
  saveSessionAdditionalDirs,
  useSessionAdditionalDirs,
} from "./additionalDirs";
import { projectDisplayName, projectDisplayNameFrom, useProjectLabels } from "./projectNames";
import { rememberProject, useRecents } from "./recents";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function probe<T>(read: () => T) {
  const seen: T[] = [];
  function Probe() {
    seen.push(read());
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    seen,
    rerender: () => act(() => root.render(createElement(Probe))),
  };
}

describe("useProjectLabels", () => {
  it("follows label changes, keeps its identity otherwise, and matches projectDisplayName", () => {
    const { seen, rerender } = probe(useProjectLabels);
    const before = seen.at(-1)!;
    rerender();
    expect(seen.at(-1)).toBe(before);
    act(() => saveTabGroupLabel("/work/web", "Website"));
    expect(seen.at(-1)).not.toBe(before);
    expect(projectDisplayNameFrom("/work/web", seen.at(-1)!)).toBe("Website");
    expect(projectDisplayNameFrom("/work/web", seen.at(-1)!)).toBe(projectDisplayName("/work/web"));
  });
});

describe("useRecents", () => {
  it("follows saved recents and keeps its identity otherwise", async () => {
    const { seen, rerender } = probe(useRecents);
    expect(seen.at(-1)).toEqual([]);
    rerender();
    expect(seen.at(-1)).toBe(seen.at(-2));
    await act(async () => {
      await rememberProject("/work/api");
    });
    expect(seen.at(-1)?.map((item) => item.path)).toEqual(["/work/api"]);
  });
});

describe("useSessionAdditionalDirs", () => {
  it("follows the session's choice and its project's folders", () => {
    const { seen, rerender } = probe(() => useSessionAdditionalDirs("s1", "/work/web"));
    expect(seen.at(-1)).toEqual({ overridden: false, dirs: [], projectDirs: [] });
    rerender();
    expect(seen.at(-1)).toBe(seen.at(-2));
    act(() => saveAdditionalDirs("/work/web", ["/work/api"]));
    expect(seen.at(-1)).toEqual({
      overridden: false,
      dirs: ["/work/api"],
      projectDirs: ["/work/api"],
    });
    act(() => saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui"]));
    expect(seen.at(-1)).toEqual({
      overridden: true,
      dirs: ["/work/ui"],
      projectDirs: ["/work/api"],
    });
  });
});

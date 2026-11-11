// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../../../platform/tauri/fs";
import { ChangeList } from "./GitChangesList";

let container: HTMLDivElement;
let root: Root;
let notify: Array<() => void>;

beforeEach(() => {
  notify = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("probes the row height on mount and density changes, not on a plain resize", async () => {
  const file: GitChangedFile = {
    path: "/repo/a.ts",
    relative: "a.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
  } as GitChangedFile;
  const appended = vi.spyOn(HTMLElement.prototype, "appendChild");
  const probes = () =>
    appended.mock.calls.filter(
      ([node]) =>
        node instanceof HTMLElement && node.style.cssText.includes("--ui-control-height-compact"),
    ).length;
  await act(async () =>
    root.render(
      createElement(
        "ul",
        null,
        createElement(ChangeList, {
          files: [file],
          view: "list",
          kind: "unstaged",
          busy: null,
          onOpenFile: vi.fn(),
          onAction: vi.fn(),
          onFolderAction: vi.fn(),
        }),
      ),
    ),
  );
  const mounted = probes();
  expect(mounted).toBeGreaterThan(0);

  act(() => notify.forEach((callback) => callback()));
  expect(probes()).toBe(mounted);

  await act(async () => {
    document.documentElement.dataset.density = "compact";
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  expect(probes()).toBeGreaterThan(mounted);
  delete document.documentElement.dataset.density;
});

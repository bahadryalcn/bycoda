// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../../../platform/tauri/fs";

const renders = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("../../files/public/FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => {
    renders.names.push(name);
    return null;
  },
}));

import { ChangeList } from "./GitChangesList";

const ROW = 28;
const VIEWPORT = 280;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  container.style.overflowY = "auto";
  Object.defineProperty(container, "clientHeight", { value: VIEWPORT });
  Object.defineProperty(container, "clientWidth", { value: 400 });
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("re-renders only the rows that enter the window while a virtualized list scrolls", async () => {
  const files = Array.from(
    { length: 200 },
    (_, index) =>
      ({
        path: `/repo/file-${index}.ts`,
        relative: `file-${index}.ts`,
        status: "modified",
        additions: 1,
        deletions: 0,
        staged: false,
        unstaged: true,
      }) as GitChangedFile,
  );
  await act(async () =>
    root.render(
      createElement(
        "ul",
        null,
        createElement(ChangeList, {
          files,
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
  const mounted = container.querySelectorAll('[role="row"]').length;
  expect(mounted).toBeGreaterThan(5);
  expect(mounted).toBeLessThan(60);

  renders.names = [];
  const steps = 10;
  for (let step = 1; step <= steps; step++) {
    await act(async () => {
      container.scrollTop = step * ROW;
      container.dispatchEvent(new Event("scroll"));
    });
  }
  // Each step moves the window by one row: one new row may render, the rest keep their output.
  expect(renders.names.length).toBeLessThanOrEqual(steps * 2);
});

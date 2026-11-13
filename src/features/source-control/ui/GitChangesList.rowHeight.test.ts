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

it.each([
  ["list", ["0.5rem"]],
  ["tree", ["calc(0.5rem + 0 * 0.75rem)", "20px"]],
] as const)(
  "preserves the original root-font scaling of %s row indentation",
  async (view, expected) => {
    const file = {
      path: "/repo/src/a.ts",
      relative: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      staged: false,
      unstaged: true,
    } as GitChangedFile;
    await act(async () =>
      root.render(
        createElement(
          "ul",
          null,
          createElement(ChangeList, {
            files: [file],
            view,
            kind: "unstaged",
            busy: null,
            onOpenFile: vi.fn(),
            onAction: vi.fn(),
            onFolderAction: vi.fn(),
          }),
        ),
      ),
    );
    const insets = [...container.querySelectorAll<HTMLElement>("li")]
      .map((row) => row.style.getPropertyValue("--control-padding-start"))
      .filter(Boolean);
    expect(insets).toEqual(expected);
  },
);

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

it("keeps path range selection and focused-row keyboard admission through the list root", async () => {
  const files = ["a.ts", "b.ts", "c.ts"].map(
    (name) =>
      ({
        path: `/repo/${name}`,
        relative: name,
        status: "modified",
        additions: 1,
        deletions: 0,
        staged: false,
        unstaged: true,
      }) as GitChangedFile,
  );
  const onOpenFile = vi.fn();
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
          onOpenFile,
          onAction: vi.fn(),
          onFolderAction: vi.fn(),
        }),
      ),
    ),
  );
  const list = container.querySelector('[role="listbox"]')!;
  expect(list.tagName).toBe("UL");
  const a = list.querySelector<HTMLButtonElement>('[data-git-file="/repo/a.ts"]')!;
  await act(async () => a.click());
  await act(async () =>
    a.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const selected = () =>
    [...list.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]')].map(
      (row) => row.querySelector<HTMLElement>("[data-git-file]")!.dataset.gitFile,
    );
  expect(selected()).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  const b = list.querySelector<HTMLButtonElement>('[data-git-file="/repo/b.ts"]')!;
  expect(document.activeElement).toBe(b);
  await act(async () =>
    b.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(selected()).toEqual(files.map((f) => f.path));
  await act(async () =>
    b.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(selected()).toEqual(["/repo/b.ts"]);
  onOpenFile.mockClear();
  await act(async () =>
    b.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(onOpenFile).toHaveBeenCalledWith("/repo/b.ts", "unstaged", true);
});

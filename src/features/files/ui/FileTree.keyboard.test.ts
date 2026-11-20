// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import { forgetDir, listCachedDir, saveSelected } from "../model/fileTree";
import { treeTabStop } from "./fileTreeSupport";

const cwd = "/explorer-keyboard-test";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async (command: string) =>
    command === "list_dir"
      ? ["a.ts", "b.ts"].map((name) => ({
          name,
          path: `${cwd}/${name}`,
          isDir: false,
          ignored: false,
        }))
      : command === "clipboard_file_paths"
        ? []
        : undefined,
  ),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));

let root: Root;
let host: HTMLDivElement;
const onOpenFile = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  forgetDir(cwd);
  await listCachedDir(cwd);
  saveSelected(cwd, `${cwd}/a.ts`);
  onOpenFile.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(FileTree, { cwd, onOpenFile })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  forgetDir(cwd);
  vi.unstubAllGlobals();
});

const row = () => host.querySelector<HTMLElement>(`[role="treeitem"][title="${cwd}/a.ts"]`)!;

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "does not activate files while IME owns Enter (%j)",
  async (composition) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...composition,
    });
    await act(async () => row().dispatchEvent(event));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    await act(async () =>
      row().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onOpenFile).toHaveBeenCalledWith(`${cwd}/a.ts`, undefined, { exact: true });
  },
);

it("does not typeahead-select another file during composition", async () => {
  const event = new KeyboardEvent("keydown", {
    key: "b",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => row().dispatchEvent(event));
  expect(row().getAttribute("aria-selected")).toBe("true");
  expect(event.defaultPrevented).toBe(false);
});

const rows = () => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const tabStops = () =>
  rows()
    .filter((value) => value.tabIndex === 0)
    .map((value) => value.title);

it("keeps a single Tab stop on the selected row and moves it with arrow navigation", async () => {
  expect(rows().length).toBeGreaterThan(1);
  expect(tabStops()).toEqual([`${cwd}/a.ts`]);
  expect(rows().filter((value) => value.tabIndex === -1)).toHaveLength(rows().length - 1);

  await act(async () =>
    row().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  expect(tabStops()).toEqual([`${cwd}/b.ts`]);
  expect(document.activeElement).toBe(rows().find((value) => value.title === `${cwd}/b.ts`));
});

it("moves the Tab stop to a row that takes focus without changing the multi-selection", async () => {
  const other = rows().find((value) => value.title === `${cwd}/b.ts`)!;
  await act(async () => other.focus());
  expect(tabStops()).toEqual([`${cwd}/b.ts`]);
  expect(row().getAttribute("aria-selected")).toBe("true");
});

it("treeTabStop falls back to the nearest visible ancestor of a hidden active row", () => {
  const dir = "/project";
  expect(treeTabStop(dir, null, new Set())).toBeNull();
  expect(treeTabStop(dir, dir, new Set())).toBeNull();
  expect(treeTabStop(dir, `${dir}/a.ts`, new Set())).toBe(`${dir}/a.ts`);
  expect(treeTabStop(dir, `${dir}/src/ui/a.ts`, new Set([`${dir}/src`, `${dir}/src/ui`]))).toBe(
    `${dir}/src/ui/a.ts`,
  );
  expect(treeTabStop(dir, `${dir}/src/ui/a.ts`, new Set([`${dir}/src`]))).toBe(`${dir}/src/ui`);
  expect(treeTabStop(dir, `${dir}/src/ui/a.ts`, new Set())).toBe(`${dir}/src`);
});

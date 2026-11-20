// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../../../platform/tauri/fs";
import type { ChangesView } from "../../settings";
import { ChangeList } from "./GitChangesList";

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
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const changed = (relative: string) =>
  ({
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
  }) as GitChangedFile;

async function renderList(relatives: string[], view: ChangesView = "list") {
  const files = relatives.map(changed);
  const onOpenFile = vi.fn();
  const onAction = vi.fn();
  const onFolderAction = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "ul",
        null,
        createElement(ChangeList, {
          files,
          view,
          kind: "unstaged",
          busy: null,
          onOpenFile,
          onAction,
          onFolderAction,
        }),
      ),
    ),
  );
  const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
  return { files, grid, onOpenFile, onAction, onFolderAction };
}

const primary = (grid: HTMLElement, relative: string) =>
  grid.querySelector<HTMLButtonElement>(`[data-git-file="/repo/${relative}"]`)!;
const folderButton = (grid: HTMLElement, dir: string) =>
  grid.querySelector<HTMLButtonElement>(`[data-git-row="dir:${dir}"] [role="gridcell"] button`)!;
const press = (target: HTMLElement, key: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

it("exposes rows with independent buttons as a grid, never as options holding buttons", async () => {
  const { grid } = await renderList(["a.ts", "b.ts"]);
  expect(container.querySelector('[role="listbox"], [role="option"]')).toBeNull();
  expect(grid.getAttribute("aria-multiselectable")).toBe("true");
  expect(grid.getAttribute("aria-rowcount")).toBe("2");
  const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"]')];
  expect(rows.map((row) => row.getAttribute("aria-rowindex"))).toEqual(["1", "2"]);
  // Every control lives in a cell, and a row holds nothing else but cells.
  for (const row of rows) {
    expect(row.querySelectorAll("button").length).toBeGreaterThanOrEqual(4);
    for (const button of row.querySelectorAll("button"))
      expect(button.closest('[role="gridcell"]')).not.toBeNull();
  }
});

it("is one Tab stop that follows the focused row, with every inline action out of the Tab order", async () => {
  const { grid } = await renderList(["a.ts", "b.ts", "c.ts"]);
  const stops = () => [...grid.querySelectorAll<HTMLButtonElement>('button[tabindex="0"]')];
  expect(stops()).toEqual([primary(grid, "a.ts")]);
  for (const button of grid.querySelectorAll<HTMLButtonElement>("button"))
    if (button !== primary(grid, "a.ts")) expect(button.tabIndex).toBe(-1);

  await act(async () => primary(grid, "c.ts").focus());
  expect(stops()).toEqual([primary(grid, "c.ts")]);
});

it("moves between a row's controls with the horizontal arrows and between rows with the vertical ones", async () => {
  const { grid, onOpenFile, onAction, files } = await renderList(["a.ts", "b.ts"]);
  const a = primary(grid, "a.ts");
  await act(async () => a.focus());

  await press(a, "ArrowRight");
  const discard = document.activeElement as HTMLButtonElement;
  expect(discard.getAttribute("aria-label")).toBe("Discard Changes");
  await press(discard, "ArrowRight");
  const stage = document.activeElement as HTMLButtonElement;
  expect(stage.getAttribute("aria-label")).toBe("Stage Changes");
  await press(stage, "ArrowRight");
  expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe(
    "Actions for a.ts",
  );
  await press(document.activeElement as HTMLElement, "ArrowLeft");
  expect(document.activeElement).toBe(stage);

  // Enter on an action belongs to the action: it must not open the file or reset the selection.
  onOpenFile.mockClear();
  await press(stage, "Enter");
  expect(onOpenFile).not.toHaveBeenCalled();
  await act(async () => stage.click());
  expect(onAction).toHaveBeenCalledExactlyOnceWith(files[0], "stage");

  // ArrowDown from an action lands on the next row's open button, which becomes the Tab stop.
  await press(stage, "ArrowDown");
  expect(document.activeElement).toBe(primary(grid, "b.ts"));
  expect(primary(grid, "b.ts").tabIndex).toBe(0);
  expect(a.tabIndex).toBe(-1);
  expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("/repo/b.ts", "unstaged");
});

it("reaches folder rows and their stage action by keyboard in tree view", async () => {
  const { grid, onOpenFile, onFolderAction } = await renderList(["src/a.ts", "src/b.ts"], "tree");
  expect(grid.getAttribute("aria-rowcount")).toBe("3");
  const folder = folderButton(grid, "src");
  expect(folder.tabIndex).toBe(0);
  expect(primary(grid, "src/a.ts").tabIndex).toBe(-1);

  await act(async () => folder.focus());
  await press(folder, "ArrowRight");
  const stageFolder = document.activeElement as HTMLButtonElement;
  expect(stageFolder.getAttribute("aria-label")).toBe("Stage Changes in src");
  await act(async () => stageFolder.click());
  expect(onFolderAction).toHaveBeenCalledExactlyOnceWith("src", "stage");

  await press(folder, "ArrowDown");
  expect(document.activeElement).toBe(primary(grid, "src/a.ts"));
  onOpenFile.mockClear();
  await press(primary(grid, "src/a.ts"), "ArrowUp");
  expect(document.activeElement).toBe(folder);
  expect(folder.tabIndex).toBe(0);
  // A folder row takes focus without opening anything.
  expect(onOpenFile).not.toHaveBeenCalled();
});

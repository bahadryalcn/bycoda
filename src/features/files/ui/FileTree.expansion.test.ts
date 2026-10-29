// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "../../../platform/tauri/fs";

const { directories } = vi.hoisted(() => ({
  directories: new Map<string, FsEntry[]>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, string>) => {
    if (command === "list_dir") return directories.get(args.path) ?? [];
    if (command === "clipboard_file_paths") return [];
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async () => () => undefined,
  }),
}));

vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => createElement("span", { "data-icon": name }),
}));

vi.mock("../model/fileTree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/fileTree")>();
  return { ...actual, saveExpanded: vi.fn(actual.saveExpanded) };
});

import { listCachedDir, loadExpanded, refreshDir, saveExpanded } from "../model/fileTree";
import { FileTree } from "./FileTree";

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

function entry(name: string, isDir: boolean, parent = cwd): FsEntry {
  return { name, path: `${parent}/${name}`, isDir, ignored: false };
}

function row(name: string): HTMLButtonElement {
  return container.querySelector(`[role="treeitem"][title="${cwd}/${name}"]`)!;
}

function click(el: HTMLElement) {
  return act(async () => el.click());
}

function renderStrict() {
  return act(async () =>
    root.render(createElement(StrictMode, null, createElement(FileTree, props))),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/expansion-project-${++project}`;
  props = { cwd, onOpenFile: vi.fn() };
  directories.set(cwd, [entry("src", true), entry("docs", true), entry("first.ts", false)]);
  directories.set(`${cwd}/src`, [entry("a.ts", false, `${cwd}/src`)]);
  directories.set(`${cwd}/docs`, [entry("readme.md", false, `${cwd}/docs`)]);
  await listCachedDir(cwd);
  await refreshDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(saveExpanded).mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FileTree expansion under StrictMode", () => {
  it("persists the expanded set once when a directory expands", async () => {
    await renderStrict();
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
    vi.mocked(saveExpanded).mockClear();

    await click(row("src"));

    expect(saveExpanded).toHaveBeenCalledTimes(1);
    const [savedCwd, saved] = vi.mocked(saveExpanded).mock.calls[0];
    expect(savedCwd).toBe(cwd);
    expect([...saved].sort()).toEqual([cwd, `${cwd}/src`].sort());
    // Rendered expansion and the persisted value agree.
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("src/a.ts")).not.toBeNull();
    expect([...loadExpanded(cwd)].sort()).toEqual([cwd, `${cwd}/src`].sort());
  });

  it("persists once per toggle and keeps both directories after two expansions", async () => {
    await renderStrict();
    vi.mocked(saveExpanded).mockClear();

    await click(row("src"));
    expect(saveExpanded).toHaveBeenCalledTimes(1);
    await click(row("docs"));
    expect(saveExpanded).toHaveBeenCalledTimes(2);

    const last = vi.mocked(saveExpanded).mock.calls[1][1];
    expect([...last].sort()).toEqual([cwd, `${cwd}/docs`, `${cwd}/src`].sort());
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("docs").getAttribute("aria-expanded")).toBe("true");
    expect([...loadExpanded(cwd)].sort()).toEqual([cwd, `${cwd}/docs`, `${cwd}/src`].sort());
  });

  it("collapsing persists once and drops only that directory", async () => {
    await renderStrict();
    await click(row("src"));
    await click(row("docs"));
    vi.mocked(saveExpanded).mockClear();

    await click(row("src"));

    expect(saveExpanded).toHaveBeenCalledTimes(1);
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
    expect([...loadExpanded(cwd)].sort()).toEqual([cwd, `${cwd}/docs`].sort());
  });

  it("does not persist on mount, remount, or re-render", async () => {
    await renderStrict();
    await click(row("src"));
    await act(async () => root.render(createElement("div")));
    vi.mocked(saveExpanded).mockClear();

    await renderStrict();
    await renderStrict();

    expect(saveExpanded).not.toHaveBeenCalled();
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
  });
});

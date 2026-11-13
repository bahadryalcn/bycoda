// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FsEntry } from "../../../platform/tauri/fs";
import { forgetDir, listCachedDir, peekDir, saveExpanded } from "../model/fileTree";
import { FileTree } from "./FileTree";

const reads = vi.hoisted(() => vi.fn<(path: string) => Promise<FsEntry[]>>());
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async (command: string, args: Record<string, string>) => {
    if (command === "list_dir") return reads(args.path);
    if (command === "clipboard_file_paths") return [];
    throw new Error(`Unexpected command: ${command}`);
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));

const cwd = "/refresh-project";
const child = `${cwd}/folder`;
let root: Root;
let host: HTMLDivElement;
let directories: Map<string, FsEntry[]>;
const entry = (name: string, parent = cwd, isDir = false): FsEntry => ({
  name,
  path: `${parent}/${name}`,
  isDir,
  ignored: false,
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  forgetDir(cwd);
  saveExpanded(cwd, new Set([cwd, child]));
  directories = new Map([
    [cwd, [entry("folder", cwd, true), entry("old.ts")]],
    [child, [entry("old-child.ts", child)]],
  ]);
  reads.mockReset().mockImplementation(async (path) => directories.get(path) ?? []);
  await Promise.all([cwd, child].map(listCachedDir));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(FileTree, { cwd, onOpenFile: vi.fn() })));
  reads.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  forgetDir(cwd);
  vi.unstubAllGlobals();
});
const refresh = () =>
  act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
  });

it("reads the root and each expanded child once per explicit refresh", async () => {
  directories.set(cwd, [entry("folder", cwd, true), entry("fresh.ts")]);
  directories.set(child, [entry("fresh-child.ts", child)]);
  await refresh();
  expect(reads.mock.calls.filter(([path]) => path === cwd)).toHaveLength(1);
  expect(reads.mock.calls.filter(([path]) => path === child)).toHaveLength(1);
  expect(host.querySelector(`[title="${cwd}/fresh.ts"]`)).not.toBeNull();
  expect(host.querySelector(`[title="${child}/fresh-child.ts"]`)).not.toBeNull();
});

it("keeps the displayed refresh response and cached root on the same read", async () => {
  const previous = directories.get(cwd)!;
  const fresh = [entry("folder", cwd, true), entry("fresh.ts")];
  let rootReads = 0;
  reads.mockImplementation(async (path) =>
    path === cwd ? (++rootReads === 1 ? fresh : previous) : (directories.get(path) ?? []),
  );
  await refresh();
  expect(peekDir(cwd)).toBe(fresh);
  expect(host.querySelector(`[title="${cwd}/fresh.ts"]`)).not.toBeNull();
  expect(host.querySelector(`[title="${cwd}/old.ts"]`)).toBeNull();
});

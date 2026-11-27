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
  vi.useRealTimers();
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

it("keeps the tree readable through an announced five-second Host restart", async () => {
  vi.useFakeTimers();
  const restartAt = Date.now();
  reads.mockImplementation(async (path) => {
    if (path === cwd && Date.now() - restartAt < 5_000) {
      throw Object.assign(new Error("Host is stopping."), { code: "HOST_STOPPING" });
    }
    return directories.get(path) ?? [];
  });
  directories.set(cwd, [entry("fresh.ts")]);
  await refresh();
  expect(
    host.querySelector('[data-remote-data-state="refreshing"][aria-busy="true"]'),
  ).not.toBeNull();
  for (const elapsed of [2_000, 3_000, 1_000]) {
    await act(async () => vi.advanceTimersByTimeAsync(elapsed));
    expect(host.textContent).not.toContain("Host is stopping.");
    expect(host.querySelector('[role="alert"],[data-remote-data-state="stale"]')).toBeNull();
  }
  expect(host.querySelector(`[title="${cwd}/fresh.ts"]`)).not.toBeNull();
});

it("shows a sustained transport error after the grace period, then recovers", async () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  reads.mockImplementation(async (path) => {
    if (path === cwd && Date.now() - startedAt < 11_000) {
      throw new Error("[RPC_HOST_UNAVAILABLE] Host is not running on the machine");
    }
    return directories.get(path) ?? [];
  });
  await refresh();
  expect(host.querySelector('[data-remote-data-state="stale"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(host.querySelector('[data-remote-data-state="stale"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  await act(async () => vi.advanceTimersByTimeAsync(8_000));
  expect(host.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
});

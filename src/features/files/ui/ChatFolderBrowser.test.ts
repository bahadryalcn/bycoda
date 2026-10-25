// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  list: vi.fn(),
  live: vi.fn(),
  copy: vi.fn(),
  open: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  browseDirectory: native.list,
  openLiveRemoteFolder: native.live,
  prepareLocalFileCopy: native.copy,
  openPathWithDefaultApp: native.open,
  pickNativeFolders: native.choose,
  isLocalDirectory: vi.fn(async () => true),
}));
import { ChatFolderBrowser } from "./ChatFolderBrowser";
let root: Root;
let host: HTMLDivElement;
const listing = {
  path: "/fixture",
  parent: "/",
  canOpenFiles: true,
  entries: [{ name: "report.md", path: "/fixture/report.md", isDir: false, ignored: false }],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  native.list.mockReset().mockResolvedValue(listing);
  native.live.mockReset().mockResolvedValue(undefined);
  native.open.mockReset().mockResolvedValue(undefined);
  native.choose.mockReset();
  native.copy.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      createElement(ChatFolderBrowser, { path: "/fixture", onOpenFile: vi.fn(), onClose: vi.fn() }),
    ),
  );
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
it("keeps live-folder progress on its action, suppresses duplicates and recovers after failure", async () => {
  let reject!: (error: Error) => void;
  native.live.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  await render();
  const action = button("Open live folder (read-only)");
  action.focus();
  act(() => {
    action.click();
    action.click();
  });
  expect(native.live).toHaveBeenCalledOnce();
  expect(document.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
  expect(document.activeElement).toBe(action);
  await act(async () => reject(new Error("Connection unavailable")));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection unavailable");
  await act(async () => action.click());
  expect(native.live).toHaveBeenCalledTimes(2);
});
it("retries an unavailable listing in place", async () => {
  native.list.mockRejectedValueOnce(new Error("Folder unavailable"));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Folder unavailable");
  await act(async () => button("Retry").click());
  expect(native.list).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[aria-label="Folder contents"]')?.textContent).toContain(
    "report.md",
  );
});
it("shows only the chosen folder chooser as pending without losing mapping inputs", async () => {
  let finish!: (paths: string[]) => void;
  native.choose.mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () => button("Shared folder settings").click());
  const choose = button("Choose folder…");
  choose.focus();
  act(() => {
    choose.click();
    choose.click();
  });
  expect(native.choose).toHaveBeenCalledOnce();
  expect(choose.getAttribute("aria-busy")).toBe("true");
  await act(async () => finish(["/shared"]));
  expect([...document.querySelectorAll("input")].map((input) => input.value)).toContain("/shared");
});

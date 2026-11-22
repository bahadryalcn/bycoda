// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileLoadError } from "./FileLoadError";

const { readTextFileSlice, unsupported } = vi.hoisted(() => ({
  readTextFileSlice: vi.fn(),
  unsupported: { value: false },
}));

vi.mock("../data/largeTextFile", () => ({ readTextFileSlice }));
vi.mock("../../connections/public/remoteFailure", () => ({
  isUnsupportedRemoteRoute: () => unsupported.value,
}));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false, IS_WIN: true }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  revealPath: vi.fn(),
}));

const REMOTE = "remote://env/repo/data/huge.log";
const TOO_LARGE = "File is too large to edit (12 MB)";

async function mount(path: string, message: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(FileLoadError, { path, message, onRetry: vi.fn() })),
  );
  return {
    host,
    buttons: () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim()),
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  readTextFileSlice.mockReset();
  unsupported.value = false;
  vi.useRealTimers();
});

// #611: a remote file over the editor limit opens as a read-only paged view, not a dead end.
it("pages a too-large remote file read-only instead of showing an error", async () => {
  readTextFileSlice.mockResolvedValue({
    text: "first page",
    offset: 0,
    end: 10,
    size: 30,
    modifiedUs: 1,
  });
  const view = await mount(REMOTE, TOO_LARGE);
  expect(readTextFileSlice).toHaveBeenCalledWith(REMOTE, 0, null);
  expect(view.host.textContent).toContain("first page");
  expect(view.host.textContent).toContain("Read-only preview, too large to edit");
  expect(view.buttons()).toContain("Next");
  expect(view.buttons()).not.toContain("Try again");
  await view.unmount();
});

it("offers Retry after a sustained transport failure while reading a page", async () => {
  vi.useFakeTimers();
  readTextFileSlice.mockRejectedValue(new Error("connection reset"));
  const view = await mount(REMOTE, TOO_LARGE);
  await act(async () => {});
  expect(view.buttons()).not.toContain("Try again");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(readTextFileSlice).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(view.buttons()).toContain("Try again");
  expect(view.host.textContent).toContain("Waiting for the connection");
  await view.unmount();
});

it("hides the useless Retry when the machine cannot serve paged reads", async () => {
  unsupported.value = true;
  readTextFileSlice.mockRejectedValue(new Error("outdated host"));
  const view = await mount(REMOTE, TOO_LARGE);
  await vi.waitFor(() => expect(view.host.textContent).toContain("outdated host"));
  expect(view.buttons()).not.toContain("Try again");
  expect(view.buttons()).toContain("Copy path");
  await view.unmount();
});

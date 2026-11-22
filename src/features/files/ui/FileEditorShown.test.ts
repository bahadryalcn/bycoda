// @vitest-environment happy-dom
import type * as TauriCore from "@tauri-apps/api/core";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";

const calls = vi.hoisted(() => ({
  list: [] as string[],
  read: vi.fn(async () => "one\ntwo\n"),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  invoke: async (command: string) => {
    calls.list.push(command);
    if (command === "read_text_file") return calls.read();
    if (command === "stat_files") return [];
    if (command === "git_diff_files")
      return { files: [{ relative: "notes.txt", staged: false, unstaged: true }] };
    if (command === "git_file_diff") return { original: "one\n", current: "one\ntwo\n" };
    return undefined;
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Storage());
  calls.list = [];
  calls.read.mockReset().mockResolvedValue("one\ntwo\n");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (shown: boolean) =>
  act(async () => {
    root.render(
      createElement(FileEditor, {
        path: "/repo/notes.txt",
        cwd: "/repo",
        active: shown,
        shown,
        showDiff: true,
        changeKind: "unstaged",
        onDirtyChange: () => {},
      }),
    );
  });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
/** Waits until the load count stops changing, past the editor's 150 ms follow-up
 * reload, so a busy runner cannot split mount loads across the measurement. */
async function stableLoads() {
  let previous = -1;
  let current = diffLoads();
  while (current !== previous) {
    previous = current;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    current = diffLoads();
  }
  return current;
}
const diffLoads = () => calls.list.filter((command) => command === "git_file_diff").length;

it("defers review reloads while another tab covers the editor, then catches up once", async () => {
  await render(true);
  const initial = await stableLoads();
  expect(initial).toBeGreaterThan(0);

  await render(false);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  expect(diffLoads()).toBe(initial);

  await render(true);
  await vi.waitFor(() => expect(diffLoads()).toBe(initial + 1));
});

it("keeps reloading on focus while shown", async () => {
  await render(true);
  const initial = await stableLoads();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await vi.waitFor(() => expect(diffLoads()).toBe(initial + 1));
});

it("opens the file after a five-second Host restart without showing a read error", async () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  calls.read.mockImplementation(async () => {
    if (Date.now() - startedAt < 5_000) {
      throw Object.assign(new Error("Host is stopping."), { code: "HOST_STOPPING" });
    }
    return "one\ntwo\n";
  });
  await render(true);
  expect(container.textContent).toContain("Opening notes.txt…");
  for (const elapsed of [2_000, 3_000, 1_000]) {
    await act(async () => vi.advanceTimersByTimeAsync(elapsed));
    expect(container.textContent).not.toContain("Couldn’t open");
    expect(container.textContent).not.toContain("Host is stopping.");
  }
  expect(container.querySelector(".cm-content")).not.toBeNull();
});

it("shows a permanent read refusal immediately", async () => {
  vi.useFakeTimers();
  calls.read.mockRejectedValue(new Error("Permission denied"));
  await render(true);
  expect(container.textContent).toContain("Permission denied");
});

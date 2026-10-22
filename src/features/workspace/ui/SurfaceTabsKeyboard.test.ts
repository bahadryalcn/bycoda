// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceTabs } from "./SurfaceTabs";
import type { FilePaneTab } from "../model/layout";

vi.mock("../../files/ui/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
let container: HTMLDivElement;
let root: Root;
const initial: FilePaneTab[] = [
  { id: "a", path: "/repo/a.ts", cwd: "/repo", preview: true },
  { id: "b", path: "/repo/b.ts", cwd: "/repo" },
  { id: "c", path: "/repo/c.ts", cwd: "/repo" },
];
const close = vi.fn();
const pin = vi.fn();
function Harness({ refuseClose = false }: { refuseClose?: boolean }) {
  const [files, setFiles] = useState(initial);
  const [active, setActive] = useState("a");
  return createElement(SurfaceTabs, {
    files,
    activeFileId: active,
    dirtyFileIds: new Set(["b"]),
    fileErrorCounts: new Map(),
    onSelectFile: setActive,
    onCloseFile: (id) => {
      close(id);
      if (refuseClose) return;
      setFiles((current) => current.filter((file) => file.id !== id));
      setActive((current) => (current === id ? (id === "c" ? "b" : "c") : current));
    },
    onCloseOtherFiles: vi.fn(),
    onPinFile: pin,
    onReorder: vi.fn(),
  });
}
const tab = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[role=tab][data-file-tab-id="${id}"]`)!;
async function key(id: string, key: string, extras = {}) {
  await act(async () =>
    tab(id).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extras }),
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
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

it("roves one tab stop with arrows, wraparound, Home and End while matching selection", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(
    [...container.querySelectorAll("[role=tab]")].map((node) => (node as HTMLElement).tabIndex),
  ).toEqual([0, -1, -1]);
  expect(
    [...container.querySelectorAll('button[aria-label^="Close "]')].every(
      (node) => (node as HTMLElement).tabIndex === -1,
    ),
  ).toBe(true);
  await act(async () => tab("a").focus());
  for (const [from, command, to] of [
    ["a", "ArrowRight", "b"],
    ["b", "End", "c"],
    ["c", "ArrowRight", "a"],
    ["a", "ArrowLeft", "c"],
    ["c", "Home", "a"],
  ]) {
    await key(from, command);
    expect(document.activeElement).toBe(tab(to));
    expect(tab(to).getAttribute("aria-selected")).toBe("true");
    expect(
      [...container.querySelectorAll("[role=tab]")].filter(
        (node) => (node as HTMLElement).tabIndex === 0,
      ),
    ).toEqual([tab(to)]);
  }
});

it("keeps preview pinning and context menus accessible from the file tab", async () => {
  await act(async () => root.render(createElement(Harness)));
  await key("a", "F2");
  expect(pin).toHaveBeenCalledExactlyOnceWith("a");
  await key("a", "F10", { shiftKey: true });
  expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
});

it.each([false, true])(
  "preserves focus until closure is accepted (refused=%s)",
  async (refuseClose) => {
    await act(async () => root.render(createElement(Harness, { refuseClose })));
    await key("a", "ArrowRight");
    await key("b", "Delete");
    expect(close).toHaveBeenCalledExactlyOnceWith("b");
    expect(document.activeElement).toBe(tab(refuseClose ? "b" : "c"));
    expect(tab(refuseClose ? "b" : "c").tabIndex).toBe(0);
  },
);

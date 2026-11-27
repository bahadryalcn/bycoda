// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ close: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: native.close }),
}));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  revealPermissionApp: vi.fn(async () => {}),
  dragPermissionApp: vi.fn(async () => {}),
}));
import { dragPermissionApp, revealPermissionApp } from "../../../platform/tauri/systemPermissions";
import { PermissionHelper } from "./PermissionHelper";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  root = createRoot(host);
  window.history.replaceState(null, "", "?permission=accessibility");
  await act(async () => root.render(createElement(PermissionHelper)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const appRow = () => host.querySelector<HTMLButtonElement>('button[draggable="true"]')!;
const dragEvent = () => new Event("dragstart", { bubbles: true, cancelable: true });

it("makes the app row a Finder action that can also be focused via keyboard", async () => {
  expect(host.textContent).toContain("Drag bycoda into the permission list.");
  expect(host.querySelector("img")?.getAttribute("draggable")).toBe("false");
  await act(async () => appRow().click());
  expect(revealPermissionApp).toHaveBeenCalledOnce();
  expect(dragPermissionApp).not.toHaveBeenCalled();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
  );
  expect(native.close).toHaveBeenCalledOnce();
});

it("delegates one drag to AppKit and suppresses the pointer click from that gesture", async () => {
  const drag = dragEvent();
  await act(async () => {
    appRow().dispatchEvent(drag);
    appRow().dispatchEvent(dragEvent());
    appRow().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(drag.defaultPrevented).toBe(true);
  expect(dragPermissionApp).toHaveBeenCalledOnce();
  expect(revealPermissionApp).not.toHaveBeenCalled();
  await act(async () => {
    appRow().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    appRow().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(revealPermissionApp).toHaveBeenCalledOnce();
});

it("reveals the bundle in Finder if AppKit cannot start the drag", async () => {
  vi.mocked(dragPermissionApp).mockRejectedValueOnce(new Error("No native pointer gesture"));
  await act(async () => appRow().dispatchEvent(dragEvent()));
  expect(revealPermissionApp).toHaveBeenCalledOnce();
});

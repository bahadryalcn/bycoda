// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  closePermissionHelper: vi.fn(async () => {}),
  revealPermissionApp: vi.fn(async () => {}),
}));
import { revealPermissionApp } from "../../../platform/tauri/systemPermissions";
import { PermissionHelper } from "./PermissionHelper";
it("reveals the real app in Finder without advertising web drag support", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(PermissionHelper)));
  expect(host.textContent).toContain("drag the app from Finder");
  expect(host.querySelector("[draggable]")).toBeNull();
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Reveal bycoda in Finder",
  )!;
  await act(async () => button.click());
  expect(revealPermissionApp).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

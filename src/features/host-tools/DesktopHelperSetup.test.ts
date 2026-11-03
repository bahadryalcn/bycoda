// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./desktopControlClient", () => ({ desktopHelperRequest: mock.request }));
import { DesktopHelperSetup } from "./DesktopHelperSetup";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  mock.request.mockReset().mockResolvedValue({ phase: "missing" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});
async function render(use = vi.fn()) {
  await act(async () => root.render(createElement(DesktopHelperSetup, { onUse: use })));
  return use;
}
it("only discovers on mount and prepares only after an owner click", async () => {
  await render();
  expect(mock.request).toHaveBeenCalledExactlyOnceWith({ op: "status" });
  mock.request.mockResolvedValueOnce({ phase: "preparing", stage: "building" });
  await act(async () => container.querySelector("button")!.click());
  expect(mock.request).toHaveBeenLastCalledWith({ op: "prepare" });
  expect(container.textContent).toContain("Building helper");
});
it("keeps verified helper selection explicit and never enables control", async () => {
  const helper = {
    binaryPath: "/verified/helper.exe",
    binarySha256: "a".repeat(64),
    sourceRef: "pinned",
    protocol: "2.5",
    version: "1.0.2",
    manifestPath: "/verified/manifest.json",
  };
  mock.request.mockResolvedValue({ phase: "ready", helper });
  const use = await render();
  expect(use).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Verified helper ready");
  await act(async () => container.querySelector("button")!.click());
  expect(use).toHaveBeenCalledExactlyOnceWith(helper);
  expect(mock.request).toHaveBeenCalledExactlyOnceWith({ op: "status" });
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./desktopControlClient", () => ({ desktopHelperRequest: mock.request }));
import { DesktopHelperSetup, isEarlierBundledHelper } from "./DesktopHelperSetup";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const helper = {
  binaryPath: "/verified/helper.exe",
  binarySha256: "a".repeat(64),
  sourceRef: "pinned",
  protocol: "2.5",
  version: "1.0.2",
  manifestPath: "/verified/manifest.json",
};
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
const prepares = () => mock.request.mock.calls.filter(([input]) => input.op === "prepare").length;
async function render(props: Partial<Parameters<typeof DesktopHelperSetup>[0]> = {}) {
  const onUse = props.onUse ?? vi.fn();
  await act(async () =>
    root.render(createElement(DesktopHelperSetup, { onUse, ...props } as never)),
  );
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return onUse;
}
it("only discovers on mount and prepares only after an owner click", async () => {
  await render();
  expect(mock.request).toHaveBeenCalledExactlyOnceWith({ op: "status" });
  mock.request.mockResolvedValueOnce({ phase: "preparing", stage: "building" });
  await act(async () => container.querySelector("button")!.click());
  expect(mock.request).toHaveBeenLastCalledWith({ op: "prepare" });
  expect(container.textContent).toContain("Preparing…");
});
it("keeps verified helper selection explicit and never enables control", async () => {
  mock.request.mockResolvedValue({ phase: "ready", helper });
  const use = await render();
  expect(use).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Ready");
  await act(async () => container.querySelector("button")!.click());
  expect(use).toHaveBeenCalledExactlyOnceWith(helper);
  expect(mock.request).toHaveBeenCalledExactlyOnceWith({ op: "status" });
});
it("prepares a missing helper once while computer use is on and never enables control", async () => {
  const use = await render({ autoPrepare: true });
  expect(prepares()).toBe(1);
  await render({ autoPrepare: true, onUse: use });
  expect(prepares()).toBe(1);
  expect(use).not.toHaveBeenCalled();
});
it("does not prepare automatically while computer use is off", async () => {
  await render({ autoPrepare: false });
  expect(prepares()).toBe(0);
});
it("does not prepare again when the helper is already prepared and applies it once to an empty selection", async () => {
  mock.request.mockResolvedValue({ phase: "ready", helper });
  const use = await render({ autoPrepare: true });
  expect(prepares()).toBe(0);
  expect(use).toHaveBeenCalledExactlyOnceWith(helper);
});
it("replaces a bundled helper path left behind by an earlier runtime version", async () => {
  const bundled = {
    ...helper,
    binaryPath: String.raw`C:\Users\o\.bycoda-host\runtime\0.7.7-win32-x64-b\agent-desktop\agent-desktop.exe`,
  };
  const stale = bundled.binaryPath.replace("0.7.7-win32-x64-b", "0.7.2-win32-x64-package-a");
  mock.request.mockResolvedValue({ phase: "ready", helper: bundled });
  const use = await render({ autoPrepare: true, selectedPath: stale });
  expect(use).toHaveBeenCalledExactlyOnceWith(bundled);
  expect(isEarlierBundledHelper(bundled.binaryPath, bundled.binaryPath)).toBe(false);
  expect(isEarlierBundledHelper(String.raw`C:\custom\agent-desktop.exe`, bundled.binaryPath)).toBe(
    false,
  );
});
it("leaves a custom helper selection alone during automatic preparation", async () => {
  mock.request.mockResolvedValue({ phase: "ready", helper });
  const use = await render({ autoPrepare: true, selectedPath: "/custom/helper.exe" });
  expect(prepares()).toBe(0);
  expect(use).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe("Use verified helper");
});
it("shows an error with Retry after a failed automatic preparation instead of looping", async () => {
  mock.request.mockImplementation(async (input) => {
    if (input.op === "prepare") throw new Error("Helper checksum did not match.");
    return { phase: "missing" };
  });
  await render({ autoPrepare: true });
  expect(prepares()).toBe(1);
  expect(container.textContent).toContain("Helper checksum did not match.");
  expect(container.textContent).toContain("Error");
  await act(async () => container.querySelector("button")!.click());
  expect(prepares()).toBe(2);
});

// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: native.listen }),
}));
import {
  nativeDesktopIndicatorPort,
  DesktopIndicatorViewSchema,
  DESKTOP_INDICATOR_EVENT,
} from "./desktopControlIndicator";
const view = {
  revision: 1,
  status: {
    enabled: true,
    active: true,
    stopped: false,
    currentAction: { app: "Editor", action: "click" },
  },
  statusError: false,
  stopError: false,
  stopping: false,
  visible: true,
};
beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(view);
  native.listen.mockReset().mockResolvedValue(() => undefined);
});
it("uses only finite native state/Stop commands and never sends model target, approval or RPC arguments", async () => {
  expect(await nativeDesktopIndicatorPort.read()).toEqual(view);
  await nativeDesktopIndicatorPort.stop();
  expect(native.invoke.mock.calls).toEqual([
    ["desktop_control_indicator_state"],
    ["desktop_control_indicator_stop"],
  ]);
});
it("rejects raw clipboard/tree/extra data and malformed bounded current action before disclosure", () => {
  expect(
    DesktopIndicatorViewSchema.safeParse({
      ...view,
      status: { ...view.status, clipboard: "secret" },
    }).success,
  ).toBe(false);
  expect(
    DesktopIndicatorViewSchema.safeParse({
      ...view,
      status: { ...view.status, currentAction: { app: "x".repeat(201), action: "click" } },
    }).success,
  ).toBe(false);
});
it("accepts scoped native events only after validation", async () => {
  const receive = vi.fn();
  await nativeDesktopIndicatorPort.subscribe(receive);
  expect(native.listen.mock.calls[0][0]).toBe(DESKTOP_INDICATOR_EVENT);
  const callback = native.listen.mock.calls[0][1];
  callback({ payload: { ...view, clipboard: "secret" } });
  expect(receive).not.toHaveBeenCalled();
  callback({ payload: view });
  expect(receive).toHaveBeenCalledExactlyOnceWith(view);
});

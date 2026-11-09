// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useVoiceOverlayHost } from "./useVoiceOverlayHost";
const mocks = vi.hoisted(() => ({
  listen: vi.fn(async () => vi.fn()),
  close: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock("../../../platform/tauri/listenWindow", () => ({ listenWindowAsync: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }));
vi.mock("../model/voiceOverlay", async (original) => ({
  ...(await original<typeof import("../model/voiceOverlay")>()),
  closeVoiceOverlay: mocks.close,
}));
const level = { current: 0 };
const error = vi.fn();
function Fixture() {
  useVoiceOverlayHost({
    detached: true,
    level,
    state: {
      status: "live",
      visualState: "listening",
      statusText: "Listening",
      title: "Voice",
      muted: false,
      working: false,
      canStart: true,
      transcript: "",
      message: "",
      error: "",
      privacy: "Local",
    },
    onCommand: vi.fn(),
    onClosed: vi.fn(),
    onError: error,
  });
  return null;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("does not close a live overlay during StrictMode replay, but closes on real unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Fixture))));
  await act(async () => vi.advanceTimersByTime(0));
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTime(0));
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("releases partial subscriptions and surfaces registration failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const release = vi.fn();
  mocks.listen
    .mockResolvedValueOnce(release)
    .mockRejectedValueOnce(new Error("native listener failed"));
  const container = document.createElement("div"),
    root = createRoot(container);
  await act(async () => root.render(createElement(Fixture)));
  expect(error).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTime(0));
});

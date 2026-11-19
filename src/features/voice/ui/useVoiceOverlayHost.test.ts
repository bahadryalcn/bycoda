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
    },
    onCommand: vi.fn(),
    onClosed: vi.fn(),
    onError: error,
  });
  return null;
}
const baseState = {
  status: "live" as const,
  visualState: "listening" as const,
  statusText: "Listening",
  title: "Voice",
  muted: false,
  working: false,
  canStart: true,
  transcript: "",
  message: "",
  error: "",
};
function Mirror(props: {
  detached: boolean;
  state: typeof baseState & { toJSON?: () => unknown };
}) {
  useVoiceOverlayHost({
    detached: props.detached,
    level,
    state: props.state,
    onCommand: vi.fn(),
    onClosed: vi.fn(),
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
it("serializes state only while detached, then sends the initial sync and later updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const serialized = vi.fn(() => ({ ...baseState }));
  const state = (message: string) => ({ ...baseState, message, toJSON: serialized });
  const container = document.createElement("div"),
    root = createRoot(container);
  await act(async () =>
    root.render(createElement(Mirror, { detached: false, state: state("one") })),
  );
  await act(async () =>
    root.render(createElement(Mirror, { detached: false, state: state("two") })),
  );
  expect(serialized).not.toHaveBeenCalled();
  expect(mocks.emit).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(Mirror, { detached: true, state: state("two") })),
  );
  await act(async () => {});
  expect(serialized).toHaveBeenCalled();
  // emitTo is scoped to the overlay window label, then the event name, then the payload.
  expect(mocks.emit).toHaveBeenCalledWith(
    "voice-overlay-main",
    "voice_overlay_state",
    expect.anything(),
  );
  const sent = mocks.emit.mock.calls.length;
  await act(async () =>
    root.render(createElement(Mirror, { detached: true, state: state("three") })),
  );
  // The emit follows a dynamic import, so wait for it rather than one flush.
  await vi.waitFor(() => expect(mocks.emit.mock.calls.length).toBeGreaterThan(sent));
  await act(async () => root.unmount());
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

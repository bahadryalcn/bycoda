// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const listeners: Array<(message: { payload: unknown }) => void> = [];
const disposed = vi.fn();
vi.mock("../../../platform/tauri/listenWindow", () => ({
  listenWindow: (_event: string, handler: (message: { payload: unknown }) => void) => {
    listeners.push(handler);
    return () => {
      listeners.splice(listeners.indexOf(handler), 1);
      disposed();
    };
  },
}));
import { useVoiceTalkEvent, VOICE_WAKE_EVENT } from "./useVoiceTalkEvent";

it("starts Talk only when voice is not live, and cleans up its listener", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const start = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Fixture({ status }: { status: string }) {
    useVoiceTalkEvent({ status, start });
    return null;
  }
  const fire = () =>
    listeners.forEach((listener) => listener({ payload: { source: "global-shortcut", at: 1 } }));
  await act(async () => root.render(createElement(Fixture, { status: "ready" })));
  expect(listeners).toHaveLength(1);
  fire();
  expect(start).toHaveBeenCalledTimes(1);
  for (const status of ["live", "connecting", "reconnecting"]) {
    await act(async () => root.render(createElement(Fixture, { status })));
    fire();
  }
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(Fixture, { status: "sleeping" })));
  fire();
  expect(start).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  expect(listeners).toHaveLength(0);
  expect(disposed).toHaveBeenCalledTimes(1);
});

it("starts Talk from the wake phrase only when voice is not live", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const start = vi.fn();
  const root = createRoot(document.createElement("div"));
  function Fixture({ status }: { status: string }) {
    useVoiceTalkEvent({ status, start });
    return null;
  }
  await act(async () => root.render(createElement(Fixture, { status: "ready" })));
  window.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT));
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => root.render(createElement(Fixture, { status: "live" })));
  window.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT));
  expect(start).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  window.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT));
  expect(start).toHaveBeenCalledTimes(1);
});

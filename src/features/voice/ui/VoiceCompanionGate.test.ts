// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("./VoiceCompanion", () => ({
  VoiceCompanion: () => {
    useEffect(() => () => state.stop(), []);
    return createElement("div", { "data-voice": true }, "Voice");
  },
}));
import { VoiceCompanionGate } from "./VoiceCompanionGate";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
let root: Root | undefined;
let element: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  element?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});
it("is entirely absent by default and unmounts voice immediately when disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  const stopCoding = vi.fn();
  await act(async () =>
    root!.render(
      createElement(VoiceCompanionGate, { sessions: [], onSubmit: () => true, onStop: stopCoding }),
    ),
  );
  expect(element.innerHTML).toBe("");
  await act(async () => {
    saveVoiceSettings({ ...loadVoiceSettings(), enabled: true });
  });
  await act(async () => {
    await import("./VoiceCompanion");
  });
  expect(element.querySelector("[data-voice]")).not.toBeNull();
  await act(async () => {
    saveVoiceSettings({ ...loadVoiceSettings(), enabled: false });
  });
  expect(element.innerHTML).toBe("");
  expect(state.stop).toHaveBeenCalledOnce();
  expect(stopCoding).not.toHaveBeenCalled();
});

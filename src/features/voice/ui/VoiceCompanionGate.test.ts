// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
const host = vi.hoisted(() => ({
  profile: { name: "Arif", setupComplete: true, voiceSetupComplete: true },
  request: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../assistant/model/assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: { profile: host.profile, memory: [] },
    error: "",
    loading: false,
    refresh: vi.fn(),
  }),
  assistantRequest: host.request,
}));
vi.mock("../../assistant/ui/AssistantSetup", () => ({
  AssistantSetup: () => createElement("div", { "data-setup": true }, "Setup"),
}));
vi.mock("./VoiceCompanion", () => ({
  VoiceCompanion: () => {
    useEffect(() => {
      state.start();
      return () => state.stop();
    }, []);
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
  host.profile.setupComplete = true;
  host.profile.voiceSetupComplete = true;
});
it("keeps the same audio owner mounted while workspace/project props change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: true });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  const base = { sessions: [], onSubmit: () => true, onStop: vi.fn() };
  await act(async () =>
    root!.render(createElement(VoiceCompanionGate, { ...base, projectPath: "/alpha" })),
  );
  await act(async () => {
    await import("./VoiceCompanion");
  });
  await act(async () =>
    root!.render(
      createElement(VoiceCompanionGate, {
        ...base,
        projectPath: "/beta",
        activeId: "different-session",
      }),
    ),
  );
  expect(state.start).toHaveBeenCalledOnce();
  expect(state.stop).not.toHaveBeenCalled();
  host.profile.voiceSetupComplete = false;
  await act(async () =>
    root!.render(createElement(VoiceCompanionGate, { ...base, projectPath: "/beta" })),
  );
  expect(state.stop).toHaveBeenCalledOnce();
  expect(element.querySelector("[data-voice]")).toBeNull();
});
it("keeps capture unmounted until mandatory voice setup is complete", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host.profile.voiceSetupComplete = false;
  saveVoiceSettings({ ...loadVoiceSettings(), enabled: true });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () =>
    root!.render(
      createElement(VoiceCompanionGate, { sessions: [], onSubmit: () => true, onStop: vi.fn() }),
    ),
  );
  expect(element.querySelector("[data-voice]")).toBeNull();
  await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
  expect(element.querySelector("[data-setup]")).not.toBeNull();
  expect(state.stop).not.toHaveBeenCalled();
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

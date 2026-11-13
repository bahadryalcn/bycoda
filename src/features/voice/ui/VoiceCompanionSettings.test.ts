// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { VoiceCompanionSettings } from "./VoiceCompanionSettings";
import { loadVoiceSettings } from "../model/voiceSettings";
import { loadVoiceMemory, saveVoiceMemory } from "../model/voiceMemory";
vi.mock("./VoiceVisualizer", () => ({ VoiceVisualizer: () => null }));

it("links shared Assistant settings without duplicating identity editing and preserves local memory and visual preferences", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const memory = { enabled: true, notes: [{ id: "one", text: "Owner preference", at: 1 }] };
  saveVoiceMemory(memory);
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const change = vi.fn(),
    open = vi.fn();
  window.addEventListener("bycoda:open-assistant", open);
  try {
    await act(async () =>
      root.render(
        createElement(VoiceCompanionSettings, {
          settings: loadVoiceSettings(),
          change,
          assistantName: "Arif",
          assistantMemoryCount: 7,
        }),
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent?.trim() === label,
      )!;
    expect(change).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[data-setting-id="voice-persona"] input')).toHaveLength(0);
    await act(async () => button("Assistant settings").click());
    expect((open.mock.calls[0]![0] as CustomEvent).detail).toEqual({ tab: "settings" });
    await act(async () => button("Manage (7)").click());
    expect((open.mock.calls[1]![0] as CustomEvent).detail).toEqual({ tab: "memory" });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Memory"]')!.click(),
    );
    expect(loadVoiceMemory()).toEqual({ ...memory, enabled: false });
    const appearance = button("Appearance and voice style");
    expect(appearance.getAttribute("aria-expanded")).toBe("false");
    await act(async () => appearance.click());
    expect(change).not.toHaveBeenCalled();
    await act(async () => button("Orb").click());
    expect(change).toHaveBeenCalledExactlyOnceWith({ visual: "orb" });
  } finally {
    window.removeEventListener("bycoda:open-assistant", open);
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

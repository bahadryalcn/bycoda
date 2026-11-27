// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { VoiceMemoryRow, VoiceVisualStyleRow } from "./VoiceCompanionSettings";
import { loadVoiceSettings } from "../model/voiceSettings";
import { loadVoiceMemory, saveVoiceMemory } from "../model/voiceMemory";
vi.mock("./VoiceVisualizer", () => ({ VoiceVisualizer: () => null }));

it("links to the Room's memory notes, toggles local memory and chooses the visual style", async () => {
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
        createElement(
          Fragment,
          null,
          createElement(VoiceMemoryRow, { assistantMemoryCount: 7 }),
          createElement(VoiceVisualStyleRow, { settings: loadVoiceSettings(), change }),
        ),
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent?.trim() === label,
      )!;
    expect(change).not.toHaveBeenCalled();
    // The row is a switch and a link; the description that restated the label is gone.
    expect(host.textContent).not.toContain("Keeps short notes about you");
    await act(async () => button("7 notes").click());
    expect((open.mock.calls[0]![0] as CustomEvent).detail).toEqual({ tab: "memory" });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Memory"]')!.click(),
    );
    expect(loadVoiceMemory()).toEqual({ ...memory, enabled: false });
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

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadVoiceSettings } from "../../model/voiceSettings";
import { VoiceCompanionControls } from "./VoiceCompanionControls";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "usb-mic", label: "USB Mic" },
        { kind: "audiooutput", deviceId: "headset", label: "Headset" },
      ],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function renderLiveDock() {
  const handlers = {
    onStart: vi.fn(),
    onClose: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSpeaker: vi.fn(),
    onSilence: vi.fn(),
    onFinish: vi.fn(),
    onManualChange: vi.fn(),
  };
  await act(async () =>
    root.render(
      createElement(VoiceCompanionControls, {
        status: "live",
        startDisabled: false,
        muted: false,
        speakerMuted: false,
        manual: false,
        chatShown: false,
        ...handlers,
      }),
    ),
  );
  return handlers;
}

async function pickFromContextMenu(buttonLabel: string, deviceLabel: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${buttonLabel}"]`)!;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }),
    );
  });
  const rows = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  expect(rows.map((row) => row.textContent)).toEqual(["System default", deviceLabel]);
  await act(async () => rows[1].click());
}

it("right-click on the microphone and speaker picks their devices without toggling them", async () => {
  const handlers = await renderLiveDock();
  await pickFromContextMenu("Mute microphone", "USB Mic");
  await pickFromContextMenu("Mute speaker", "Headset");
  expect(loadVoiceSettings()).toMatchObject({
    microphoneId: "usb-mic",
    speakerOutputId: "headset",
  });
  expect(handlers.onToggleMute).not.toHaveBeenCalled();
  expect(handlers.onToggleSpeaker).not.toHaveBeenCalled();
});

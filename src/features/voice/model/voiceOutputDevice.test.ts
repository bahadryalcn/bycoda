// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { routeVoiceOutput } from "./voiceOutputDevice";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";

afterEach(() => localStorage.clear());

function fakeContext(setSinkId: (id: string) => Promise<void>) {
  const target = new EventTarget();
  const context = {
    state: "running" as AudioContextState,
    setSinkId: vi.fn(setSinkId),
    addEventListener: target.addEventListener.bind(target),
    close() {
      context.state = "closed";
      target.dispatchEvent(new Event("statechange"));
    },
  };
  return context;
}

it("plays on the saved output and follows later changes until the context closes", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), speakerOutputId: "headset" });
  const context = fakeContext(async () => {});
  routeVoiceOutput(context as unknown as AudioContext);
  expect(context.setSinkId).toHaveBeenLastCalledWith("headset");

  saveVoiceSettings({ ...loadVoiceSettings(), speakerOutputId: "" });
  expect(context.setSinkId).toHaveBeenLastCalledWith("");

  context.close();
  saveVoiceSettings({ ...loadVoiceSettings(), speakerOutputId: "speakers" });
  expect(context.setSinkId).toHaveBeenCalledTimes(2);
});

it("falls back to the system default when the saved output is gone", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), speakerOutputId: "unplugged" });
  const context = fakeContext(async (id) => {
    if (id) throw new DOMException("not found", "NotFoundError");
  });
  routeVoiceOutput(context as unknown as AudioContext);
  await vi.waitFor(() => expect(context.setSinkId).toHaveBeenLastCalledWith(""));
});

it("leaves playback alone where output selection is unsupported", () => {
  const context = { state: "running", addEventListener: vi.fn() };
  routeVoiceOutput(context as unknown as AudioContext);
  expect(context.addEventListener).not.toHaveBeenCalled();
});

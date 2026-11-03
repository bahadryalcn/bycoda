// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  inspect: vi.fn(),
  setup: vi.fn(),
  setupStatus: vi.fn(),
  browse: vi.fn(),
  openUrl: vi.fn(),
  cloudStatus: vi.fn(),
  setCloudKey: vi.fn(),
}));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: backend.browse }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: backend.openUrl }));
import { VoiceSettings } from "./VoiceSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
import * as turnPolicy from "../model/voiceTurnPolicy";
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.inspect.mockResolvedValue({
    ready: false,
    missing: ["faster-whisper", "Whisper model", "voxcpm"],
  });
  backend.setupStatus.mockResolvedValue({ state: "idle" });
  backend.cloudStatus.mockResolvedValue({ elevenlabs: false });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup(enabled = true) {
  saveVoiceSettings({ ...loadVoiceSettings(), enabled });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(VoiceSettings)));
}
it("retains the saved automatic pause while disabling its control in manual mode", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    manualTurnEnd: false,
    manualTurnEndRevision: 9,
    turnEndSilence: 4,
  });
  await setup();
  await click("Advanced");
  const manual = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="I decide when my turn ends"]',
  )!;
  expect(manual).not.toBeNull();
  await act(async () => manual.click());
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 10,
    turnEndSilence: 4,
  });
  expect(
    container.querySelector('[data-setting-id="voice-turn-silence"] [disabled]'),
  ).not.toBeNull();
  await act(async () => manual.click());
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: false,
    manualTurnEndRevision: 11,
    turnEndSilence: 4,
  });
});
async function advance(ms = 501) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function openLocate() {
  const more = document.querySelector<HTMLButtonElement>(
    'button[aria-label="More voice setup actions"]',
  );
  expect(more).not.toBeNull();
  await act(async () => more!.click());
  await click("Locate existing");
}
it("does not check or install until enabled; shows only the next actions for missing setup", async () => {
  await setup(false);
  await advance();
  expect(backend.inspect).not.toHaveBeenCalled();
  expect(backend.setupStatus).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  await advance();
  expect(container.textContent).toContain("Voice setup is needed");
  expect(document.querySelector('button[aria-label="More voice setup actions"]')).not.toBeNull();
  expect(container.textContent).not.toMatch(
    /faster-whisper|VoxCPM2|pip install|Python executable|Missing:/,
  );
  expect(backend.setup).not.toHaveBeenCalled();
});
it("keeps locations behind a dialog, saves a picked folder and discards stale detection", async () => {
  // Only the High quality voice (VoxCPM2) uses a model folder the owner can choose.
  saveVoiceSettings({ ...loadVoiceSettings(), engine: "voxcpm2" });
  await setup();
  await advance();
  await openLocate();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Speech recognition model");
  backend.browse.mockResolvedValue("G:\\Models\\VoxCPM2");
  const buttons = [...dialog.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === "Browse",
  );
  expect(buttons).toHaveLength(3);
  await act(async () => buttons[2].click());
  expect(loadVoiceSettings().ttsPath).toBe("G:\\Models\\VoxCPM2");
  expect(container.textContent).toContain("Checking voice setup…");
  await advance();
  expect(backend.inspect).toHaveBeenLastCalledWith({
    natural: true,
    engine: "voxcpm2",
    ttsPath: "G:\\Models\\VoxCPM2",
  });
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps installation reachable while detection is stalled and ignores the stale check", async () => {
  let finish!: (value: { ready: boolean; missing: string[] }) => void;
  backend.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup();
  await advance();
  expect(container.textContent).toContain("Checking voice setup…");
  backend.setup.mockResolvedValue({ state: "installing", stage: "packages" });
  await click("Install");
  expect(backend.setup).toHaveBeenCalledExactlyOnceWith({ natural: true });
  await act(async () => finish({ ready: true, missing: [] }));
  expect(container.textContent).toContain("Installing voice support…");
  expect(container.textContent).not.toContain("Voice is ready");
});

it("ends a stalled check with retry and discards a late answer", async () => {
  let finish!: (value: { ready: boolean; missing: string[] }) => void;
  backend.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup();
  await advance();
  await advance(20_000);
  expect(container.textContent).toContain("This computer is unavailable. Try again.");
  backend.inspect.mockResolvedValue({ ready: true, missing: [] });
  await click("Try again");
  expect(container.textContent).toContain("Voice is ready");
  await act(async () => finish({ ready: false, missing: ["Python"] }));
  expect(container.textContent).toContain("Voice is ready");
});

it("ignores a late initial job status after starting a new install", async () => {
  let finish!: (value: { state: "ready" }) => void;
  backend.setupStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup();
  backend.setup.mockResolvedValue({ state: "installing", stage: "packages" });
  await click("Install");
  await act(async () => finish({ state: "ready" }));
  expect(container.textContent).toContain("Installing voice support…");
  expect(container.textContent).not.toContain("Locate existing");
});

it("keeps folder selection progress on one Browse action and suppresses duplicate dialogs", async () => {
  await setup();
  await advance();
  await openLocate();
  let finish!: (path: string) => void;
  backend.browse.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const actions = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].filter((button) => button.textContent?.trim() === "Browse");
  actions[1].focus();
  act(() => {
    actions[1].click();
    actions[1].click();
  });
  expect(backend.browse).toHaveBeenCalledOnce();
  expect(actions.filter((button) => button.getAttribute("aria-busy") === "true")).toHaveLength(1);
  expect(document.activeElement).toBe(actions[1]);
  await act(async () => finish("G:/Models/Whisper"));
  expect(loadVoiceSettings().whisperPath).toBe("G:/Models/Whisper");
});
it("installs once, polls progress, saves managed locations and verifies readiness", async () => {
  await setup();
  await advance();
  backend.setup.mockResolvedValue({
    state: "installing",
    stage: "packages",
    requestedConfig: { natural: true },
  });
  await click("Install");
  expect(backend.setup).toHaveBeenCalledExactlyOnceWith({ natural: true });
  expect(container.textContent).toContain("Installing voice support…");
  expect(container.textContent).not.toContain("Locate existing");
  backend.setupStatus.mockResolvedValue({
    state: "ready",
    requestedConfig: { natural: true },
    config: {
      natural: true,
      python: "G:/voice/python.exe",
      whisperPath: "G:/voice/whisper",
      ttsPath: "G:/voice/tts",
    },
  });
  backend.inspect.mockResolvedValue({ ready: true, missing: [] });
  await advance(1001);
  await advance();
  expect(loadVoiceSettings().python).toBe("G:/voice/python.exe");
  expect(container.textContent).toContain("Voice is ready");
  expect(backend.setup).toHaveBeenCalledTimes(1);
});
it("offers a simple retry for connection failures with details behind help", async () => {
  backend.inspect.mockRejectedValue(new Error("This computer's bycoda Host is not connected."));
  await setup();
  await advance();
  expect(container.textContent).toContain("This computer is unavailable. Try again.");
  expect(container.textContent).not.toContain("bycoda Host is not connected");
  expect(container.textContent).not.toContain("Install");
  backend.inspect.mockResolvedValue({ ready: true, missing: [] });
  await click("Try again");
  expect(container.textContent).toContain("Voice is ready");
});
it("does not call a detected interpreter ready when the backend rejects its version", async () => {
  await setup();
  await advance();
  backend.setup.mockResolvedValue({ state: "error", error: "python_missing" });
  await click("Install");
  expect(container.textContent).toContain("Install Python to continue.");
  expect(container.textContent).toContain("Get Python");
  expect(container.textContent).not.toContain("Detected");
});
it("does not apply a completed background job over newer voice preferences", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), python: "G:/my-python.exe" });
  backend.setupStatus.mockResolvedValue({
    state: "ready",
    requestedConfig: { natural: true },
    config: { python: "G:/old-job/python.exe", natural: true },
  });
  await setup();
  expect(loadVoiceSettings().python).toBe("G:/my-python.exe");
});

it("chooses visual previews with radio arrows and keeps runtime setup unchanged", async () => {
  await setup();
  await advance();
  await click("Advanced");
  const group = container.querySelector('[role="radiogroup"][aria-label="Visual style"]')!;
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios.map((radio) => radio.textContent?.trim())).toEqual([
    "bycoda mark",
    "Wave",
    "Dots",
    "Orb",
  ]);
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  const calls = backend.inspect.mock.calls.length;
  radios[0].focus();
  await act(async () =>
    radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(loadVoiceSettings().visual).toBe("wave");
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(radios[1]);
  await advance();
  expect(backend.inspect).toHaveBeenCalledTimes(calls);
  await act(async () => radios[3].click());
  expect(loadVoiceSettings().visual).toBe("orb");
});

it("offers GPU support for a ready CPU-only High quality voice and installs with the chosen device", async () => {
  backend.inspect.mockResolvedValue({
    ready: true,
    missing: [],
    gpu: "NVIDIA GeForce RTX 4070",
    accelerated: false,
  });
  saveVoiceSettings({ ...loadVoiceSettings(), engine: "voxcpm2" });
  await setup();
  await advance();
  expect(container.textContent).toContain("Voice is ready");
  expect(container.textContent).toContain("NVIDIA GeForce RTX 4070");
  backend.setup.mockResolvedValue({ state: "installing", stage: "gpu" });
  await click("Install GPU support");
  expect(backend.setup).toHaveBeenCalledExactlyOnceWith({ natural: true, engine: "voxcpm2" });
  expect(container.textContent).toContain("Installing GPU support…");
});

it("persists the processing choice and rechecks with it; CPU hides the GPU offer", async () => {
  backend.inspect.mockResolvedValue({
    ready: true,
    missing: [],
    gpu: "NVIDIA GeForce RTX 4070",
    accelerated: false,
  });
  saveVoiceSettings({ ...loadVoiceSettings(), engine: "voxcpm2" });
  await setup();
  await advance();
  expect(container.textContent).toContain("Install GPU support");
  await click("Advanced");
  await click("CPU");
  expect(loadVoiceSettings().device).toBe("cpu");
  await advance();
  expect(backend.inspect).toHaveBeenLastCalledWith({
    natural: true,
    engine: "voxcpm2",
    device: "cpu",
  });
  expect(container.textContent).not.toContain("Install GPU support");
});

it("keeps advanced preferences mounted without changing saved values or starting setup", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    idleSleepMinutes: 30,
    manualTurnEnd: true,
    turnEndSilence: 4,
    allowBargeIn: false,
    holdAnnouncements: true,
    visual: "orb",
    device: "cpu",
  });
  await setup();
  await advance();
  const saved = localStorage.getItem("bycoda.voice"),
    calls = backend.inspect.mock.calls.length;
  const control = container.querySelector(
    '[data-setting-id="voice-manual-turn-end"] button[role="switch"]',
  )!;
  const body = control.closest(".settings-advanced-content") as HTMLElement;
  expect(body.hidden).toBe(true);
  expect(body.hasAttribute("inert")).toBe(true);
  await click("Advanced");
  expect(body.hidden).toBe(false);
  await click("Advanced");
  expect(body.hidden).toBe(true);
  expect(
    container.querySelector('[data-setting-id="voice-manual-turn-end"] button[role="switch"]'),
  ).toBe(control);
  expect(localStorage.getItem("bycoda.voice")).toBe(saved);
  expect(backend.inspect).toHaveBeenCalledTimes(calls);
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps a failed manual-turn save visible on the collapsed advanced summary", async () => {
  await setup();
  await advance();
  await click("Advanced");
  const saved = localStorage.getItem("bycoda.voice");
  const refusal = vi.spyOn(turnPolicy, "saveVoiceTurnEndChoice").mockImplementation(() => {
    throw new Error("preference save refused");
  });
  try {
    const manual = container.querySelector<HTMLButtonElement>(
      '[data-setting-id="voice-manual-turn-end"] button[role="switch"]',
    )!;
    await act(() => manual.click());
    const advanced = container.querySelector<HTMLButtonElement>(
      '[data-setting-id="voice-advanced"] h3 button',
    )!;
    await act(() => advanced.click());
    expect(advanced.textContent).toContain("Needs attention");
    expect(advanced.getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("bycoda.voice")).toBe(saved);
    expect(backend.setup).not.toHaveBeenCalled();
  } finally {
    refusal.mockRestore();
  }
});

it("chooses the conversation mode; cloud modes hide the local reply voice and processing", async () => {
  await setup();
  await advance();
  const radio = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (option) => option.textContent?.trim() === name,
    )!;
  expect(radio("Local").getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector('[data-setting-id="voice-engine"]')).not.toBeNull();
  await act(async () => radio("Grok Voice").click());
  expect(loadVoiceSettings().mode).toBe("grok");
  expect(container.textContent).toContain("Voice runs on Grok Voice.");
  expect(document.querySelector('[data-setting-id="voice-engine"]')).toBeNull();
  expect(document.querySelector('[data-setting-id="voice-device"]')).toBeNull();
  await act(async () => radio("OpenAI Realtime").click());
  expect(loadVoiceSettings().mode).toBe("openai");
});

it("never offers GPU support for the default Natural voice, which runs on the CPU", async () => {
  backend.inspect.mockResolvedValue({
    ready: true,
    missing: [],
    gpu: "NVIDIA GeForce RTX 4070",
    accelerated: false,
  });
  await setup();
  await advance();
  expect(container.textContent).toContain("Voice is ready");
  expect(container.textContent).not.toContain("Install GPU support");
});

it("keeps the ElevenLabs key on the Host and rechecks the setup after saving it", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), engine: "elevenlabs" });
  backend.setCloudKey.mockResolvedValue({ elevenlabs: true });
  await setup();
  await advance();
  expect(backend.inspect).toHaveBeenLastCalledWith({ natural: true, engine: "elevenlabs" });
  const field = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(field).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, " sk_test ");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save");
  expect(backend.setCloudKey).toHaveBeenCalledExactlyOnceWith("elevenlabs", "sk_test");
  expect(container.textContent).toContain("Key saved");
  expect(field.value).toBe("");
  await advance();
  expect(backend.inspect).toHaveBeenCalledTimes(2);
});

it("shows the speaker choice for Supertonic and cloud conversations, not for VoxCPM2", async () => {
  await setup();
  await advance();
  expect(document.querySelector('[data-setting-id="voice-speaker"]')).not.toBeNull();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), engine: "voxcpm2" }));
  expect(document.querySelector('[data-setting-id="voice-speaker"]')).toBeNull();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), mode: "grok" }));
  expect(document.querySelector('[data-setting-id="voice-speaker"]')).not.toBeNull();
});

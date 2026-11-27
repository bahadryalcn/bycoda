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
  transcriptionModels: vi.fn(),
}));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: backend.browse }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: backend.openUrl }));
vi.mock("../../assistant/model/assistantClient", () => ({
  useAssistantSnapshot: () => ({ snapshot: undefined }),
  assistantIdentity: () => ({ title: "Assistant" }),
}));
import { RevealedSetting } from "../../../shared/ui/settings";
import { clearRetainedVoiceDrafts } from "../model/voiceSettingsDrafts";
import { voiceSaveFailures } from "../model/voiceSettingsSave";
import { VoiceSettings } from "./VoiceSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
import * as turnPolicy from "../model/voiceTurnPolicy";
import { VOICE_TURN_CHOICE_FAILED } from "../model/voiceTurnPolicy";
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
  backend.transcriptionModels.mockResolvedValue([
    { id: "openai/gpt-4o-mini-transcribe", label: "OpenAI GPT-4o mini Transcribe" },
  ]);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  clearRetainedVoiceDrafts();
  voiceSaveFailures.clear();
  vi.restoreAllMocks();
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

it("shows the wake rows only once voice is on, without changing any opt-in", async () => {
  await setup(false);
  const row = (id: string) => container.querySelector(`[data-setting-id="${id}"]`);
  // Wake lives with the voice assistant; there is no dimmed stub while voice is off.
  expect(row("voice-wake")).toBeNull();
  expect(row("voice-wake-phrase")).toBeNull();

  await act(async () =>
    row("voice-companion")!.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
  );
  expect(loadVoiceSettings().enabled).toBe(true);
  expect(loadVoiceSettings().wakeEnabled).not.toBe(true);
  expect(row("voice-wake")!.closest("[hidden]")).toBeNull();
  expect(row("voice-wake-phrase")).toBeNull();
  expect(loadVoiceSettings().wakeEnabled).not.toBe(true);

  await act(async () =>
    row("voice-wake")!.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
  );
  expect(row("voice-wake-phrase")!.querySelector("input")).not.toBeNull();
  expect(row("voice-sleep-phrase")!.querySelector("input")).not.toBeNull();
  expect(loadVoiceSettings().wakeEnabled).toBe(true);
  expect(backend.setup).not.toHaveBeenCalled();
});
it("enables dictation independently without microphone capture or companion settings", async () => {
  await setup(false);
  const capture = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: capture },
  });
  const toggle = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Dictation"]',
  )!;
  await act(async () => toggle.click());
  await advance();
  expect(loadVoiceSettings()).toMatchObject({
    enabled: false,
    dictationEnabled: true,
    natural: true,
  });
  expect(backend.inspect).toHaveBeenLastCalledWith({ natural: false });
  expect(container.textContent).toContain("Setup");
  expect(container.querySelector('[data-setting-id="voice-mode"]')).toBeNull();
  expect(container.querySelector('[data-setting-id="voice-microphone-input"]')).not.toBeNull();
  expect(capture).not.toHaveBeenCalled();
});

it("applies recognition-only installation paths without changing companion playback preferences", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    enabled: false,
    dictationEnabled: true,
    natural: true,
    engine: "voxcpm2",
  });
  backend.setupStatus.mockResolvedValue({
    state: "ready",
    requestedConfig: { natural: false },
    config: { natural: false, python: "private-python", whisperPath: "recognizer" },
  });
  await setup(false);
  expect(loadVoiceSettings()).toMatchObject({
    enabled: false,
    dictationEnabled: true,
    natural: true,
    engine: "voxcpm2",
    python: "private-python",
    whisperPath: "recognizer",
  });
});

it("does not apply an old default-engine setup after the owner selects another engine", async () => {
  let finish!: (value: unknown) => void;
  backend.setupStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup();
  await act(async () =>
    saveVoiceSettings({ ...loadVoiceSettings(), engine: "voxcpm2", device: "gpu" }),
  );
  await act(async () =>
    finish({
      state: "ready",
      requestedConfig: { natural: true },
      config: { python: "old-python", whisperPath: "old-whisper" },
    }),
  );
  expect(loadVoiceSettings()).toMatchObject({
    engine: "voxcpm2",
    device: "gpu",
    python: "",
    whisperPath: "",
  });
});
it("retains the saved automatic pause while ending turns manually, then returns to it", async () => {
  saveVoiceSettings({
    ...loadVoiceSettings(),
    manualTurnEnd: false,
    manualTurnEndRevision: 9,
    turnEndSilence: 4,
  });
  await setup();
  await chooseTurnEnd("I end my turn");
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 10,
    turnEndSilence: 4,
  });
  await chooseTurnEnd("Extra time");
  expect(loadVoiceSettings()).toMatchObject({
    manualTurnEnd: false,
    manualTurnEndRevision: 11,
    turnEndSilence: 4,
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Interrupt replies by speaking"]',
      )!
      .click(),
  );
  expect(loadVoiceSettings().allowBargeIn).toBe(false);
});
async function chooseTurnEnd(option: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-setting-id="voice-turn-silence"] button[aria-label^="Wait before replying:"]',
  )!;
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent === option,
  )!;
  expect(item, option).toBeDefined();
  await act(async () => item.click());
}
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
  await click("Locate files");
}
it("does not check or install until enabled; shows only the next actions for missing setup", async () => {
  await setup(false);
  await advance();
  expect(backend.inspect).not.toHaveBeenCalled();
  expect(backend.setupStatus).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  await advance();
  expect(container.textContent).toContain("Setup needed");
  expect(
    [...document.querySelectorAll("button")].some(
      (el) => el.textContent?.trim() === "Locate files",
    ),
  ).toBe(true);
  expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
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
  expect(container.textContent).toContain("Checking…");
  await advance();
  expect(backend.inspect).toHaveBeenLastCalledWith({
    natural: true,
    engine: "voxcpm2",
    ttsPath: "G:\\Models\\VoxCPM2",
  });
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps the locate dialog to its fields and close, without a second detection action", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), python: "old-python", whisperPath: "old-model" });
  await setup();
  await advance();
  await openLocate();
  const dialog = document.querySelector('[role="dialog"]')!;
  const labels = [...dialog.querySelectorAll("button")].map((el) => el.textContent?.trim());
  expect(labels).not.toContain("Automatic detection");
  expect(labels).not.toContain("Done");
  expect(
    [...dialog.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
  ).toEqual(["old-python", "old-model"]);
  expect(loadVoiceSettings()).toMatchObject({ python: "old-python", whisperPath: "old-model" });
  expect(backend.setup).not.toHaveBeenCalled();
});

it("offers automatic processing when the selected GPU is unavailable", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), device: "gpu" });
  backend.inspect.mockResolvedValueOnce({ ready: false, missing: ["NVIDIA GPU"] });
  await setup();
  await advance();
  await click("Use automatic selection");
  expect(loadVoiceSettings().device).toBe("auto");
  await advance();
  expect(backend.inspect).toHaveBeenLastCalledWith({ natural: true });
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
  expect(container.textContent).toContain("Checking…");
  backend.setup.mockResolvedValue({ state: "installing", stage: "packages" });
  await click("Install");
  expect(backend.setup).toHaveBeenCalledExactlyOnceWith({ natural: true });
  await act(async () => finish({ ready: true, missing: [] }));
  expect(container.textContent).toContain("Installing voice support…");
  expect(container.textContent).not.toContain("Ready");
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
  expect(container.textContent).toContain("Ready");
  await act(async () => finish({ ready: false, missing: ["Python"] }));
  expect(container.textContent).toContain("Ready");
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
  expect(container.textContent).not.toContain("Locate files");
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
  expect(container.textContent).not.toContain("Locate files");
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
  expect(container.textContent).toContain("Ready");
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
  expect(container.textContent).toContain("Ready");
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
  expect(container.textContent).toContain("Ready");
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

it("shows conversation and companion preferences without changing saved values or starting setup", async () => {
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
  for (const id of ["voice-turn-silence", "voice-idle-sleep", "voice-visual-style", "voice-device"])
    expect(container.querySelector(`[data-setting-id="${id}"]`), id).not.toBeNull();
  expect(
    container.querySelector('[data-setting-id="voice-turn-silence"]')?.closest("[hidden]"),
  ).toBeNull();
  expect(
    container
      .querySelector('[data-setting-id="voice-turn-silence"] button:not(.settings-reset)')
      ?.getAttribute("aria-label"),
  ).toBe("Wait before replying: I end my turn");
  // Each changed preference offers its Restore default action; showing it saves nothing.
  for (const id of ["voice-turn-silence", "voice-idle-sleep", "voice-visual-style", "voice-device"])
    expect(container.querySelector(`[data-setting-id="${id}"] .settings-reset`), id).not.toBeNull();
  expect(localStorage.getItem("bycoda.voice")).toBe(saved);
  expect(backend.inspect).toHaveBeenCalledTimes(calls);
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps a failed manual-turn save visible on its row", async () => {
  await setup();
  await advance();
  const saved = localStorage.getItem("bycoda.voice");
  const refusal = vi.spyOn(turnPolicy, "saveVoiceTurnEndChoice").mockImplementation(() => {
    throw new Error("preference save refused");
  });
  try {
    await chooseTurnEnd("I end my turn");
    expect(
      container.querySelector('[data-setting-id="voice-turn-silence"]')!.textContent,
    ).toContain(VOICE_TURN_CHOICE_FAILED);
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
  expect(container.textContent).toContain("Ready");
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
  expect(container.textContent).toContain("Saved");
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

it("keeps one microphone row with a test, no activity or permission rows, and no capture", async () => {
  await setup(false);
  await advance();
  const capture = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: capture, enumerateDevices: vi.fn(async () => []) },
  });
  const row = document.querySelector('[data-setting-id="voice-microphone-input"]');
  expect(row?.textContent).toContain("Record test");
  expect(document.querySelector('[data-setting-id="voice-activity"]')).toBeNull();
  expect(document.querySelector('[data-setting-id="speech-microphone"]')).toBeNull();
  expect(document.querySelector('[data-setting-id="voice-microphone-recording"]')).toBeNull();
  expect(backend.inspect).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});

it("chooses the default cloud dictation model per provider", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true, dictationEngine: "local" });
  await setup(false);
  const model = () => document.querySelector('[data-setting-id="dictation-model"]');
  expect(model()).toBeNull();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), dictationEngine: "openai" }));
  expect(model()?.textContent).toContain("GPT-4o mini Transcribe");
  await act(async () =>
    saveVoiceSettings({
      ...loadVoiceSettings(),
      dictationModels: { openai: "gpt-4o-transcribe", openrouter: "made/up" },
    }),
  );
  expect(model()?.textContent).toContain("GPT-4o Transcribe");
  // OpenRouter model IDs are preserved until the live catalog can validate them.
  expect(loadVoiceSettings().dictationModels).toEqual({
    openai: "gpt-4o-transcribe",
    openrouter: "made/up",
  });
  expect(document.querySelector('[data-setting-id="voice-openrouter-key"]')).toBeNull();
  await act(async () =>
    saveVoiceSettings({ ...loadVoiceSettings(), dictationEngine: "openrouter" }),
  );
  expect(document.querySelector('[data-setting-id="voice-openrouter-key"]')).not.toBeNull();
});

it("shows core voice choices and every dictation detail without disclosures", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true, dictationEngine: "openai" });
  await setup();
  const row = (id: string) => container.querySelector<HTMLElement>(`[data-setting-id="${id}"]`)!;
  for (const id of [
    "voice-mode",
    "dictation-engine",
    "dictation-model",
    "dictation-language",
    "dictation-shortcut-mode",
    "dictation-dictionary",
  ])
    expect(row(id).closest("[hidden]"), id).toBeNull();
  expect(container.querySelector('[data-settings-part="advanced"]')).toBeNull();
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps saved values and row-local retry when ordinary Voice preferences fail", async () => {
  await setup(false);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  const row = container.querySelector('[data-setting-id="voice-companion"]')!;
  await act(async () => row.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(loadVoiceSettings().enabled).toBe(false);
  expect(row.textContent).toContain("could not be saved");
  expect(row.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await act(async () =>
    [...row.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(),
  );
  expect(loadVoiceSettings().enabled).toBe(true);
  expect(row.textContent).not.toContain("could not be saved");
});

it.each([
  "dictation-dictionary",
  "dictation-local-models",
  "dictation-cleanup",
  "dictation-shortcut-mode",
])("reveals %s directly while dictation is off, without enabling or capture", async (target) => {
  await setup(false);
  const before = loadVoiceSettings();
  await act(async () =>
    root!.render(
      createElement(RevealedSetting.Provider, { value: target }, createElement(VoiceSettings)),
    ),
  );
  const row = container.querySelector(`[data-setting-id="${target}"]`)!;
  expect(row.closest("[hidden]")).toBeNull();
  expect(row.textContent).not.toContain("Enable dictation to use this setting");
  expect(loadVoiceSettings()).toEqual(before);
  expect(backend.setup).not.toHaveBeenCalled();
});

it("reveals the local models row under cloud recognition without changing provider", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), dictationEnabled: true, dictationEngine: "openai" });
  await setup(false);
  await act(async () =>
    root!.render(
      createElement(
        RevealedSetting.Provider,
        { value: "dictation-local-models" },
        createElement(VoiceSettings),
      ),
    ),
  );
  const row = container.querySelector('[data-setting-id="dictation-local-models"]')!;
  expect(row.closest("[hidden]")).toBeNull();
  expect(loadVoiceSettings().dictationEngine).toBe("openai");
  expect(backend.setup).not.toHaveBeenCalled();
});

it("attaches failed memory changes to their own rows with retry", async () => {
  await setup(true);
  const write = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  const memory = container.querySelector('[data-setting-id="voice-memory"]')!;
  await act(async () => memory.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(memory.textContent).toContain("could not be saved");
  expect(memory.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  write.mockRestore();
  await act(async () =>
    [...memory.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click(),
  );
  expect(memory.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});

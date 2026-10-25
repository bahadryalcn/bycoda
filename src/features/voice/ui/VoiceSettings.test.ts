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
}));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: backend.browse }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: backend.openUrl }));
import { VoiceSettings } from "./VoiceSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
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
it("does not check or install until enabled; shows only the next actions for missing setup", async () => {
  await setup(false);
  await advance();
  expect(backend.inspect).not.toHaveBeenCalled();
  expect(backend.setupStatus).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  await advance();
  expect(container.textContent).toContain("Voice setup is needed");
  expect(container.textContent).toContain("Locate existing");
  expect(container.textContent).not.toMatch(
    /faster-whisper|VoxCPM2|pip install|Python executable|Missing:/,
  );
  expect(backend.setup).not.toHaveBeenCalled();
});
it("keeps locations behind a dialog, saves a picked folder and discards stale detection", async () => {
  await setup();
  await advance();
  await click("Locate existing");
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
    ttsPath: "G:\\Models\\VoxCPM2",
  });
  expect(backend.setup).not.toHaveBeenCalled();
});

it("keeps folder selection progress on one Browse action and suppresses duplicate dialogs", async () => {
  await setup();
  await advance();
  await click("Locate existing");
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

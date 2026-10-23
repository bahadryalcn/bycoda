// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ inspect: vi.fn(), browse: vi.fn() }));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: { inspect: backend.inspect } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: backend.browse }));
import { VoiceSettings } from "./VoiceSettings";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(VoiceSettings)));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text),
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it("does not probe when disabled; lists missing models and accepts an existing installation folder", async () => {
  backend.inspect.mockResolvedValue({ ready: false, python: "python", missing: ["VoxCPM2 model"] });
  await setup();
  expect(backend.inspect).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Check installation");
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), enabled: true }));
  await click("Check installation");
  expect(container.textContent).toContain("Missing: VoxCPM2 model");
  await click("Installation paths and setup");
  backend.browse.mockResolvedValue("G:\\Models\\VoxCPM2");
  const browseButtons = [...container.querySelectorAll("button")].filter((button) =>
    button.textContent?.includes("Browse"),
  );
  expect(browseButtons).toHaveLength(3);
  await act(async () => browseButtons[2].click());
  expect(loadVoiceSettings().ttsPath).toBe("G:\\Models\\VoxCPM2");
  // A result from the former automatic paths must disappear immediately.
  expect(container.textContent).not.toContain("Missing: VoxCPM2 model");
  await click("Check installation");
  expect(backend.inspect).toHaveBeenLastCalledWith({
    natural: true,
    ttsPath: "G:\\Models\\VoxCPM2",
  });
});

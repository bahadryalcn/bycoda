// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  inspect: vi.fn(),
  secret: vi.fn(),
}));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: { inspect: runtime.inspect } }));
vi.mock("../model/realtimeVoiceClient", () => ({ realtimeSecret: runtime.secret }));
vi.mock("./MicrophoneInputSettings", () => ({
  MicrophoneInputSettings: () => "Local microphone test",
}));
import { VoiceSetupSteps } from "./VoiceSetupSteps";
import { loadVoiceSettings, saveVoiceSettings } from "../model/voiceSettings";
let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});
async function render(step: "provider" | "microphone") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const valid = vi.fn();
  await act(async () =>
    root!.render(createElement(VoiceSetupSteps, { step, onValidChange: valid, language: "tr-TR" })),
  );
  return valid;
}
async function click(label: string) {
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click(),
  );
}
it("uses the local microphone test without making a provider connection", async () => {
  await render("microphone");
  expect(container.textContent).toBe("Local microphone test");
  expect(runtime.inspect).not.toHaveBeenCalled();
  expect(runtime.secret).not.toHaveBeenCalled();
});
it("does not verify a provider after its settings changed while the check was pending", async () => {
  let finish!: (value: unknown) => void;
  runtime.inspect.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const valid = await render("provider");
  await click("Check Local");
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), mode: "openai" }));
  valid.mockClear();
  await act(async () => finish({ ready: true, missing: [] }));
  expect(valid).not.toHaveBeenCalledWith(true);
});
it("shows an actual successful check and invalidates it when the chosen provider changes", async () => {
  runtime.inspect.mockResolvedValue({ ready: true, missing: [] });
  const valid = await render("provider");
  expect(runtime.inspect).not.toHaveBeenCalled();
  expect(runtime.secret).not.toHaveBeenCalled();
  await click("Check Local");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Ready");
  expect(valid).toHaveBeenLastCalledWith(true);
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), mode: "openai" }));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  expect(valid).toHaveBeenLastCalledWith(false);
});
it("keeps a failed provider check retryable without opening the microphone", async () => {
  runtime.inspect
    .mockRejectedValueOnce(new Error("Fixture connection unavailable"))
    .mockResolvedValueOnce({ ready: true, missing: [] });
  const valid = await render("provider");
  await click("Check Local");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not check the voice provider.",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(
    "Fixture connection unavailable",
  );
  await click("Details");
  expect(document.body.textContent).toContain("Fixture connection unavailable");
  await click("Details");
  expect(valid).not.toHaveBeenCalledWith(true);
  await click("Check Local");
  expect(valid).toHaveBeenLastCalledWith(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(runtime.secret).not.toHaveBeenCalled();
});
it("does not retain a successful indication when an explicit recheck fails", async () => {
  runtime.inspect
    .mockResolvedValueOnce({ ready: true, missing: [] })
    .mockRejectedValueOnce(new Error("Fixture connection lost"));
  const valid = await render("provider");
  await click("Check Local");
  expect(valid).toHaveBeenLastCalledWith(true);
  await click("Check Local");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  expect(valid).toHaveBeenLastCalledWith(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not check the voice provider.",
  );
  await click("Details");
  expect(document.body.textContent).toContain("Fixture connection lost");
});

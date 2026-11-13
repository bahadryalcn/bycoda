// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ cloudStatus: vi.fn(), setCloudKey: vi.fn() }));
vi.mock("../model/localVoiceClient", () => ({ localVoiceBackend: backend }));
import { VoiceCloudKey } from "./VoiceCloudKey";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
}
async function type(value: string) {
  const field = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["elevenlabs", "openrouter"] as const)(
  "keeps %s status unknown on failed read and retains password through retry",
  async (provider) => {
    let reject!: (cause: Error) => void;
    backend.cloudStatus.mockReturnValueOnce(
      new Promise((_, no) => {
        reject = no;
      }),
    );
    await act(async () => root.render(createElement(VoiceCloudKey, { provider })));
    expect(host.textContent).toContain("Checking saved key");
    await type("draft-secret");
    expect(
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Save")!
        .disabled,
    ).toBe(true);
    await act(async () => reject(new Error("Host unavailable")));
    expect(host.textContent).toContain("Could not check saved key");
    expect(host.querySelector("input")!.placeholder).toBe("Key status unknown");
    backend.cloudStatus.mockResolvedValue({ [provider]: true });
    await click("Retry status");
    expect(host.textContent).toContain("Key saved");
    expect(host.querySelector("input")!.value).toBe("draft-secret");
    expect(host.querySelector("input")!.type).toBe("password");
    expect(backend.setCloudKey).not.toHaveBeenCalled();
    backend.setCloudKey.mockRejectedValue(new Error("The key could not be saved."));
    await click("Save");
    expect(host.querySelector("input")!.value).toBe("draft-secret");
    expect(host.textContent).toContain("Key saved");
    await click("Remove");
    expect(host.textContent).toContain("Key saved");
    expect(host.querySelector("input")!.value).toBe("draft-secret");
    backend.setCloudKey.mockResolvedValue({ [provider]: false });
    await click("Remove");
    expect(host.textContent).not.toContain("Key saved");
    expect(host.querySelector("input")!.value).toBe("");
  },
);
it("accepts authoritative absent status and ignores a late read after provider change", async () => {
  let finish!: (value: { elevenlabs: boolean }) => void;
  backend.cloudStatus.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(VoiceCloudKey, { provider: "elevenlabs" })));
  await type("eleven-only");
  backend.cloudStatus.mockResolvedValue({ openrouter: false });
  await act(async () => root.render(createElement(VoiceCloudKey, { provider: "openrouter" })));
  await act(async () => finish({ elevenlabs: true }));
  expect(host.textContent).not.toContain("Key saved");
  expect(host.querySelector("input")!.placeholder).toBe("Paste API key");
  expect(host.querySelector("input")!.value).toBe("");
  expect(backend.setCloudKey).not.toHaveBeenCalled();
});

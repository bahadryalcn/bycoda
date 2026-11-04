// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ mac: false, win: false, linux: false, native: true }));
const openPrivacySettings = vi.hoisted(() => vi.fn(async (_pane: string) => {}));
vi.mock("../../../platform/tauri/platform", () => ({
  get IS_MAC() { return platform.mac; },
  get IS_WIN() { return platform.win; },
  get IS_LINUX() { return platform.linux; },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.native }));
vi.mock("../../../platform/tauri/privacySettings", () => ({ openPrivacySettings }));

import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import { microphoneBlockedMessage } from "../model/microphoneAccess";

let root: Root | undefined;
let element: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element?.remove();
  Object.assign(platform, { mac: false, win: false, linux: false, native: true });
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render(message = microphoneBlockedMessage()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root!.render(createElement(MicrophoneRecoveryAction, { message })));
  return () => element!.querySelector("button");
}

it.each(["mac", "win"] as const)("opens %s microphone settings without claiming a grant", async (os) => {
  platform[os] = true;
  const button = await render();
  expect(button()?.getAttribute("aria-label") ?? button()?.textContent).toContain("Open Privacy Settings");
  await act(async () => button()!.click());
  expect(openPrivacySettings).toHaveBeenCalledExactlyOnceWith("microphone");
  expect(element?.textContent).not.toContain("allowed");
});

it.each(["linux", "browser"])("does not offer an unsupported %s settings route", async (target) => {
  platform.linux = target === "linux";
  platform.mac = target === "browser";
  platform.native = target !== "browser";
  const button = await render();
  expect(button()).toBeNull();
  expect(openPrivacySettings).not.toHaveBeenCalled();
});

it("does not offer microphone settings for unrelated errors", async () => {
  platform.win = true;
  const button = await render("No microphone was found.");
  expect(button()).toBeNull();
});

it("guards duplicate opens and reports launch failure for retry", async () => {
  platform.win = true;
  let reject!: (cause: Error) => void;
  openPrivacySettings.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const button = await render();
  await act(async () => { button()!.click(); button()!.click(); });
  expect(openPrivacySettings).toHaveBeenCalledOnce();
  expect(button()?.getAttribute("aria-busy")).toBe("true");
  expect(button()?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => reject(new Error("native route failed")));
  expect(element?.textContent).toContain("Could not open microphone settings. Open your system settings manually.");
  expect(button()?.disabled).toBe(false);
  await act(async () => button()!.click());
  expect(openPrivacySettings).toHaveBeenCalledTimes(2);
  expect(element?.textContent).not.toContain("Could not open");
});

it("ignores settings launch completion after unmount", async () => {
  platform.mac = true;
  let reject!: (cause: Error) => void;
  openPrivacySettings.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const button = await render();
  await act(async () => button()!.click());
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => reject(new Error("native route failed")));
  expect(element?.textContent).toBe("");
});

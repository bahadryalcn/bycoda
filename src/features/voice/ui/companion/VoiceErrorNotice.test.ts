// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ mac: false, win: false, native: true }));
const openPrivacySettings = vi.hoisted(() => vi.fn(async (_pane: string) => {}));
vi.mock("../../../../platform/tauri/platform", () => ({
  get IS_MAC() {
    return platform.mac;
  },
  get IS_WIN() {
    return platform.win;
  },
  get IS_LINUX() {
    return !platform.mac && !platform.win;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.native }));
vi.mock("../../../../platform/tauri/privacySettings", () => ({ openPrivacySettings }));

import { VoiceErrorNotice } from "./VoiceErrorNotice";
import { microphoneBlockedMessage } from "../../model/microphoneAccess";

let root: Root | undefined;
let element: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  element?.remove();
  Object.assign(platform, { mac: false, win: false, native: true });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(["mac", "win", "linux", "browser"] as const)(
  "shows blocked microphone recovery and dismissal directly in the %s error notice",
  async (target) => {
    platform.mac = target === "mac" || target === "browser";
    platform.win = target === "win";
    platform.native = target !== "browser";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
    const onDismiss = vi.fn();
    const error = microphoneBlockedMessage();
    await act(async () => root!.render(createElement(VoiceErrorNotice, { error, onDismiss })));
    const dialog = element;
    expect(dialog.textContent).toContain(error);
    const recovery = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Open Privacy Settings",
    );
    if (target === "mac" || target === "win") {
      expect(recovery).toBeDefined();
      await act(async () => recovery!.click());
      expect(openPrivacySettings).toHaveBeenCalledExactlyOnceWith("microphone");
      expect(onDismiss).not.toHaveBeenCalled();
    } else expect(recovery).toBeUndefined();
    const dismiss = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Dismiss",
    )!;
    await act(async () => dismiss.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  },
);

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const nativeStatus = vi.hoisted(() => vi.fn(async () => undefined as unknown));
vi.mock("../../../platform/tauri/systemPermissions", () => ({
  systemPermissionsStatus: nativeStatus,
}));

const platform = vi.hoisted(() => ({ mac: false, win: false, linux: false, native: true }));
vi.mock("../../../platform/tauri/platform", () => ({
  get IS_MAC() {
    return platform.mac;
  },
  get IS_WIN() {
    return platform.win;
  },
  get IS_LINUX() {
    return platform.linux;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.native }));
vi.mock("../../../shared/i18n", () => ({ t: (message: string) => message }));

import {
  canOpenMicrophoneSettings,
  isMacMicrophoneBlocked,
  isMicrophoneBlocked,
  microphoneBlockedMessage,
  openMicrophone,
} from "./microphoneAccess";

afterEach(() => {
  Object.assign(platform, { mac: false, win: false, linux: false, native: true });
  nativeStatus.mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

function capture(result: Promise<unknown>) {
  const getUserMedia = vi.fn(() => result);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return getUserMedia;
}

it.each([
  ["mac", "System Settings > Privacy & Security > Microphone", true],
  ["win", "Windows Settings > Privacy & security > Microphone", true],
  ["linux", "app or sandbox microphone permissions", false],
] as const)(
  "gives %s denial recovery without claiming a permission grant",
  async (os, instruction, canOpen) => {
    platform[os] = true;
    // DOMException-like objects can be produced by another realm.
    const getUserMedia = capture(Promise.reject({ name: "NotAllowedError" }));
    await expect(openMicrophone({ audio: true })).rejects.toMatchObject({
      name: "NotAllowedError",
      message: expect.stringContaining(instruction),
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(canOpenMicrophoneSettings()).toBe(canOpen);
    expect(isMicrophoneBlocked(microphoneBlockedMessage())).toBe(true);
    expect(isMacMicrophoneBlocked(microphoneBlockedMessage())).toBe(os === "mac");
    expect(isMicrophoneBlocked("unrelated error")).toBe(false);
  },
);

it("uses browser site recovery and never offers a native settings launch for a browser", () => {
  platform.mac = true;
  platform.native = false;
  expect(microphoneBlockedMessage()).toContain("this site in your browser");
  expect(canOpenMicrophoneSettings()).toBe(false);
});

it.each(["PermissionDeniedError", "SecurityError"])(
  "normalizes %s as owner-action denial",
  async (name) => {
    capture(Promise.reject(new DOMException("Blocked", name)));
    await expect(openMicrophone({ audio: true })).rejects.toMatchObject({
      name: "NotAllowedError",
      message: microphoneBlockedMessage(),
    });
  },
);

it.each([
  ["NotFoundError", "No microphone was found"],
  ["DevicesNotFoundError", "No microphone was found"],
  ["NotReadableError", "Close other apps using it"],
  ["TrackStartError", "Close other apps using it"],
  ["AbortError", "Close other apps using it"],
  ["OverconstrainedError", "Select another input device"],
  ["ConstraintNotSatisfiedError", "Select another input device"],
])("keeps %s distinct from blocked permission", async (name, message) => {
  capture(Promise.reject(new DOMException("Device problem", name)));
  await expect(openMicrophone({ audio: true })).rejects.toMatchObject({
    name,
    message: expect.stringContaining(message),
  });
});

it("reports unavailable capture APIs without a permission request", async () => {
  vi.stubGlobal("navigator", { mediaDevices: undefined });
  await expect(openMicrophone({ audio: true })).rejects.toMatchObject({
    name: "NotSupportedError",
    message: expect.stringContaining("secure browser context"),
  });
});

it("returns the exact stream and constraints to the capture lifetime owner", async () => {
  const stream = { getTracks: vi.fn() };
  const getUserMedia = capture(Promise.resolve(stream));
  const constraints = { audio: { deviceId: { exact: "owner-mic" } }, video: false };
  await expect(openMicrophone(constraints)).resolves.toBe(stream);
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith(constraints);
});

it("preserves unclassified errors rather than labelling them as permission denial", async () => {
  const cause = new Error("Unexpected capture failure");
  capture(Promise.reject(cause));
  await expect(openMicrophone({ audio: true })).rejects.toBe(cause);
});

it("distinguishes a webview refusal after an OS microphone grant", async () => {
  nativeStatus.mockResolvedValue({ entries: [{ id: "microphone", state: "granted" }] });
  capture(Promise.reject({ name: "NotAllowedError" }));
  await expect(openMicrophone({ audio: true })).rejects.toMatchObject({
    name: "NotAllowedError",
    message: expect.stringContaining("app webview blocked it"),
  });
});

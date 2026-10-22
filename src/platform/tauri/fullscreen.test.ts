import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  windows: true,
  maximized: false,
  fullscreen: false,
  calls: [] as string[],
  fail: false,
  gate: undefined as Promise<void> | undefined,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => native.fullscreen,
    isMaximized: async () => native.maximized,
    toggleMaximize: async () => {
      native.maximized = !native.maximized;
      native.calls.push(`maximize:${native.maximized}`);
    },
    setFullscreen: async (full: boolean) => {
      native.calls.push(`fullscreen:${full}`);
      if (native.fail) throw new Error("Native transition failed");
      // Model the native defect: maximizing clips the client to the work area.
      if (native.windows && full && native.maximized) throw new Error("Clipped client area");
      native.fullscreen = full;
    },
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, input: { fullscreen: boolean }) => {
    expect(command).toBe("set_window_fullscreen");
    native.calls.push(`fullscreen:${input.fullscreen}`);
    if (native.gate) await native.gate;
    if (native.fail) throw new Error("Native transition failed");
    native.fullscreen = input.fullscreen;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("navigator", { platform: "Win32" });
  Object.assign(native, {
    windows: true,
    maximized: false,
    fullscreen: false,
    calls: [],
    fail: false,
    gate: undefined,
  });
});

afterEach(() => vi.unstubAllGlobals());

it("uses the Windows client-area fix without shrinking a maximized window", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  native.maximized = true;
  expect(await setNativeFullscreen()).toBe(true);
  expect(native.calls).toEqual(["fullscreen:true"]);
  expect(native.maximized).toBe(true);
  expect(await setNativeFullscreen(false)).toBe(false);
  expect(native.calls).toEqual(["fullscreen:true", "fullscreen:false"]);
  expect(native.maximized).toBe(true);
});

it("keeps a normal window normal after toggling twice", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  await setNativeFullscreen();
  await setNativeFullscreen();
  expect(native.calls).toEqual(["fullscreen:true", "fullscreen:false"]);
  expect(native.maximized).toBe(false);
});

it("preserves maximization when entering fullscreen fails", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  native.maximized = true;
  native.fail = true;
  await expect(setNativeFullscreen()).rejects.toThrow("Native transition failed");
  expect(native.maximized).toBe(true);
  native.fail = false;
  await setNativeFullscreen();
  await setNativeFullscreen(false);
  expect(native.maximized).toBe(true);
});

it("keeps fullscreen and maximization if exiting fullscreen fails", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  native.maximized = true;
  await setNativeFullscreen();
  native.fail = true;
  await expect(setNativeFullscreen(false)).rejects.toThrow("Native transition failed");
  expect(native.fullscreen).toBe(true);
  expect(native.maximized).toBe(true);
  native.fail = false;
  await setNativeFullscreen(false);
  expect(native.maximized).toBe(true);
});

it("coalesces concurrent button and keyboard transitions", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  const first = setNativeFullscreen();
  const second = setNativeFullscreen();
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(native.calls).toEqual(["fullscreen:true"]);
});

it("runs an opposite request made during a transition after it", async () => {
  const { setNativeFullscreen } = await import("./fullscreen");
  let release!: () => void;
  native.gate = new Promise<void>((resolve) => (release = resolve));
  const enter = setNativeFullscreen(true);
  await vi.waitFor(() => expect(native.calls).toEqual(["fullscreen:true"]));
  const exit = setNativeFullscreen(false);
  release();
  expect(await enter).toBe(true);
  expect(await exit).toBe(false);
  expect(native.calls).toEqual(["fullscreen:true", "fullscreen:false"]);
  expect(native.fullscreen).toBe(false);
});

it("leaves native maximize handling untouched on other platforms", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const { setNativeFullscreen } = await import("./fullscreen");
  native.windows = false;
  native.maximized = true;
  await setNativeFullscreen();
  await setNativeFullscreen(false);
  expect(native.calls).toEqual(["fullscreen:true", "fullscreen:false"]);
});

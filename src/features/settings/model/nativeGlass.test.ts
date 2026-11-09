// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncNativeGlass } from "./appearance";
import {
  readNativeGlassError,
  readNativeGlassPending,
  readNativeGlassRestartRequired,
} from "./nativeGlassStatus";

const platform = vi.hoisted(() => ({ isLinux: false, isWin: false }));
vi.mock("../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/platform")>()),
  get IS_LINUX() {
    return platform.isLinux;
  },
  get IS_WIN() {
    return platform.isWin;
  },
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

const BODY_GLASS_KEY = "bycoda.bodyGlass";
const WINDOW_GLASS_KEY = "bycoda.windowGlass";

function hasGlass() {
  return document.documentElement.classList.contains("has-native-glass");
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ applied: true, restartRequired: false });
  platform.isLinux = false;
  platform.isWin = false;
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  // These cases assert neutral theme RGB values, independently of the default palette.
  document.documentElement.style.setProperty("--theme-saturation", "0");
  document.documentElement.style.setProperty("--background-lightness", "9%");
  // The real token, so the tests below exercise the deferred window call rather
  // than an unparseable duration that would collapse it to zero.
  document.documentElement.style.setProperty("--motion-feedback-duration", "120ms");
});

describe("native glass", () => {
  it("turns glass on and marks the page translucent in dark mode", async () => {
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));
    expect(invoke).toHaveBeenCalledWith(
      "set_window_glass_enabled",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("turns glass off and paints the page opaque in light mode", async () => {
    syncNativeGlass("light");
    expect(hasGlass()).toBe(false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
        enabled: false,
        background: expect.any(Object),
        preference: expect.any(Boolean),
      }),
    );
  });

  it("fills an opaque window with the themed colour, not a fixed light one", async () => {
    document.documentElement.style.setProperty("--background-lightness", "20%");
    syncNativeGlass("light");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
        enabled: false,
        background: { r: 51, g: 51, b: 51 },
        preference: expect.any(Boolean),
      }),
    );
  });

  it("keeps the dark theme opaque on Linux when main pane glass is off", async () => {
    platform.isLinux = true;
    localStorage.setItem(BODY_GLASS_KEY, "0");
    syncNativeGlass("dark");
    expect(hasGlass()).toBe(false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
        enabled: false,
        background: { r: 23, g: 23, b: 23 },
        preference: expect.any(Boolean),
      }),
    );
  });

  it("enables glass on Linux once main pane glass is on", async () => {
    platform.isLinux = true;
    localStorage.setItem(BODY_GLASS_KEY, "1");
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));
    expect(invoke).toHaveBeenCalledWith(
      "set_window_glass_enabled",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("keeps the dark window opaque on Windows and macOS when window glass is off", async () => {
    localStorage.setItem(WINDOW_GLASS_KEY, "0");
    syncNativeGlass("dark");
    expect(hasGlass()).toBe(false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
        enabled: false,
        background: { r: 23, g: 23, b: 23 },
        preference: expect.any(Boolean),
      }),
    );
  });

  it("reports a restart only while the saved glass setting differs from the window", async () => {
    invoke.mockResolvedValueOnce({ applied: false, restartRequired: true });
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(readNativeGlassRestartRequired()).toBe(true));
    expect(hasGlass()).toBe(false);

    invoke.mockResolvedValueOnce({ applied: true, restartRequired: false });
    syncNativeGlass("light");
    await vi.waitFor(() => expect(readNativeGlassRestartRequired()).toBe(false));
  });

  it("defaults window glass off on Windows and on elsewhere", async () => {
    for (const isWin of [true, false]) {
      platform.isWin = isWin;
      vi.resetModules();
      const appearance = await import("./appearance");
      expect(appearance.WINDOW_GLASS_DEFAULT).toBe(!isWin);
    }
  });

  it("waits for the window to settle before the page changes", async () => {
    let settle = () => {};
    invoke.mockReturnValue(
      new Promise<unknown>((resolve) => {
        settle = () => resolve({ applied: true, restartRequired: false });
      }),
    );
    syncNativeGlass("dark");
    await Promise.resolve();
    expect(hasGlass()).toBe(false);
    expect(readNativeGlassPending()).toBe(true);
    settle();
    await vi.waitFor(() => expect(hasGlass()).toBe(true));
    expect(readNativeGlassPending()).toBe(false);
  });

  it("fades the page opaque before the window stops being transparent", async () => {
    platform.isLinux = true;
    localStorage.setItem(BODY_GLASS_KEY, "1");
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));

    invoke.mockClear();
    localStorage.setItem(BODY_GLASS_KEY, "0");
    syncNativeGlass("dark");
    expect(hasGlass()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
        enabled: false,
        background: { r: 23, g: 23, b: 23 },
        preference: expect.any(Boolean),
      }),
    );
  });

  it("drops a fade still owed to glass that is back on", async () => {
    platform.isLinux = true;
    localStorage.setItem(BODY_GLASS_KEY, "1");
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));

    invoke.mockClear();
    localStorage.setItem(BODY_GLASS_KEY, "0");
    syncNativeGlass("dark");
    localStorage.setItem(BODY_GLASS_KEY, "1");
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "set_window_glass_enabled",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("ignores an enable that a newer disable has overtaken", async () => {
    let settle = () => {};
    invoke.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    platform.isLinux = true;
    localStorage.setItem(BODY_GLASS_KEY, "1");
    syncNativeGlass("dark");
    localStorage.setItem(BODY_GLASS_KEY, "0");
    syncNativeGlass("dark");
    expect(hasGlass()).toBe(false);

    settle();
    await Promise.resolve();
    expect(readNativeGlassPending()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(hasGlass()).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith(
      "set_window_glass_enabled",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("keeps the page opaque when enabling the window fails and recovers on retry", async () => {
    invoke.mockRejectedValue(new Error("no window"));
    syncNativeGlass("light");
    await vi.waitFor(() => expect(hasGlass()).toBe(false));
    invoke.mockRejectedValue(new Error("no window"));
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(readNativeGlassError()).toBe(true));
    expect(hasGlass()).toBe(false);
    invoke.mockResolvedValue({ applied: true, restartRequired: false });
    syncNativeGlass("dark");
    await vi.waitFor(() => expect(hasGlass()).toBe(true));
    expect(readNativeGlassError()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { readBrowserSettings, writeBrowserSettings } from "./browser-settings";
import { memorySettings } from "./test-support";

describe("browser settings", () => {
  it("defaults to hidden with desktop control off", async () => {
    expect(await readBrowserSettings(memorySettings(), "acc")).toEqual({
      accountId: "acc",
      visibility: "hidden",
      desktopControl: { allowed: false },
    });
  });

  it("stores a valid choice and returns the cleaned shape", async () => {
    const store = memorySettings();
    const saved = await writeBrowserSettings(store, {
      accountId: "acc",
      visibility: "visible",
      desktopControl: { allowed: true, computerId: "pc-1" },
      extra: "dropped",
    });
    expect(saved).toEqual({
      accountId: "acc",
      visibility: "visible",
      desktopControl: { allowed: true, computerId: "pc-1" },
    });
    expect(await readBrowserSettings(store, "acc")).toEqual(saved);
  });

  it("rejects an invalid visibility, a non-boolean desktop flag, and an empty computer id", async () => {
    const store = memorySettings();
    const base = { accountId: "acc", visibility: "hidden", desktopControl: { allowed: false } };
    await expect(writeBrowserSettings(store, { ...base, visibility: "minimized" })).rejects.toThrow(
      "visibility",
    );
    await expect(
      writeBrowserSettings(store, { ...base, desktopControl: { allowed: "yes" } }),
    ).rejects.toThrow("Desktop control");
    await expect(
      writeBrowserSettings(store, { ...base, desktopControl: { allowed: true, computerId: "" } }),
    ).rejects.toThrow("computer");
    expect(store.rows.size).toBe(0);
  });

  it("reads a corrupt or mismatched row as the safe default", async () => {
    const store = memorySettings();
    store.rows.set("browser-layers.settings.acc", "{broken");
    expect((await readBrowserSettings(store, "acc")).desktopControl.allowed).toBe(false);
    store.rows.set(
      "browser-layers.settings.acc",
      JSON.stringify({
        accountId: "other",
        visibility: "visible",
        desktopControl: { allowed: true, computerId: "pc" },
      }),
    );
    expect(await readBrowserSettings(store, "acc")).toEqual({
      accountId: "acc",
      visibility: "hidden",
      desktopControl: { allowed: false },
    });
  });
});

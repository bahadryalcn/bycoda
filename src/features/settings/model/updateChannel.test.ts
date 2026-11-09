// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  Update: class {
    constructor(readonly metadata: { version: string }) {}
  },
}));

import {
  checkForAppUpdate,
  loadUpdateChannel,
  saveUpdateChannel,
  subscribeUpdateChannel,
} from "./updateChannel";

beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockReset();
});

describe("update channel", () => {
  it("follows the installed build until the user chooses", () => {
    expect(loadUpdateChannel("0.7.5")).toBe("stable");
    expect(loadUpdateChannel("0.7.6-preview.40.gabcdef012345")).toBe("preview");
    expect(loadUpdateChannel(undefined)).toBe("stable");
    saveUpdateChannel("stable");
    expect(loadUpdateChannel("0.7.6-preview.40.gabcdef012345")).toBe("stable");
    saveUpdateChannel("preview");
    expect(loadUpdateChannel("0.7.5")).toBe("preview");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("bycoda.updateChannel", "nightly");
    expect(loadUpdateChannel("0.7.5")).toBe("stable");
  });

  it("notifies subscribers when the choice changes", () => {
    const onChange = vi.fn();
    const stop = subscribeUpdateChannel(onChange);
    saveUpdateChannel("preview");
    stop();
    saveUpdateChannel("stable");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("asks the native check for the chosen channel and wraps its handle", async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    expect(await checkForAppUpdate("0.7.5")).toBeNull();
    expect(mocks.invoke).toHaveBeenLastCalledWith("app_update_check", { preview: false });

    saveUpdateChannel("preview");
    mocks.invoke.mockResolvedValueOnce({ rid: 3, version: "0.7.6-preview.41.gabcdef012345" });
    const update = await checkForAppUpdate("0.7.5");
    expect(mocks.invoke).toHaveBeenLastCalledWith("app_update_check", { preview: true });
    expect(update).toMatchObject({ metadata: { version: "0.7.6-preview.41.gabcdef012345" } });
  });
});

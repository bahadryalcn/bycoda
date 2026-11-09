import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { loadSessionFolder, saveSessionFolder } from "./sessionFolder";

describe("session folder commands", () => {
  beforeEach(() => invoke.mockReset());

  it("reads the saved choice", async () => {
    invoke.mockResolvedValue({ chosen: null, home: "/home/a" });
    expect(await loadSessionFolder()).toEqual({ chosen: null, home: "/home/a" });
    expect(invoke).toHaveBeenCalledWith("session_folder");
  });

  it("saves a folder and resets with null", async () => {
    invoke.mockResolvedValue(undefined);
    await saveSessionFolder("/work");
    await saveSessionFolder(null);
    expect(invoke).toHaveBeenNthCalledWith(1, "set_session_folder", { folder: "/work" });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_session_folder", { folder: null });
  });
});

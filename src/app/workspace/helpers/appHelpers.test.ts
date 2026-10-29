import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDiscardUnsaved, discardUnsavedMessage } from "./appHelpers";

const confirmInApp = vi.fn();
vi.mock("../../../shared/model/appConfirm", () => ({
  confirmInApp: (...args: unknown[]) => confirmInApp(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

beforeEach(() => confirmInApp.mockReset());

describe("discarding unsaved files", () => {
  it("names the file, or counts several, or speaks of the open files", () => {
    expect(discardUnsavedMessage([{ path: "/repo/src/a.ts" }])).toBe(
      "Unsaved changes in “a.ts” will be lost.",
    );
    expect(discardUnsavedMessage([{ path: "/a.ts" }, { path: "/b.ts" }])).toBe(
      "Unsaved changes in 2 files will be lost.",
    );
    expect(discardUnsavedMessage([])).toBe("Unsaved changes in the open files will be lost.");
  });

  it("asks with a danger action and returns the owner's answer unchanged", async () => {
    confirmInApp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const request = {
      title: "Close file without saving?",
      confirmLabel: "Discard and close",
      files: [{ path: "/repo/a.ts" }],
    };
    await expect(confirmDiscardUnsaved(request)).resolves.toBe(false);
    await expect(confirmDiscardUnsaved(request)).resolves.toBe(true);
    expect(confirmInApp).toHaveBeenCalledWith({
      title: "Close file without saving?",
      message: "Unsaved changes in “a.ts” will be lost.",
      confirmLabel: "Discard and close",
      tone: "danger",
    });
  });
});

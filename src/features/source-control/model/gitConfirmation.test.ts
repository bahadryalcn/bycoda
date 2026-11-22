import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDiscardFile, confirmGitAction } from "./gitConfirmation";

const mocks = vi.hoisted(() => ({ confirmInApp: vi.fn() }));
vi.mock("../../../shared/model/appConfirm", () => ({ confirmInApp: mocks.confirmInApp }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop(),
}));

beforeEach(() => mocks.confirmInApp.mockReset().mockResolvedValue(true));

describe("confirmDiscardFile", () => {
  it("separates deleting an untracked file from discarding tracked edits", async () => {
    await confirmDiscardFile({ relative: "src/new.ts", status: "untracked" } as never);
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Delete untracked file?",
        message: expect.stringContaining("“new.ts”"),
        confirmLabel: "Delete file",
        tone: "danger",
      }),
    );
    await confirmDiscardFile({ relative: "src/old.ts", status: "modified" } as never);
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Discard changes?", confirmLabel: "Discard changes" }),
    );
  });
});

describe("confirmGitAction", () => {
  it("words Cancel with the Git translator so the dialog speaks one language", async () => {
    await confirmGitAction({ title: "Delete tag?", message: "v1", confirmLabel: "Delete tag" });
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith({
      title: "Delete tag?",
      message: "v1",
      confirmLabel: "Delete tag",
      cancelLabel: "Cancel",
      tone: "danger",
    });
  });
  it("lets a caller override the Cancel wording", async () => {
    await confirmGitAction({
      title: "T?",
      message: "m",
      confirmLabel: "Go",
      cancelLabel: "Not now",
    });
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith(
      expect.objectContaining({ cancelLabel: "Not now" }),
    );
  });
});

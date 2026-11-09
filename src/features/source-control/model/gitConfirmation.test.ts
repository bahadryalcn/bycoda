import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDiscardFile, confirmNative } from "./gitConfirmation";

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

describe("confirmNative compatibility", () => {
  it("turns one sentence into a question title and an effect", async () => {
    await confirmNative("Discard changes in 3 selected files? This cannot be undone.", "Discard");
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith({
      title: "Discard changes in 3 selected files?",
      message: "This cannot be undone.",
      confirmLabel: "Discard",
      tone: "danger",
    });
  });
  it("keeps a bare question as the message and derives the title from the action", async () => {
    await confirmNative("Trust this path?", "Trust this repository");
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith({
      title: "Trust this repository?",
      message: "Trust this path?",
      confirmLabel: "Trust this repository",
      tone: "normal",
    });
  });
});

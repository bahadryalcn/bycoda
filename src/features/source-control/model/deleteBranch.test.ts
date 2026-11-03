import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteLocalBranch } from "./deleteBranch";

const mocks = vi.hoisted(() => ({ confirmInApp: vi.fn(), gitDeleteBranch: vi.fn() }));
vi.mock("../../../shared/model/appConfirm", () => ({ confirmInApp: mocks.confirmInApp }));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDeleteBranch: mocks.gitDeleteBranch,
  basename: (path: string) => path.split("/").pop(),
}));

beforeEach(() => {
  mocks.confirmInApp.mockReset();
  mocks.gitDeleteBranch.mockReset();
});

describe("deleteLocalBranch", () => {
  it("names the branch, makes Delete the danger action and deletes nothing when declined", async () => {
    mocks.confirmInApp.mockResolvedValue(false);
    await deleteLocalBranch("/repo", "feature/x");
    expect(mocks.confirmInApp).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete branch?",
        message: expect.stringContaining("“feature/x”"),
        confirmLabel: "Delete branch",
        tone: "danger",
      }),
    );
    expect(mocks.gitDeleteBranch).not.toHaveBeenCalled();
  });

  it("asks again before forcing an unmerged branch, and only forces after that answer", async () => {
    mocks.confirmInApp.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.gitDeleteBranch.mockRejectedValueOnce(
      new Error("error: The branch 'x' is not fully merged."),
    );
    await deleteLocalBranch("/repo", "x");
    expect(mocks.confirmInApp).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Delete unmerged branch?", confirmLabel: "Delete anyway" }),
    );
    expect(mocks.gitDeleteBranch).toHaveBeenCalledTimes(1);

    mocks.confirmInApp.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    mocks.gitDeleteBranch.mockRejectedValueOnce(new Error("not fully merged"));
    await deleteLocalBranch("/repo", "x");
    expect(mocks.gitDeleteBranch).toHaveBeenLastCalledWith("/repo", "x", true);
  });

  it("rethrows other Git failures without a second question", async () => {
    mocks.confirmInApp.mockResolvedValue(true);
    mocks.gitDeleteBranch.mockRejectedValue(new Error("fatal: not a repository"));
    await expect(deleteLocalBranch("/repo", "x")).rejects.toThrow("not a repository");
    expect(mocks.confirmInApp).toHaveBeenCalledTimes(1);
  });
});

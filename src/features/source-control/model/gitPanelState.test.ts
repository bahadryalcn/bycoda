import { beforeEach, expect, it } from "vitest";
import { gitPanelRuntime, resetGitPanelState, withGitOperation } from "./gitPanelState";
beforeEach(resetGitPanelState);
it("rejects overlapping operations on the same Windows checkout, but permits other checkouts", async () => {
  let finish!: () => void;
  const first = withGitOperation(
    "G:/Repo",
    "Staging…",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(withGitOperation("g:\\repo\\", "Reset…", async () => {})).rejects.toThrow(
    "Another Git operation",
  );
  await withGitOperation("G:/Other", "Stash…", async () => {});
  expect(gitPanelRuntime("G:/Repo").state.busy).toBe("Staging…");
  finish();
  await first;
  expect(gitPanelRuntime("G:/Repo").state.busy).toBeNull();
});
it("releases the checkout after failure", async () => {
  await expect(
    withGitOperation("/repo", "Reset…", async () => {
      throw new Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(gitPanelRuntime("/repo").state.busy).toBeNull();
  await withGitOperation("/repo", "Stage…", async () => {});
});

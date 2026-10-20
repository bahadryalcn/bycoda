import { beforeEach, expect, it, vi } from "vitest";
import {
  gitPanelRuntime,
  resetGitPanelState,
  withGitOperation,
  withGitBackgroundFetch,
} from "./gitPanelState";

it("shares background fetch without blocking or clearing an active local operation", async () => {
  resetGitPanelState();
  let releaseFetch!: () => void;
  let releaseLocal!: () => void;
  const fetchWork = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseFetch = resolve;
      }),
  );
  const first = withGitBackgroundFetch("/repo", fetchWork);
  const second = withGitBackgroundFetch("/repo", fetchWork);
  expect(gitPanelRuntime("/repo").state.busy).toBeNull();
  const local = withGitOperation(
    "/repo",
    "Staging…",
    () =>
      new Promise<void>((resolve) => {
        releaseLocal = resolve;
      }),
  );
  await Promise.resolve();
  expect(fetchWork).toHaveBeenCalledTimes(1);
  releaseFetch();
  await Promise.all([first, second]);
  expect(gitPanelRuntime("/repo").state.busy).toBe("Staging…");
  releaseLocal();
  await local;
});

it("allows background fetch to retry after failure", async () => {
  await expect(
    withGitBackgroundFetch("/repo", async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  await expect(withGitBackgroundFetch("/repo", async () => "recovered")).resolves.toBe("recovered");
  expect(gitPanelRuntime("/repo").state.busy).toBeNull();
});
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

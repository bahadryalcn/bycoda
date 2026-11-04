import { beforeEach, expect, it, vi } from "vitest";
import {
  gitPanelRuntime,
  resetGitPanelState,
  withGitOperation,
  withGitBackgroundFetch,
  withGitPanelRuntime,
} from "./gitPanelState";
import { CHECKOUT_CACHE_ENTRIES } from "./checkoutCache";

it("retains clean original runtime while an actual confirmation/preflight is pending", async () => {
  resetGitPanelState();
  const original = gitPanelRuntime("/confirmation");
  let release!: () => void;
  const work = withGitPanelRuntime("/confirmation", () => new Promise<void>((resolve) => { release = resolve; }));
  for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/other-${i}`);
  expect(gitPanelRuntime("/confirmation")).toBe(original);
  release();
  await work;
  for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/after-${i}`);
  expect(gitPanelRuntime("/confirmation")).not.toBe(original);
});

it("evicts clean idle runtimes while retaining drafts, selection and original operations", async () => {
  resetGitPanelState();
  const idle = gitPanelRuntime("/idle");
  const draft = gitPanelRuntime("/draft");
  draft.state.message = "Owner draft";
  draft.state.amendTarget = { branch: "main", head: "original" };
  let release!: () => void;
  const original = gitPanelRuntime("/busy");
  const work = withGitOperation("/busy", "Staging", () => new Promise<void>((resolve) => { release = resolve; }));
  for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/other-${i}`);
  expect(gitPanelRuntime("/idle")).not.toBe(idle);
  expect(gitPanelRuntime("/draft")).toBe(draft);
  expect(draft.state.message).toBe("Owner draft");
  expect(draft.state.amendTarget?.head).toBe("original");
  expect(gitPanelRuntime("/busy")).toBe(original);
  await expect(withGitOperation("/busy", "Reset", async () => {})).rejects.toThrow("Another Git operation");
  release();
  await work;
  expect(original.state.busy).toBeNull();
});

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

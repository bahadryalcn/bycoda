import { afterEach, expect, it } from "vitest";
import { toast } from "../../../shared/ui/ToastRegion";
import {
  backgroundRemovals,
  isBackgroundRemoval,
  runBackgroundRemoval,
  subscribeBackgroundRemovals,
} from "./backgroundRemoval";

afterEach(() => toast.dismissAll());

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it("tracks a running removal, refuses a duplicate and releases the folder when it finishes", async () => {
  const work = deferred();
  let changes = 0;
  const stop = subscribeBackgroundRemovals(() => changes++);
  const first = runBackgroundRemoval("/repo-worktrees/a", "a", () => work.promise);
  expect(isBackgroundRemoval(backgroundRemovals(), "/repo-worktrees/a")).toBe(true);
  await expect(runBackgroundRemoval("/repo-worktrees/a", "a", async () => {})).resolves.toBe(false);
  work.resolve();
  await expect(first).resolves.toBe(true);
  expect(isBackgroundRemoval(backgroundRemovals(), "/repo-worktrees/a")).toBe(false);
  expect(changes).toBe(2);
  stop();
});

it("reports a failed removal and releases the folder for a retry", async () => {
  const work = deferred();
  const running = runBackgroundRemoval("/repo-worktrees/b", "b", () => work.promise);
  work.reject(new Error("Disk unavailable"));
  await expect(running).resolves.toBe(false);
  expect(isBackgroundRemoval(backgroundRemovals(), "/repo-worktrees/b")).toBe(false);
});

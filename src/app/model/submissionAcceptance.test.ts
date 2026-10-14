import { expect, it, vi } from "vitest";
import { submitAfterProjectSync } from "./submissionAcceptance";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("recovers rejected asynchronous submissions exactly once", async () => {
  const onRejected = vi.fn();
  const accepted = submitAfterProjectSync({
    cwd: "/repo",
    sync: Promise.resolve({ path: "/repo", identity: "repo", moved: false }),
    applyLocationChange: vi.fn(),
    submit: async () => false,
    onError: vi.fn(),
    onRejected,
  });
  expect(await accepted).toBe(false);
  expect(onRejected).toHaveBeenCalledOnce();
});

it("recovers preparation failure exactly once", async () => {
  const onRejected = vi.fn();
  const submit = vi.fn(() => true);
  const onError = vi.fn();
  expect(
    await submitAfterProjectSync({
      cwd: "/repo",
      sync: Promise.reject(new Error("offline")),
      applyLocationChange: vi.fn(),
      submit,
      onError,
      onRejected,
    }),
  ).toBe(false);
  expect(onError).toHaveBeenCalledOnce();
  expect(onRejected).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it("Stop during project synchronization prevents both rebase and dispatch", async () => {
  const sync = deferred<{ path: string; identity: string; moved: boolean }>();
  let current = true;
  const submit = vi.fn(() => true);
  const applyLocationChange = vi.fn();
  const onRejected = vi.fn();
  const accepted = submitAfterProjectSync({
    cwd: "/old",
    sync: sync.promise,
    applyLocationChange,
    submit,
    onError: vi.fn(),
    isCurrent: () => current,
    onRejected,
  });
  current = false;
  sync.resolve({ path: "/new", identity: "repo", moved: true });
  expect(await accepted).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect(applyLocationChange).not.toHaveBeenCalled();
  expect(onRejected).toHaveBeenCalledOnce();
});

it("Stop during a project rebase prevents dispatch", async () => {
  const rebase = deferred<void>();
  let current = true;
  const submit = vi.fn(() => true);
  const accepted = submitAfterProjectSync({
    cwd: "/old",
    sync: Promise.resolve({ path: "/new", identity: "repo", moved: true }),
    applyLocationChange: () => rebase.promise,
    submit,
    onError: vi.fn(),
    isCurrent: () => current,
  });
  await Promise.resolve();
  current = false;
  rebase.resolve();
  expect(await accepted).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("waits for a moved project's state to be rebased before submitting", async () => {
  let resolveMove!: () => void;
  const applyLocationChange = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveMove = resolve;
      }),
  );
  const submit = vi.fn(() => true);
  const accepted = submitAfterProjectSync({
    cwd: "/old-path",
    sync: Promise.resolve({ path: "/new-path", identity: "repo", moved: true }),
    applyLocationChange,
    submit,
    onError: vi.fn(),
  });
  await Promise.resolve();
  expect(applyLocationChange).toHaveBeenCalledWith("/old-path", "/new-path");
  expect(submit).not.toHaveBeenCalled();
  resolveMove();
  await expect(accepted).resolves.toBe(true);
  expect(submit).toHaveBeenCalledOnce();
});

it("propagates an asynchronous deferred rejection instead of treating its promise as acceptance", async () => {
  const accepted = submitAfterProjectSync({
    cwd: "/repo",
    sync: Promise.resolve({ path: "/repo", identity: "repo", moved: false }),
    applyLocationChange: vi.fn(),
    submit: async () => false,
    onError: vi.fn(),
  });
  await expect(accepted).resolves.toBe(false);
});

it("rejects acceptance if applying a moved project fails", async () => {
  const error = new Error("failed to rebase project state");
  const submit = vi.fn(() => true);
  const onError = vi.fn();
  const accepted = submitAfterProjectSync({
    cwd: "/old-path",
    sync: Promise.resolve({ path: "/new-path", identity: "repo", moved: true }),
    applyLocationChange: vi.fn().mockRejectedValue(error),
    submit,
    onError,
  });
  await expect(accepted).resolves.toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(error);
});

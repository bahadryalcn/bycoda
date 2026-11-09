import { expect, it, vi } from "vitest";
import { continueAfterFailure, settledTail } from "./promiseQueue";
it("the next task does not start before the previous finishes, and an error does not poison the queue", async () => {
  let release!: () => void;
  const previous = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = vi.fn(async () => "next");
  const next = continueAfterFailure(previous, operation);
  await Promise.resolve();
  expect(operation).not.toHaveBeenCalled();
  release();
  expect(await next).toBe("next");
  expect(
    await continueAfterFailure(Promise.reject(new Error("previous")), async () => "recovered"),
  ).toBe("recovered");
});
it("preserves the caller's rejection, and the queue tail stays open to the next task", async () => {
  const next = continueAfterFailure(Promise.resolve(), async () => {
    throw new Error("current");
  });
  const tail = settledTail(next);
  await expect(next).rejects.toThrow("current");
  await expect(tail).resolves.toBeUndefined();
});

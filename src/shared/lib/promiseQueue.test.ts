import { expect, it, vi } from "vitest";
import { continueAfterFailure, settledTail } from "./promiseQueue";
it("önceki işlem bitmeden sıradaki başlamaz, hata sırayı zehirlemez", async () => {
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
it("çağıranın rejection'ını korur, sıranın tail'i sonraki işleme açık kalır", async () => {
  const next = continueAfterFailure(Promise.resolve(), async () => {
    throw new Error("current");
  });
  const tail = settledTail(next);
  await expect(next).rejects.toThrow("current");
  await expect(tail).resolves.toBeUndefined();
});

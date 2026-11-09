import { afterEach, expect, it, vi } from "vitest";
import {
  confirmInApp,
  platformConfirm,
  registerAppConfirmHost,
  markAppConfirmShown,
  CONFIRM_SHOW_TIMEOUT_MS,
} from "./appConfirm";
const request = {
  title: "Delete branch?",
  message: "Delete feature/x",
  confirmLabel: "Delete branch",
  tone: "danger" as const,
};
afterEach(() => vi.useRealTimers());
it("denies missing application UI without any native or browser fallback", async () => {
  expect(await confirmInApp(request)).toBe(false);
  expect(await platformConfirm(request)).toBe(false);
});
it("uses the registered owner surface and unregisters only that surface", async () => {
  const first = registerAppConfirmHost(async () => false);
  const second = registerAppConfirmHost(async () => true);
  first();
  expect(await confirmInApp(request)).toBe(true);
  second();
  expect(await confirmInApp(request)).toBe(false);
});
it("denies a surface that never appears, ignoring its late answer", async () => {
  vi.useFakeTimers();
  let resolve!: (answer: boolean) => void;
  const release = registerAppConfirmHost(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const answer = confirmInApp(request);
  await vi.advanceTimersByTimeAsync(CONFIRM_SHOW_TIMEOUT_MS);
  expect(await answer).toBe(false);
  resolve(true);
  expect(await answer).toBe(false);
  release();
});
it("keeps a visible application confirmation until its owner answers", async () => {
  vi.useFakeTimers();
  let resolve!: (answer: boolean) => void;
  const release = registerAppConfirmHost((value) => {
    markAppConfirmShown(value);
    return new Promise<boolean>((done) => {
      resolve = done;
    });
  });
  const answer = confirmInApp(request);
  await vi.advanceTimersByTimeAsync(CONFIRM_SHOW_TIMEOUT_MS * 4);
  resolve(false);
  expect(await answer).toBe(false);
  release();
});

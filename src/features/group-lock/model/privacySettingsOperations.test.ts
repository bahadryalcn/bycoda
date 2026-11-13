import { expect, it, vi } from "vitest";
const recover = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./roomPrivacyProjection", () => ({ recoverRoomPrivacyProjection: recover }));
import {
  getPrivacySettingsOperations,
  runPrivacySettingsOperation,
} from "./privacySettingsOperations";
it("retains ownership through recovery, guards duplicates, and keeps rejected recovery retryable", async () => {
  let reject!: (error: Error) => void;
  recover.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const write = vi.fn(() => true);
  const first = runPrivacySettingsOperation("test-recovery", write, true);
  await runPrivacySettingsOperation("test-recovery", write, true);
  expect(getPrivacySettingsOperations().pending["test-recovery"]).toBe(true);
  expect(recover).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  reject(new Error("unavailable"));
  await first;
  expect(getPrivacySettingsOperations().failed["test-recovery"]).toBe(true);
  expect(getPrivacySettingsOperations().pending["test-recovery"]).toBe(false);
  await runPrivacySettingsOperation("test-recovery", write, true);
  expect(write).toHaveBeenCalledOnce();
  expect(getPrivacySettingsOperations().failed["test-recovery"]).toBe(false);
});

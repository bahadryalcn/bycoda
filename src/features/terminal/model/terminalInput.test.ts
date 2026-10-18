import { expect, it, vi } from "vitest";
import { terminalInput } from "./terminalInput";

it.each(["terminal input is backed up", "disconnected", "response lost"])(
  "pauses on %s without replaying or executing queued Enter",
  async (message) => {
    let reject!: (error: Error) => void;
    const write = vi.fn(
      (_data: string) =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const failure = vi.fn();
    const input = terminalInput(write, failure);
    const first = input.enqueue("npm test");
    const enter = input.enqueue("\r");
    await Promise.resolve();
    expect(write).toHaveBeenCalledExactlyOnceWith("npm test");
    reject(new Error(message));
    await expect(first).resolves.toBe(false);
    await expect(enter).resolves.toBe(false);
    expect(failure).toHaveBeenCalledOnce();
    await expect(input.enqueue("must not execute\r")).resolves.toBe(false);
    input.resume();
    write.mockImplementation(async () => {});
    await expect(input.enqueue("fresh edit")).resolves.toBe(true);
    expect(write.mock.calls.map(([data]) => data)).toEqual(["npm test", "fresh edit"]);
  },
);

it("bounds pending input, cancels queued chunks and preserves accepted write ordering", async () => {
  let finish!: () => void;
  const write = vi.fn(
    (_data: string) =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const failure = vi.fn();
  const input = terminalInput(write, failure, 8);
  const first = input.enqueue("ab");
  const second = input.enqueue("cd");
  await Promise.resolve();
  await expect(input.enqueue("e")).resolves.toBe(false);
  expect(failure).toHaveBeenCalledOnce();
  input.resume();
  finish();
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
  write.mockImplementation(async () => {});
  await input.enqueue("new");
  input.dispose();
  await expect(input.enqueue("late")).resolves.toBe(false);
  expect(write.mock.calls.map(([data]) => data)).toEqual(["ab", "new"]);
});

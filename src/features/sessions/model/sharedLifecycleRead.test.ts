// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeSharedRead } from "./sharedLifecycleRead";

const policy = { intervalMs: 60_000, refreshOnFocus: true };
const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

let releases: (() => void)[] = [];
const subscribe = (key: string, read: (isCurrent: () => boolean) => Promise<void>) => {
  releases.push(subscribeSharedRead(key, read, policy));
};

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});
afterEach(() => {
  releases.forEach((release) => release());
  releases = [];
  vi.useRealTimers();
});

it("shares one read between every subscriber of a key", async () => {
  const read = vi.fn(async () => {});
  subscribe("list:a", read);
  subscribe("list:a", read);
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
});

it("reads immediately for a late subscriber even while the document is hidden", async () => {
  const read = vi.fn(async () => {});
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  setHidden(true);
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
});

it("polls once per interval and skips ticks while hidden", async () => {
  const read = vi.fn(async () => {});
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
  setHidden(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("refreshes on focus while visible and skips focus while hidden", async () => {
  const read = vi.fn(async () => {});
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event("focus"));
  expect(read).toHaveBeenCalledTimes(2);
  setHidden(true);
  window.dispatchEvent(new Event("focus"));
  expect(read).toHaveBeenCalledTimes(2);
});

it("stops the timer and focus listener when the last subscriber releases", async () => {
  const read = vi.fn(async () => {});
  const first = subscribeSharedRead("list:a", read, policy);
  const second = subscribeSharedRead("list:a", read, policy);
  await vi.advanceTimersByTimeAsync(0);
  first();
  first();
  second();
  read.mockClear();
  await vi.advanceTimersByTimeAsync(180_000);
  window.dispatchEvent(new Event("focus"));
  expect(read).not.toHaveBeenCalled();
});

it("keeps keys independent so another machine's read never shares a request", async () => {
  const readA = vi.fn(async () => {});
  const readB = vi.fn(async () => {});
  subscribe("list:a", readA);
  subscribe("list:b", readB);
  await vi.advanceTimersByTimeAsync(0);
  expect(readA).toHaveBeenCalledTimes(1);
  expect(readB).toHaveBeenCalledTimes(1);
});

it("tells a read finishing after release that it is no longer current", async () => {
  let finish!: () => void;
  let current: (() => boolean) | undefined;
  const release = subscribeSharedRead(
    "list:a",
    (isCurrent) => {
      current = isCurrent;
      return new Promise<void>((resolve) => (finish = resolve));
    },
    policy,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(current?.()).toBe(true);
  release();
  expect(current?.()).toBe(false);
  finish();
});

it("keeps a rejected read from escaping and still allows the next read", async () => {
  const read = vi
    .fn<(isCurrent: () => boolean) => Promise<void>>()
    .mockRejectedValueOnce(new Error("older Host"))
    .mockResolvedValue(undefined);
  subscribe("list:a", read);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

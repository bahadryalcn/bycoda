// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { openMicrophone, stopMicrophone } from "./microphoneAccess";
import { MicrophoneBusyError, onForegroundMicrophone } from "./microphoneOwnership";

afterEach(() => vi.unstubAllGlobals());

it("shares the capture slot with other windows and releases it on stop", async () => {
  let held = false;
  const request = vi.fn(
    async (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      if (held && options.ifAvailable) return callback(null);
      expect(held).toBe(false);
      held = true;
      try {
        await callback({ name, mode: "exclusive" });
      } finally {
        held = false;
      }
    },
  );
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal("navigator", { locks: { request }, mediaDevices: { getUserMedia } });
  const wake = { signal: new AbortController().signal, wake: true };
  const first = await openMicrophone({ audio: true }, wake);
  await expect(openMicrophone({ audio: true }, wake)).rejects.toBeInstanceOf(MicrophoneBusyError);
  expect(getUserMedia).toHaveBeenCalledOnce();
  stopMicrophone(first);
  await Promise.resolve();
  const next = await openMicrophone({ audio: true }, wake);
  stopMicrophone(next);
  expect(track.stop).toHaveBeenCalledTimes(2);
});

it("lets foreground capture release a background wake holder before opening", async () => {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const wake = await openMicrophone(
    { audio: true },
    { signal: new AbortController().signal, wake: true },
  );
  const unsubscribe = onForegroundMicrophone(() => stopMicrophone(wake));
  try {
    const foreground = await openMicrophone({ audio: true });
    expect(track.stop).toHaveBeenCalledOnce();
    stopMicrophone(foreground);
  } finally {
    unsubscribe();
    stopMicrophone(wake);
  }
});

it("releases a cancelled permission prompt and stops its late grant", async () => {
  const late = Promise.withResolvers<{ getTracks: () => { stop: () => void }[] }>();
  const oldTrack = { stop: vi.fn() };
  const newTrack = { stop: vi.fn() };
  const getUserMedia = vi
    .fn()
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce({ getTracks: () => [newTrack] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const owner = new AbortController();
  const opening = openMicrophone({ audio: true }, { signal: owner.signal });
  owner.abort();
  const next = await openMicrophone({ audio: true });
  try {
    late.resolve({ getTracks: () => [oldTrack] });
    await opening;
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    await expect(openMicrophone({ audio: true }, { wake: true })).rejects.toBeInstanceOf(
      MicrophoneBusyError,
    );
  } finally {
    stopMicrophone(next);
  }
});

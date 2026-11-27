// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  open: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("./microphoneAccess", () => ({
  openMicrophone: access.open,
  stopMicrophone: access.stop,
}));

import { swapMicrophone } from "./microphoneSwap";

function stream(id: string) {
  const track = { enabled: true, onended: null as null | (() => void) };
  return { id, getAudioTracks: () => [track], track } as unknown as MediaStream & {
    track: typeof track;
  };
}

function setup() {
  const old = stream("old");
  const oldSource = { disconnect: vi.fn() };
  const created: { connect: ReturnType<typeof vi.fn>; stream: MediaStream }[] = [];
  const context = {
    createMediaStreamSource: (opened: MediaStream) => {
      const node = { connect: vi.fn(), stream: opened };
      created.push(node);
      return node;
    },
  };
  const capture = {};
  return {
    old,
    oldSource,
    created,
    options: {
      context: context as unknown as AudioContext,
      capture: capture as AudioNode,
      stream: old,
      source: oldSource as unknown as MediaStreamAudioSourceNode,
      previousDeviceId: "built-in",
      muted: () => true,
      signal: new AbortController().signal,
    },
    capture,
  };
}

const opened = (call: number) =>
  (access.open.mock.calls[call][0] as { audio: { deviceId?: { exact: string } } }).audio.deviceId
    ?.exact;

it("releases the old microphone, then feeds the new one into the same capture graph", async () => {
  access.open.mockReset().mockResolvedValueOnce(stream("usb"));
  const { old, oldSource, created, options, capture } = setup();
  const result = await swapMicrophone({ ...options, deviceId: "usb-mic" });
  expect(oldSource.disconnect).toHaveBeenCalled();
  expect(access.stop).toHaveBeenCalledWith(old);
  expect(access.stop.mock.invocationCallOrder[0]).toBeLessThan(
    access.open.mock.invocationCallOrder[0],
  );
  expect(opened(0)).toBe("usb-mic");
  expect(result.deviceId).toBe("usb-mic");
  expect(created[0].connect).toHaveBeenCalledWith(capture);
  // The mute state carries over to the new tracks.
  expect((result.stream as ReturnType<typeof stream>).track.enabled).toBe(false);
});

it("reopens the previous microphone when the new one cannot open", async () => {
  access.open
    .mockReset()
    .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
    .mockResolvedValueOnce(stream("built-in"));
  const { options } = setup();
  const result = await swapMicrophone({ ...options, deviceId: "unplugged" });
  expect([opened(0), opened(1)]).toEqual(["unplugged", "built-in"]);
  expect(result.deviceId).toBe("built-in");
});

it("rejects when neither microphone opens", async () => {
  access.open.mockReset().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  const { options } = setup();
  await expect(swapMicrophone({ ...options, deviceId: "usb-mic" })).rejects.toThrow("denied");
});

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeChild: vi.fn() }));

vi.mock("../../core/child", () => ({ writeChild: mocks.writeChild }));

import { PiRpc } from "./piClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  mocks.writeChild.mockReset();
  vi.useRealTimers();
});

describe("PiRpc.request", () => {
  it("rejects when the transport write fails", async () => {
    mocks.writeChild.mockRejectedValue(new Error("write failed"));
    const rpc = new PiRpc("probe", vi.fn());

    await expect(rpc.request({ type: "get_commands" })).rejects.toThrow("write failed");
    rpc.close();
  });

  it("times out even when the transport write stalls", async () => {
    vi.useFakeTimers();
    const write = deferred<void>();
    mocks.writeChild.mockReturnValue(write.promise);
    const rpc = new PiRpc("probe", vi.fn());
    const request = rpc.request({ type: "get_commands" }, 100);
    const rejected = expect(request).rejects.toThrow("Pi get_commands timed out");

    await vi.advanceTimersByTimeAsync(100);
    await rejected;

    write.resolve();
    rpc.close();
  });
});

it.each(["cancel", "timeout"])(
  "keeps a real %s late JSONL response unsupported without changing ordinary routing",
  async (retirement) => {
    const { nativeOutputFrame } = await import("../../core/nativeOutputDelivery.testSupport");
    mocks.writeChild.mockResolvedValue(undefined);
    const sessionId = `pi-late-response-${retirement}`;
    const onFrame = vi.fn(),
      consume = vi.fn((value) => value);
    const rpc = new PiRpc(sessionId, onFrame);
    if (retirement === "timeout") vi.useFakeTimers();
    const actual = rpc.request({ type: "get_state" }, 100, consume);
    const rejected = expect(actual).rejects.toThrow(
      retirement === "cancel" ? "request cancelled" : "timed out",
    );
    if (retirement === "cancel") rpc.cancelRequest("mc_1");
    else await vi.advanceTimersByTimeAsync(100);
    await rejected;
    const response = {
      type: "response",
      id: "mc_1",
      command: "get_state",
      success: true,
      data: { sessionId: "stale" },
    };
    const line = JSON.stringify(response);
    const inspect = nativeOutputFrame(sessionId, line, () => rpc.pushLine(line));
    expect(consume).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledExactlyOnceWith(response);
    expect(inspect()).toMatchObject({
      pendingCausalWork: 0,
      unavailableReason: "pi-response-unmatched",
      outcomes: [{ outcome: "unsupported" }],
    });
    rpc.close();
  },
);

it("preserves a bare ordinary request result while explicitly rejecting its untracked Native consumer", async () => {
  const { nativeOutputFrame } = await import("../../core/nativeOutputDelivery.testSupport");
  mocks.writeChild.mockResolvedValue(undefined);
  const rpc = new PiRpc("pi-bare-response", vi.fn());
  const actual = rpc.request({ type: "get_state" });
  const response = {
    type: "response",
    id: "mc_1",
    command: "get_state",
    success: true,
    data: { sessionId: "ordinary" },
  };
  const line = JSON.stringify(response);
  const inspect = nativeOutputFrame("pi-bare-response", line, () => rpc.pushLine(line));
  expect(await actual).toEqual(response);
  expect(inspect()).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "pi-response-consumer-untracked",
  });
  rpc.close();
});

it("retains the actual async Pi response consumer after a close signal", async () => {
  const api = await import("../../core/nativeOutputDelivery");
  const { nativeOutputFrame } = await import("../../core/nativeOutputDelivery.testSupport");
  mocks.writeChild.mockResolvedValue(undefined);
  const rpc = new PiRpc("pi-response-causal", vi.fn());
  const held = deferred<void>();
  const event = {};
  const actual = rpc.request({ type: "get_session_stats" }, 15000, async (value, work) => {
    await held.promise;
    api.nativeOutputSink(work, () => api.captureNativeOutputEvent("pi-response-causal", event))();
    return value;
  });
  const line = JSON.stringify({
    type: "response",
    id: "mc_1",
    command: "get_session_stats",
    success: true,
    data: {},
  });
  const inspect = nativeOutputFrame("pi-response-causal", line, () => rpc.pushLine(line));
  await Promise.resolve();
  rpc.close();
  expect(inspect().pendingCausalWork).toBe(1);
  held.resolve();
  await actual;
  expect(api.getNativeOutputEventOrigin(event)).not.toBeNull();
  expect(inspect()).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "pi-client-closed",
    applicationThrough: null,
  });
});

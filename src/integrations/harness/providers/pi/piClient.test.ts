import { processConstructions } from "../processConstruction.testSupport";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeChild: vi.fn() }));

beforeEach(() => processConstructions.reset());
vi.mock("../../core/child", () => processConstructions.mock({ writeChild: mocks.writeChild }));

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

it("keeps a deferred A write on A's handle after B uses the same logical locator", async () => {
  // Actual PiRpc, explicit protocol transport fake; no Native receipt/fence is emulated.
  const original = processConstructions.create("same-probe");
  const first = new PiRpc(original, vi.fn());
  const held = deferred<void>();
  mocks.writeChild.mockResolvedValue(undefined);
  mocks.writeChild.mockImplementationOnce(() => held.promise);
  const a = first.request({ type: "get_state" });
  void a.catch(() => undefined);
  const replacement = processConstructions.create("same-probe");
  const second = new PiRpc(replacement, vi.fn());
  const b = second.request({ type: "get_state" });
  void b.catch(() => undefined);
  const response = (sessionId: string) => ({
    type: "response",
    id: "mc_1",
    command: "get_state",
    success: true,
    data: { sessionId },
  });
  try {
    second.pushLine(JSON.stringify(response("B")));
    await expect(b).resolves.toEqual(response("B"));
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "write")
        .map((operation) => operation.handle),
    ).toEqual([original, replacement]);
    held.resolve();
    first.pushLine(JSON.stringify(response("A")));
    await expect(a).resolves.toEqual(response("A"));
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "write")
        .map((operation) => operation.handle),
    ).toEqual([original, replacement]);
  } finally {
    held.resolve();
    first.close();
    second.close();
  }
});

describe("PiRpc.request", () => {
  it("rejects when the transport write fails", async () => {
    mocks.writeChild.mockRejectedValue(new Error("write failed"));
    const rpc = new PiRpc(processConstructions.create("probe"), vi.fn());

    await expect(rpc.request({ type: "get_commands" })).rejects.toThrow("write failed");
    rpc.close();
  });

  it("times out even when the transport write stalls", async () => {
    vi.useFakeTimers();
    const write = deferred<void>();
    mocks.writeChild.mockReturnValue(write.promise);
    const rpc = new PiRpc(processConstructions.create("probe"), vi.fn());
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
    const rpc = new PiRpc(processConstructions.create(sessionId), onFrame);
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
  const rpc = new PiRpc(processConstructions.create("pi-bare-response"), vi.fn());
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
  const process = processConstructions.create("pi-response-causal");
  const rpc = new PiRpc(process, vi.fn());
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
    applicationThrough: null,
  });
  // This suite mocks the child boundary. Actual stream invalidation is exercised
  // with the real child handle and PiRpc in child-process-handoff.test.ts.
  expect(processConstructions.operations).toContainEqual({
    kind: "invalidate",
    handle: process,
    args: ["pi-client-closed"],
  });
});

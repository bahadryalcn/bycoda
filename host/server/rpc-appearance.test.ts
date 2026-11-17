import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const design = vi.hoisted(() => ({
  create: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../appearance/create-design", () => ({
  createAppearanceDesign: design.create,
  cancelAppearanceDesign: design.cancel,
}));
import { handleAppearanceRpc } from "./rpc-appearance";

type Request = Parameters<typeof handleAppearanceRpc>[1];
const request = (method: string, params: Record<string, unknown>, extra: Partial<Request> = {}) =>
  ({
    input: { method },
    params,
    result: undefined,
    tokenHash: "owner-hash",
    pollState: { revoked: false },
    response: new EventEmitter(),
    closing: false,
    ...extra,
  }) as unknown as Request;
const createParams = () => ({
  requestId: randomUUID(),
  kind: "scene",
  prompt: "A forest lake",
  harness: "claude",
  model: "sonnet",
});

beforeEach(() => {
  design.create.mockReset();
  design.cancel.mockReset();
});

it("dispatches createDesign with the validated params, owner and an abort signal", async () => {
  const params = createParams();
  design.create.mockResolvedValue({ kind: "scene", name: "Lake" });
  const rpc = request("appearance.createDesign", params);
  await handleAppearanceRpc({}, rpc);
  expect(rpc.result).toEqual({ kind: "scene", name: "Lake" });
  expect(design.create).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: params.requestId }),
    "owner-hash",
    undefined,
    expect.any(AbortSignal),
  );
  expect(rpc.response.listenerCount("close")).toBe(0);
});

it("rejects invalid createDesign params before any provider work", async () => {
  await expect(
    handleAppearanceRpc({}, request("appearance.createDesign", { requestId: "nope" })),
  ).rejects.toThrow();
  expect(design.create).not.toHaveBeenCalled();
});

it("aborts the creation when the response closes or authority is revoked", async () => {
  const signals: AbortSignal[] = [];
  design.create.mockImplementation(
    (_params: unknown, _owner: string, _run: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  );
  const closed = request("appearance.createDesign", createParams());
  const pendingClose = expect(handleAppearanceRpc({}, closed)).rejects.toThrow("disconnected");
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  closed.response.emit("close");
  await pendingClose;
  expect(signals[0].aborted).toBe(true);

  vi.useFakeTimers();
  try {
    const revoked = request("appearance.createDesign", createParams());
    const pendingRevoke = expect(handleAppearanceRpc({}, revoked)).rejects.toThrow("disconnected");
    revoked.pollState.revoked = true;
    await vi.advanceTimersByTimeAsync(600);
    await pendingRevoke;
    expect(signals[1].aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("dispatches cancelDesign with the request id and owner", async () => {
  const requestId = randomUUID();
  design.cancel.mockReturnValue({ cancelled: true });
  const rpc = request("appearance.cancelDesign", { requestId });
  await handleAppearanceRpc({}, rpc);
  expect(design.cancel).toHaveBeenCalledWith(requestId, "owner-hash");
  expect(rpc.result).toEqual({ cancelled: true });
});

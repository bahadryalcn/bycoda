import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { OwnerRpcRequest } from "./owner-rpc-context";

const design = vi.hoisted(() => ({
  create: vi.fn(),
  cancel: vi.fn(),
}));
const generate = vi.hoisted(() => vi.fn());
vi.mock("../appearance/create-design", () => ({
  createAppearanceDesign: design.create,
  cancelAppearanceDesign: design.cancel,
}));
vi.mock("../appearance/background-image", () => ({ generateAppearanceBackgroundImage: generate }));
vi.mock("../appearance/background-suggestions", () => ({ generateBackgroundSuggestion: vi.fn() }));
vi.mock("../appearance/theme-suggestions", () => ({ generateThemeSuggestions: generate }));

const { handleAppearanceRpc } = await import("./rpc-appearance");

const designRequest = (
  method: string,
  params: Record<string, unknown>,
  extra: Partial<OwnerRpcRequest> = {},
) =>
  ({
    input: { method },
    params,
    result: undefined,
    tokenHash: "owner-hash",
    pollState: { revoked: false },
    response: new EventEmitter(),
    closing: false,
    domainContext: {},
    ...extra,
  }) as unknown as OwnerRpcRequest;
const createParams = () => ({
  requestId: randomUUID(),
  kind: "scene",
  prompt: "A forest lake",
  harness: "claude",
  model: "sonnet",
});

function request(method: string, tokenHash: string, params: Record<string, unknown>) {
  return { input: { method }, tokenHash, params, domainContext: {} } as unknown as OwnerRpcRequest;
}

beforeEach(() => {
  design.create.mockReset();
  design.cancel.mockReset();
});

it("dispatches createDesign with the validated params, owner and an abort signal", async () => {
  const params = createParams();
  design.create.mockResolvedValue({ kind: "scene", name: "Lake" });
  const rpc = designRequest("appearance.createDesign", params);
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
    handleAppearanceRpc({}, designRequest("appearance.createDesign", { requestId: "nope" })),
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
  const closed = designRequest("appearance.createDesign", createParams());
  const pendingClose = expect(handleAppearanceRpc({}, closed)).rejects.toThrow("disconnected");
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  closed.response.emit("close");
  await pendingClose;
  expect(signals[0].aborted).toBe(true);

  vi.useFakeTimers();
  try {
    const revoked = designRequest("appearance.createDesign", createParams());
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
  const rpc = designRequest("appearance.cancelDesign", { requestId });
  await handleAppearanceRpc({}, rpc);
  expect(design.cancel).toHaveBeenCalledWith(requestId, "owner-hash");
  expect(rpc.result).toEqual({ cancelled: true });
});

it("scopes cancellation to one active generation and its initiating credential", async () => {
  generate.mockImplementation(
    (_params: unknown, _adapter: unknown, signal: AbortSignal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  const first = randomUUID();
  const second = randomUUID();
  const firstImage = handleAppearanceRpc(
    null,
    request("appearance.backgroundImage", "owner", {
      generationId: first,
      prompt: "Forest",
      provider: "codex",
    }),
  );
  const secondImage = handleAppearanceRpc(
    null,
    request("appearance.themeSuggestions", "owner", {
      generationId: second,
      prompt: "Ocean",
      harness: "codex",
      model: "auto",
    }),
  );
  const firstStopped = expect(firstImage).rejects.toMatchObject({ name: "AbortError" });
  const secondStopped = expect(secondImage).rejects.toMatchObject({ name: "AbortError" });
  const cancel = async (generationId: string, tokenHash = "owner") => {
    const rpc = request("appearance.cancelGeneration", tokenHash, { generationId });
    await handleAppearanceRpc(null, rpc);
    return rpc.result;
  };
  await expect(cancel(first, "other")).resolves.toEqual({ cancelled: false });
  expect(generate.mock.calls[0][2].aborted).toBe(false);
  await expect(cancel(first)).resolves.toEqual({ cancelled: true });
  await firstStopped;
  expect(generate.mock.calls[1][2].aborted).toBe(false);
  await expect(cancel(first)).resolves.toEqual({ cancelled: false });
  await expect(cancel(second)).resolves.toEqual({ cancelled: true });
  await secondStopped;
});

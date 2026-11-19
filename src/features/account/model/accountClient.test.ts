import { AccountRequestTimeoutError, DEFAULT_ACCOUNT_TIMEOUT_MS } from "@bycoda/account-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountApi, DEVICE_HEADER } from "./accountClient";

const neverAnswers = (() => new Promise<Response>(() => undefined)) as typeof fetch;

describe("account API deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const api = (fetchImpl: typeof fetch, timeoutMs?: number) =>
    createAccountApi({
      baseUrl: "https://api.example.test",
      getAccessToken: async () => "access-token",
      getDeviceId: () => "dev_1",
      fetchImpl,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  it("rejects a request that never answers after the default deadline", async () => {
    const outcome = api(neverAnswers).listDevices().then(
      () => "answered",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_ACCOUNT_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(AccountRequestTimeoutError);
    // A network-class error: the offline path of the controller and the callers treats it so.
    expect(error).toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives the base fetch an abort signal and keeps the device header", async () => {
    const seen: { signal?: AbortSignal | null; headers?: unknown } = {};
    const fetchImpl = (async (_input, init) => {
      seen.signal = init?.signal;
      seen.headers = init?.headers;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const outcome = api(fetchImpl, 500).listDevices().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toBeInstanceOf(AccountRequestTimeoutError);
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.headers).toMatchObject({ [DEVICE_HEADER]: "dev_1" });
  });

  it("still honors a caller abort before the deadline", async () => {
    const controller = new AbortController();
    const outcome = api(neverAnswers)
      .listDevices({ signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(new Error("cancelled"));
    expect(await outcome).toMatchObject({ message: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

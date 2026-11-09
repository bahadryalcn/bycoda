import { AccountApiError, type PendingPairRequest } from "@bycoda/account-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePairKeypair, openPairTicket } from "../../../integrations/account-pair-crypto";
import {
  approvePairRequest,
  createPairRequestHandler,
  PAIR_SEEN_LIMIT,
  pairAad,
  pairRequestCode,
  startPhoneConnectInbox,
} from "./phoneConnectInbox";
import {
  buildConnectInfo,
  startPhoneConnectPublisher,
  type PhoneConnectHost,
} from "./phoneConnectPublisher";

const ENV = "env-1234";
const KEY = "A".repeat(43);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const host = (routes: PhoneConnectHost["mobileRoutes"] = []): PhoneConnectHost => ({
  environmentId: ENV,
  name: "Desk",
  mobileRoutes: routes,
});

function request(over: Partial<PendingPairRequest> = {}): PendingPairRequest {
  return {
    id: "req-1",
    phoneDeviceId: "phone-1",
    phoneName: "Pixel 8",
    phonePlatform: "android",
    phonePublicKey: KEY,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...over,
  };
}

describe("buildConnectInfo", () => {
  it("keeps valid routes and drops private http routes without a pin", () => {
    const info = buildConnectInfo(
      host([{ endpoint: "https://pc.tail.ts.net" }, { endpoint: "http://192.168.1.5:1234" }]),
    );
    expect(info?.routes).toEqual([{ endpoint: "https://pc.tail.ts.net" }]);
    expect(info?.hostName).toBe("Desk");
  });
});

describe("phone connect publisher", () => {
  const setup = (describeHost: () => Promise<PhoneConnectHost | null>) => {
    const api = {
      putConnectInfo: vi.fn().mockResolvedValue(null),
      deleteConnectInfo: vi.fn().mockResolvedValue(null),
    };
    const stop = startPhoneConnectPublisher({
      deviceId: "dev-1",
      api,
      describeHost,
    });
    return { api, stop };
  };

  it("publishes once, republishes on change and as a heartbeat, deletes on stop", async () => {
    let current = host([{ endpoint: "https://a.ts.net" }]);
    const { api, stop } = setup(async () => current);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.putConnectInfo).toHaveBeenCalledTimes(1);
    expect(api.putConnectInfo.mock.calls[0]![0].params).toEqual({
      id: "dev-1",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.putConnectInfo).toHaveBeenCalledTimes(1);

    current = host([{ endpoint: "https://b.ts.net" }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.putConnectInfo).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.putConnectInfo.mock.calls.length).toBeGreaterThanOrEqual(3);

    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.deleteConnectInfo).toHaveBeenCalledWith({
      params: { id: "dev-1" },
    });
  });

  it("deletes only after an in-flight PUT settles and never PUTs after stop", async () => {
    const order: string[] = [];
    let release!: () => void;
    const api = {
      putConnectInfo: vi.fn(async () => {
        order.push("put-start");
        await new Promise<void>((resolve) => (release = resolve));
        order.push("put-end");
        return null;
      }),
      deleteConnectInfo: vi.fn(async () => {
        order.push("delete");
        return null;
      }),
    };
    const stop = startPhoneConnectPublisher({
      deviceId: "dev-1",
      api,
      describeHost: async () => host([{ endpoint: "https://a.ts.net" }]),
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.deleteConnectInfo).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["put-start", "put-end", "delete"]);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(api.putConnectInfo).toHaveBeenCalledTimes(1);
  });

  it("does not delete when nothing was published", async () => {
    const { api, stop } = setup(async () => null);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(api.putConnectInfo).not.toHaveBeenCalled();
    expect(api.deleteConnectInfo).not.toHaveBeenCalled();
  });

  it("stops quietly on an API without the route", async () => {
    const { api, stop } = setup(async () => host());
    api.putConnectInfo.mockRejectedValue(new AccountApiError(404, "not_found", "no"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(api.putConnectInfo).toHaveBeenCalledTimes(1);
    stop();
    expect(api.deleteConnectInfo).not.toHaveBeenCalled();
  });
});

describe("phone connect inbox", () => {
  it("polls fast while visible, slowly while hidden, and stops on 404", async () => {
    let visible = true;
    const listPairRequests = vi.fn().mockResolvedValue({ items: [] });
    const stop = startPhoneConnectInbox({
      api: { listPairRequests },
      onRequests: () => undefined,
      isVisible: () => visible,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(listPairRequests).toHaveBeenCalledTimes(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(3_000); // third call happens, then the slow interval starts
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listPairRequests).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listPairRequests).toHaveBeenCalledTimes(4);
    stop();

    const old = vi.fn().mockRejectedValue(new AccountApiError(404, "not_found", "no"));
    const onError = vi.fn();
    startPhoneConnectInbox({
      api: { listPairRequests: old },
      onRequests: () => undefined,
      onError,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(old).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("approvePairRequest", () => {
  it("seals the pairing code so only the phone can open it with the fixed AAD", async () => {
    vi.useRealTimers();
    const phone = await generatePairKeypair();
    const req = request({ phonePublicKey: phone.publicKey });
    const code = { kind: "bycoda.mobile-pairing", version: 1, ticket: "t" };
    const putPairTicket = vi.fn().mockResolvedValue(null);
    await approvePairRequest(req, {
      api: { putPairTicket },
      desktopDeviceId: "desk-1",
      environmentId: ENV,
      createPairingCode: async () => ({ code, cancel: async () => undefined }),
    });
    const call = putPairTicket.mock.calls[0]![0];
    expect(call.params).toEqual({ id: "req-1" });
    const aad = `bycoda-pair|req-1|phone-1|desk-1|${ENV}`;
    expect(pairAad(req, "desk-1", ENV)).toBe(aad);
    expect(JSON.parse(openPairTicket(call.body, phone.privateKey, aad))).toEqual(code);
    expect(() => openPairTicket(call.body, phone.privateKey, aad + "x")).toThrow();
    expect(pairRequestCode(req)).toMatch(/^\d{6}$/);
  });

  it("cancels the ticket when the handoff fails and refuses expired requests", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const phone = await generatePairKeypair();
    const deps = {
      api: { putPairTicket: vi.fn().mockRejectedValue(new Error("boom")) },
      desktopDeviceId: "desk-1",
      environmentId: ENV,
      createPairingCode: vi.fn(async () => ({ code: {}, cancel })),
    };
    await expect(
      approvePairRequest(request({ phonePublicKey: phone.publicKey }), deps),
    ).rejects.toThrow("boom");
    expect(cancel).toHaveBeenCalledTimes(1);

    deps.createPairingCode.mockClear();
    const expired = request({
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await expect(approvePairRequest(expired, deps)).rejects.toThrow("expired");
    expect(deps.createPairingCode).not.toHaveBeenCalled();
  });
});

describe("pair request handler", () => {
  it("asks once per request, one at a time, and denies on Deny", async () => {
    vi.useRealTimers();
    const denyPairRequest = vi.fn().mockResolvedValue(null);
    const order: string[] = [];
    const approve = vi.fn().mockResolvedValue(undefined);
    const handle = createPairRequestHandler({
      api: { denyPairRequest },
      approve,
      ask: async (req, run) => {
        order.push(`ask ${req.id}`);
        if (req.id === "a") {
          await run();
          return true;
        }
        return false;
      },
    });
    handle([request({ id: "a" }), request({ id: "b" })]);
    handle([request({ id: "a" }), request({ id: "b" })]);
    await vi.waitFor(() => expect(denyPairRequest).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["ask a", "ask b"]);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(denyPairRequest).toHaveBeenCalledWith({ params: { id: "b" } });
  });

  it("stops asking after dispose and remembers only the latest ids", async () => {
    vi.useRealTimers();
    const denyPairRequest = vi.fn().mockResolvedValue(null);
    const asked: string[] = [];
    const handle = createPairRequestHandler({
      api: { denyPairRequest },
      approve: vi.fn().mockResolvedValue(undefined),
      ask: async (req) => {
        asked.push(req.id);
        return true;
      },
    });
    const many = Array.from({ length: PAIR_SEEN_LIMIT + 5 }, (_, i) => request({ id: `r${i}` }));
    handle(many);
    await vi.waitFor(() => expect(asked).toHaveLength(many.length));
    handle([request({ id: "r0" })]); // forgotten: the oldest id fell out of the set
    await vi.waitFor(() => expect(asked).toHaveLength(many.length + 1));
    handle.dispose();
    handle([request({ id: "late" })]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked).not.toContain("late");
    expect(denyPairRequest).not.toHaveBeenCalled();
  });

  it("drops a denial that arrives after dispose", async () => {
    vi.useRealTimers();
    const denyPairRequest = vi.fn().mockResolvedValue(null);
    let answer!: (value: boolean) => void;
    const handle = createPairRequestHandler({
      api: { denyPairRequest },
      approve: vi.fn().mockResolvedValue(undefined),
      ask: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    handle([request({ id: "a" })]);
    await vi.waitFor(() => expect(answer).toBeDefined());
    handle.dispose();
    answer(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(denyPairRequest).not.toHaveBeenCalled();
  });
});

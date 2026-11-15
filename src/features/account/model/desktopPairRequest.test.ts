import { describe, expect, it, vi } from "vitest";
import {
  generatePairKeypair,
  pairSasCode,
  sealPairTicket,
} from "../../../integrations/account-pair-crypto";
import { requestDesktopPair } from "./desktopPairRequest";
import { pairAad } from "./phoneConnectInbox";

const TARGET = { deviceId: "target-1", environmentId: "env-1" };

type Status = { state: string; desktopPublicKey?: string; sealed?: string };

function fakeApi(statuses: Status[]) {
  const created: { body?: { phonePublicKey: string } } = {};
  return {
    created,
    api: {
      createPairRequest: vi.fn(async ({ body }: { body: { phonePublicKey: string } }) => {
        created.body = body;
        return { id: "req-1", expiresAt: new Date(Date.now() + 120_000).toISOString() };
      }),
      getPairRequest: vi.fn(async (): Promise<Status> => statuses.shift() ?? { state: "pending" }),
    },
  };
}

describe("requestDesktopPair", () => {
  it("cancellation wins over a failed pending status read", async () => {
    const { api } = fakeApi([]);
    let reject!: (error: Error) => void;
    api.getPairRequest.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const request = await requestDesktopPair(TARGET, { api: api as never, deviceId: "me-1" });
    request.cancel();
    reject(new Error("offline"));
    await expect(request.outcome).resolves.toEqual({ state: "cancelled" });
  });
  it("drops a sealed reply received after cancellation", async () => {
    const { api } = fakeApi([]);
    let reply!: (value: Status) => void;
    api.getPairRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const request = await requestDesktopPair(TARGET, { api: api as never, deviceId: "me-1" });
    request.cancel();
    reply({ state: "sealed", desktopPublicKey: "invalid", sealed: "invalid" });
    await expect(request.outcome).resolves.toEqual({ state: "cancelled" });
  });
  it("sends a fresh key, shows the code the target computes and opens the sealed ticket", async () => {
    const { api, created } = fakeApi([]);
    const request = await requestDesktopPair(TARGET, {
      api: api as never,
      deviceId: "me-1",
      pollMs: 1,
    });
    const publicKey = created.body!.phonePublicKey;
    expect(request.code).toBe(pairSasCode("req-1", publicKey));
    const sealed = await sealPairTicket(
      '{"ticket":"t"}',
      publicKey,
      pairAad({ id: "req-1", phoneDeviceId: "me-1" }, TARGET.deviceId, TARGET.environmentId),
    );
    api.getPairRequest.mockResolvedValue({ state: "sealed", ...sealed });
    await expect(request.outcome).resolves.toEqual({
      state: "sealed",
      ticketJson: '{"ticket":"t"}',
    });
  });

  it("rejects a ticket sealed for another environment or requester", async () => {
    const { api, created } = fakeApi([]);
    const request = await requestDesktopPair(TARGET, {
      api: api as never,
      deviceId: "me-1",
      pollMs: 1,
    });
    const sealed = await sealPairTicket(
      "{}",
      created.body!.phonePublicKey,
      pairAad({ id: "req-1", phoneDeviceId: "me-1" }, TARGET.deviceId, "other-env"),
    );
    api.getPairRequest.mockResolvedValue({ state: "sealed", ...sealed });
    await expect(request.outcome).rejects.toThrow();
  });

  it("reports a refusal, an expiry and a ticket that was already taken", async () => {
    for (const [status, state] of [
      ["denied", "denied"],
      ["expired", "expired"],
      ["delivered", "expired"],
    ] as const) {
      const { api } = fakeApi([{ state: status }]);
      const request = await requestDesktopPair(TARGET, { api: api as never, deviceId: "me-1" });
      await expect(request.outcome).resolves.toEqual({ state });
    }
  });

  it("cancel stops polling", async () => {
    const { api } = fakeApi([]);
    const request = await requestDesktopPair(TARGET, {
      api: api as never,
      deviceId: "me-1",
      pollMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    request.cancel();
    await expect(request.outcome).resolves.toEqual({ state: "cancelled" });
    const calls = api.getPairRequest.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(api.getPairRequest.mock.calls.length).toBe(calls);
  });

  it("does not poll when the service refuses the request", async () => {
    const api = {
      createPairRequest: vi.fn(async () => {
        throw new Error("403");
      }),
      getPairRequest: vi.fn(),
    };
    await expect(
      requestDesktopPair(TARGET, { api: api as never, deviceId: "me-1" }),
    ).rejects.toThrow("403");
    expect(api.getPairRequest).not.toHaveBeenCalled();
    expect((await generatePairKeypair()).publicKey).toHaveLength(43);
  });
});

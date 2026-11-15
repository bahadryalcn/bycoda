import { describe, expect, it, vi } from "vitest";
import type { DesktopPairOutcome } from "../../account";
import { startAccountDesktopPair, type AccountPairPlan } from "./accountDesktopPairing";
import type { RemoteMachine } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PLAN: AccountPairPlan = {
  deviceId: "target-1",
  environmentId: "env-1",
  name: "Studio PC",
  routes: ["https://studio.tailnet.ts.net"],
};
const MACHINE = { id: "m1", name: "Studio PC", environmentId: "env-1" } as RemoteMachine;

const ticketJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: "bycoda.mobile-pairing",
    version: 1,
    endpoint: "https://studio.tailnet.ts.net",
    environmentId: "env-1",
    name: "Studio PC",
    ticket: "T".repeat(43),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  });

function flow(outcome: DesktopPairOutcome, redeem = vi.fn(async (_input: unknown) => MACHINE)) {
  const cancel = vi.fn();
  return {
    redeem,
    cancel,
    start: () =>
      startAccountDesktopPair(PLAN, {
        request: async () => ({
          code: "123456",
          expiresAt: "",
          outcome: Promise.resolve(outcome),
          cancel,
        }),
        redeem,
        deviceName: "Laptop",
      }),
  };
}

describe("startAccountDesktopPair", () => {
  it("never redeems after cancellation during claim generation", async () => {
    let release!: (bytes: Uint8Array) => void;
    const redeem = vi.fn(async () => MACHINE);
    const started = await startAccountDesktopPair(PLAN, {
      request: async () => ({
        code: "123456",
        expiresAt: "",
        cancel: vi.fn(),
        outcome: Promise.resolve({ state: "sealed", ticketJson: ticketJson() }),
      }),
      randomBytes: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      redeem,
      deviceName: "Laptop",
    });
    started.cancel();
    release(new Uint8Array(32));
    await expect(started.result).resolves.toEqual({ state: "cancelled" });
    expect(redeem).not.toHaveBeenCalled();
  });
  it("redeems the opened ticket over the published routes and returns the saved machine", async () => {
    const f = flow({ state: "sealed", ticketJson: ticketJson() });
    const started = await f.start();
    expect(started.code).toBe("123456");
    await expect(started.result).resolves.toEqual({ state: "connected", machine: MACHINE });
    expect(f.redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Studio PC",
        environmentId: "env-1",
        routes: PLAN.routes,
        ticket: "T".repeat(43),
        deviceName: "Laptop",
        claimId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
  });

  it("passes a refusal through without redeeming", async () => {
    for (const state of ["denied", "expired", "cancelled"] as const) {
      const f = flow({ state });
      await expect((await f.start()).result).resolves.toEqual({ state });
      expect(f.redeem).not.toHaveBeenCalled();
    }
  });

  it("drops a ticket for another Host or an unreadable ticket before any credential is asked for", async () => {
    for (const json of [
      ticketJson({ environmentId: "env-2" }),
      "not json",
      ticketJson({ endpoint: "http://evil.example" }),
    ]) {
      const f = flow({ state: "sealed", ticketJson: json });
      await expect((await f.start()).result).resolves.toEqual({
        state: "failed",
        reason: "ticket",
      });
      expect(f.redeem).not.toHaveBeenCalled();
    }
  });

  it("reports a failed redemption as a connection problem", async () => {
    const f = flow(
      { state: "sealed", ticketJson: ticketJson() },
      vi.fn(async () => {
        throw new Error("different computer");
      }),
    );
    await expect((await f.start()).result).resolves.toEqual({
      state: "failed",
      reason: "connection",
    });
  });

  it("exposes cancel", async () => {
    const f = flow({ state: "cancelled" });
    (await f.start()).cancel();
    expect(f.cancel).toHaveBeenCalled();
  });
});

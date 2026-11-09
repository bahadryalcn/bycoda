import { describe, expect, it, vi } from "vitest";
import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { createAccountPairingCode } from "./accountPairingCode";
import type { PhonePairingApi } from "./phonePairingTypes";
import type { RemoteMachine } from "./protocol";

const machine = { id: "m1", name: "Desk" } as RemoteMachine;
const KEY = "ab".repeat(32);
const tailscale: MobileAccessStatus = {
  state: "ready",
  mode: "tailscale",
  endpoint: "https://desk.tail.ts.net",
};
const lan: MobileAccessStatus = {
  state: "ready",
  mode: "lan",
  endpoint: "http://192.168.1.5:4000",
  lanKey: KEY,
};

function api(access: Record<string, MobileAccessStatus | Error>): PhonePairingApi {
  return {
    access: vi.fn(async (_m, mode = "lan") => {
      const value = access[mode]!;
      if (value instanceof Error) throw value;
      return value;
    }),
    create: vi.fn(async () => ({
      pairingId: "p1",
      ticket: "t".repeat(43),
      environmentId: "env-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })),
    cancel: vi.fn(async () => undefined),
  } as unknown as PhonePairingApi;
}

describe("createAccountPairingCode", () => {
  it("prefers the Tailscale HTTPS route when both are ready", async () => {
    const { code } = await createAccountPairingCode(machine, api({ tailscale, lan }));
    expect(code).toMatchObject({ endpoint: "https://desk.tail.ts.net" });
  });

  it("falls back to the local network when Tailscale is not ready", async () => {
    const { code } = await createAccountPairingCode(
      machine,
      api({ tailscale: { state: "setup-required" }, lan }),
    );
    expect(code).toMatchObject({ endpoint: "http://192.168.1.5:4000", lanKey: KEY });
  });

  it("falls back when the Tailscale check fails and fails when neither is ready", async () => {
    const { code } = await createAccountPairingCode(
      machine,
      api({ tailscale: new Error("x"), lan }),
    );
    expect(code).toMatchObject({ endpoint: "http://192.168.1.5:4000" });
    await expect(
      createAccountPairingCode(
        machine,
        api({ tailscale: { state: "offline" }, lan: { state: "setup-required" } }),
      ),
    ).rejects.toThrow("Phone access is not set up");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { createMobileRoutes } from "./mobile-routes";

const lanReady: MobileAccessStatus = {
  state: "ready",
  mode: "lan",
  endpoint: "http://192.168.2.108:41000",
  lanKey: "a".repeat(64),
};
const tailnetReady: MobileAccessStatus = {
  state: "ready",
  endpoint: "https://mini.tail1234.ts.net:8443",
};

afterEach(() => vi.useRealTimers());

describe("createMobileRoutes", () => {
  it("advertises the local listener with its public key and the Tailscale endpoint", async () => {
    const routes = createMobileRoutes({
      lan: async () => lanReady,
      tailscale: async () => tailnetReady,
    });
    expect(await routes()).toEqual([
      { endpoint: "http://192.168.2.108:41000", lanKey: "a".repeat(64) },
      { endpoint: "https://mini.tail1234.ts.net:8443" },
    ]);
  });

  it("leaves out routes that are not ready or fail", async () => {
    const routes = createMobileRoutes({
      lan: async () => ({ state: "setup-required", mode: "lan" }),
      tailscale: async () => {
        throw new Error("tailscale missing");
      },
    });
    expect(await routes()).toEqual([]);
  });

  it("asks Tailscale at most once a minute", async () => {
    vi.useFakeTimers();
    const tailscale = vi.fn(async () => tailnetReady);
    const routes = createMobileRoutes({ lan: async () => lanReady, tailscale });
    await routes();
    await routes();
    expect(tailscale).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await routes();
    expect(tailscale).toHaveBeenCalledTimes(2);
  });
});

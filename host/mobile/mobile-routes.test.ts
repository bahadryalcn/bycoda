import { describe, expect, it } from "vitest";
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
  mode: "tailscale",
  endpoint: "http://100.101.102.103:42000",
  lanKey: "b".repeat(64),
};

describe("createMobileRoutes", () => {
  it("advertises the local and tailnet listeners, each with its public key", async () => {
    const routes = createMobileRoutes({
      lan: async () => lanReady,
      tailnet: async () => tailnetReady,
    });
    expect(await routes()).toEqual([
      { endpoint: lanReady.endpoint, lanKey: lanReady.lanKey },
      { endpoint: tailnetReady.endpoint, lanKey: tailnetReady.lanKey },
    ]);
  });

  it("appends public tunnel routes last, flagged, https only", async () => {
    const routes = createMobileRoutes({
      lan: async () => lanReady,
      tailnet: async () => tailnetReady,
      publicUrls: () => [
        "https://a.trycloudflare.com",
        "http://insecure.example",
        "https://b.ts.net:8443",
      ],
    });
    expect(await routes()).toEqual([
      { endpoint: lanReady.endpoint, lanKey: lanReady.lanKey },
      { endpoint: tailnetReady.endpoint, lanKey: tailnetReady.lanKey },
      { endpoint: "https://a.trycloudflare.com", public: true },
      { endpoint: "https://b.ts.net:8443", public: true },
    ]);
  });

  it("advertises no public route when none is supplied", async () => {
    const routes = createMobileRoutes({
      lan: async () => lanReady,
      tailnet: async () => tailnetReady,
      publicUrls: () => [],
    });
    expect((await routes()).some((route) => "public" in route)).toBe(false);
  });

  it("leaves out listeners that are not ready, fail or have no key", async () => {
    const routes = createMobileRoutes({
      lan: async () => ({ state: "setup-required", mode: "lan" }),
      tailnet: async () => {
        throw new Error("no tailnet address");
      },
    });
    expect(await routes()).toEqual([]);
    const unkeyed = createMobileRoutes({
      lan: async () => ({ state: "ready", endpoint: "https://example.test" }),
      tailnet: async () => tailnetReady,
    });
    expect(await unkeyed()).toEqual([
      { endpoint: tailnetReady.endpoint, lanKey: tailnetReady.lanKey },
    ]);
  });
});

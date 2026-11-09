import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: () => ({
    Tailscale: [
      { address: "100.97.82.0", family: "IPv4", internal: false },
      { address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false },
    ],
    Ethernet: [{ address: "192.168.2.145", family: "IPv4", internal: false }],
    Public: [{ address: "203.0.113.7", family: "IPv4", internal: false }],
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    Cgnat: [{ address: "100.128.0.1", family: "IPv4", internal: false }],
    "vEthernet (Default Switch)": [{ address: "192.168.96.1", family: "IPv4", internal: false }],
    "vEthernet (WSL)": [{ address: "172.20.1.1", family: "IPv4", internal: false }],
  }),
}));

const { reachableAddresses } = await import("./mobile-lan");

describe("reachableAddresses", () => {
  it("reports home-network then Tailscale IPv4 addresses, never public or loopback ones", () => {
    expect(reachableAddresses()).toEqual(["192.168.2.145", "100.97.82.0"]);
  });

  it("leaves out virtual adapters another computer cannot reach", () => {
    expect(reachableAddresses()).not.toContain("192.168.96.1");
    expect(reachableAddresses()).not.toContain("172.20.1.1");
  });
});

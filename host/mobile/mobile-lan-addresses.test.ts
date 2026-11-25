import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: () => ({
    Tailscale: [
      { address: "100.97.82.0", family: "IPv4", internal: false },
      { address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false },
    ],
    Ethernet: [{ address: "192.168.2.145", family: "IPv4", internal: false }],
    "Ethernet 6": [
      { address: "10.216.60.21", netmask: "255.255.255.255", family: "IPv4", internal: false },
    ],
    "Ethernet 5": [
      { address: "192.168.95.2", netmask: "255.255.255.0", family: "IPv4", internal: false },
    ],
    Public: [{ address: "203.0.113.7", family: "IPv4", internal: false }],
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    Cgnat: [{ address: "100.128.0.1", family: "IPv4", internal: false }],
    "vEthernet (Default Switch)": [{ address: "192.168.96.1", family: "IPv4", internal: false }],
    "vEthernet (WSL)": [{ address: "172.20.1.1", family: "IPv4", internal: false }],
  }),
}));

const { reachableAddresses, localMobileAddresses, tailnetMobileAddresses, MobileLanAccess } =
  await import("./mobile-lan");
// oxlint-disable-next-line no-restricted-imports -- reads the mocked adapters this file defines
import { networkInterfaces } from "node:os";

describe("reachableAddresses", () => {
  it("reports home-network then Tailscale IPv4 addresses, never public or loopback ones", () => {
    expect(reachableAddresses()).toEqual(["192.168.2.145", "192.168.95.2", "100.97.82.0"]);
  });
  it("excludes point-to-point VPNs and orders the default-route interface first", () => {
    expect(localMobileAddresses(networkInterfaces(), "192.168.95.2")).toEqual([
      "192.168.95.2",
      "192.168.2.145",
    ]);
    expect(reachableAddresses(networkInterfaces(), "192.168.95.2")).toEqual([
      "192.168.95.2",
      "192.168.2.145",
      "100.97.82.0",
    ]);
  });
  it("offers the tailnet listener only this machine's Tailscale addresses", async () => {
    expect(tailnetMobileAddresses()).toEqual(["100.97.82.0"]);
    const access = new MobileLanAccess(
      "missing-mobile-tailnet-fixture/state.json",
      "pc",
      () => 3776,
      tailnetMobileAddresses,
      undefined,
      undefined,
      "tailscale",
    );
    try {
      expect(await access.status()).toMatchObject({
        mode: "tailscale",
        state: "setup-required",
        addresses: ["100.97.82.0"],
      });
      // A home-network address is never bound by the tailnet listener.
      expect(await access.enable("192.168.2.145")).toMatchObject({ mode: "tailscale" });
      expect((await access.status()).endpoint).toBeUndefined();
    } finally {
      await access.close();
    }
  });
  it("includes interface labels in status without binding a listener", async () => {
    const access = new MobileLanAccess(
      "missing-mobile-address-fixture/state.json",
      "pc",
      () => 3776,
      () => localMobileAddresses(networkInterfaces(), "192.168.2.145"),
    );
    try {
      expect(await access.status()).toMatchObject({
        state: "setup-required",
        addressInterfaces: { "192.168.2.145": "Ethernet", "192.168.95.2": "Ethernet 5" },
      });
    } finally {
      await access.close();
    }
  });

  it("leaves out virtual adapters another computer cannot reach", () => {
    expect(reachableAddresses()).not.toContain("192.168.96.1");
    expect(reachableAddresses()).not.toContain("172.20.1.1");
  });
});

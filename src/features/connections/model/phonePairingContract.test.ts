import { describe, expect, it } from "vitest";
import {
  InvalidPhonePairingResponse,
  phonePairingCode,
  phonePairingError,
  readMobileAccessStatus,
  readPhonePairingCreated,
  readPhonePairingStatus,
} from "./phonePairingContract";
import type { RemoteMachine } from "./protocol";

const machine: RemoteMachine = {
  id: "desktop",
  name: "Home computer",
  environmentId: "home-environment",
  endpoint: "http://127.0.0.1:49152",
  ssh: { target: "owner@home", remotePort: 3776 },
};

describe("phone pairing wire validation", () => {
  it("keeps the Host's interface names and network hint for LAN addresses only", () => {
    const access = readMobileAccessStatus({
      mode: "lan",
      state: "unavailable",
      addresses: ["192.168.2.108"],
      addressInterfaces: { "192.168.2.108": "Ethernet", "8.8.8.8": "Public", "10.0.0.2": 5 },
      networkHint: "Windows treats this network as Public.",
    });
    expect(access.addressInterfaces).toEqual({ "192.168.2.108": "Ethernet" });
    expect(access.networkHint).toBe("Windows treats this network as Public.");
  });

  it("pins the tailnet listener's key and rejects unkeyed or credentialed endpoints", () => {
    const lanKey = "b".repeat(64);
    const access = readMobileAccessStatus({
      mode: "tailscale",
      state: "ready",
      endpoint: "http://100.101.102.103:42000/",
      lanKey,
      addresses: ["100.101.102.103", "8.8.8.8"],
    });
    expect(access.addresses).toEqual(["100.101.102.103"]);
    const ticket = readPhonePairingCreated(
      {
        pairingId: "short-lived-id",
        environmentId: machine.environmentId,
        ticket: "a".repeat(43),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        desktopToken: "must-not-be-propagated",
      },
      machine,
    );
    const code = phonePairingCode(machine, access, ticket);
    expect(code.endpoint).toBe("http://100.101.102.103:42000");
    expect(code.lanKey).toBe(lanKey);
    expect(JSON.stringify(code)).not.toContain("127.0.0.1");
    expect(JSON.stringify(code)).not.toContain("must-not-be-propagated");
    for (const endpoint of [
      machine.endpoint,
      "https://home.tail123.ts.net:8443",
      "http://100.101.102.103:42000/bycoda",
      "http://100.101.102.103:42000/?ticket=secret",
      "http://100.200.1.1:42000",
    ])
      expect(() =>
        readMobileAccessStatus({ mode: "tailscale", state: "ready", endpoint, lanKey }),
      ).toThrow(InvalidPhonePairingResponse);
    expect(() =>
      readMobileAccessStatus({
        mode: "tailscale",
        state: "ready",
        endpoint: "http://100.101.102.103:42000",
      }),
    ).toThrow(InvalidPhonePairingResponse);
  });

  it("rejects an environment mismatch before a pairing code can be shown", () => {
    expect(() =>
      readPhonePairingCreated(
        {
          pairingId: "id",
          environmentId: "different-host",
          ticket: "a".repeat(43),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
        machine,
      ),
    ).toThrow(InvalidPhonePairingResponse);
    expect(() => readPhonePairingStatus({ state: "connected" })).toThrow(
      InvalidPhonePairingResponse,
    );
  });

  it("drops provider-controlled fields and retired access states", () => {
    expect(
      readMobileAccessStatus({
        state: "unavailable",
        approvalUrl: "https://evil.example/a",
        stderr: "secret",
      }),
    ).toEqual({ state: "unavailable" });
    expect(() => readMobileAccessStatus({ state: "approval-required" })).toThrow(
      InvalidPhonePairingResponse,
    );
  });

  it("keeps arbitrary native diagnostic content out of UI error copy", () => {
    expect(phonePairingError(new Error("ticket=secret CLI output"))).toBe("connection");
    expect(phonePairingError(new Error("Device management permission required."))).toBe(
      "management-required",
    );
    expect(phonePairingError(new Error("Unknown method: mobile.pairing.create"))).toBe(
      "host-update",
    );
  });
});

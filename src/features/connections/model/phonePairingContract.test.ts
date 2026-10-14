import { describe, expect, it } from "vitest";
import {
  InvalidPhonePairingResponse,
  phoneApprovalUrl,
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
  it("uses the host-discovered HTTPS address and rejects tunnel/manual credentials", () => {
    const access = readMobileAccessStatus({
      state: "ready",
      endpoint: "https://home.tail123.ts.net:8443/",
    });
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
    expect(code.endpoint).toBe("https://home.tail123.ts.net:8443");
    expect(JSON.stringify(code)).not.toContain("127.0.0.1");
    expect(JSON.stringify(code)).not.toContain("must-not-be-propagated");
    for (const endpoint of [
      machine.endpoint,
      "https://owner:secret@home.tail123.ts.net",
      "https://home.tail123.ts.net/bycoda",
      "https://home.tail123.ts.net/?ticket=secret",
    ])
      expect(() => readMobileAccessStatus({ state: "ready", endpoint })).toThrow(
        InvalidPhonePairingResponse,
      );
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

  it("only opens the exact Tailscale approval origin and drops provider-controlled fields", () => {
    expect(phoneApprovalUrl("https://login.tailscale.com/a/approve?id=123")).toBe(
      "https://login.tailscale.com/a/approve?id=123",
    );
    for (const url of [
      "http://login.tailscale.com/a",
      "https://login.tailscale.com.evil.example/a",
      "https://login.tailscale.com@evil.example/a",
      "https://login.tailscale.com:8443/a",
      "javascript:alert(1)",
    ])
      expect(phoneApprovalUrl(url)).toBeUndefined();
    expect(
      readMobileAccessStatus({
        state: "approval-required",
        approvalUrl: "https://evil.example/a",
        stderr: "secret",
      }),
    ).toEqual({ state: "approval-required" });
  });

  it("keeps arbitrary native diagnostic content out of UI error copy", () => {
    expect(phonePairingError(new Error("ticket=secret CLI output"))).toBe("connection");
    expect(phonePairingError(new Error("Unknown method: mobile.pairing.create"))).toBe(
      "host-update",
    );
  });
});

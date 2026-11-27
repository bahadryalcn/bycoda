import { describe, expect, it } from "vitest";
import type { ExternalTunnel, TunnelOverview } from "../../../integrations/external-tunnels";
import { publicPhoneAccess, publicPhoneEndpoint } from "./publicPhoneAccess";

const tunnel = (patch: Partial<ExternalTunnel> = {}): ExternalTunnel => ({
  id: "00000000-0000-4000-8000-000000000001",
  provider: "cloudflare",
  target: "host",
  localUrl: "http://127.0.0.1:3776",
  state: "ready",
  publicUrl: "https://quiet-river.trycloudflare.com",
  startedAt: 1,
  ...patch,
});
const overview = (
  tunnels: ExternalTunnel[],
  phonesOverPublic: boolean | "unknown" = true,
): TunnelOverview => ({
  environmentId: "env",
  hostLocalUrl: "http://127.0.0.1:3776",
  providers: [],
  tunnels,
  publicReachability: "unverified",
  ...(phonesOverPublic === "unknown" ? {} : { phonesOverPublic }),
});

describe("public phone pairing access", () => {
  it("uses the ready public Host tunnel while phones over the public internet are allowed", () => {
    expect(publicPhoneEndpoint(overview([tunnel()]))).toBe("https://quiet-river.trycloudflare.com");
    expect(publicPhoneAccess(overview([tunnel()]))).toEqual({
      state: "ready",
      endpoint: "https://quiet-river.trycloudflare.com",
    });
  });

  it("is hidden when the setting is off or unknown", () => {
    expect(publicPhoneEndpoint(overview([tunnel()], false))).toBeUndefined();
    expect(publicPhoneEndpoint(overview([tunnel()], "unknown"))).toBeUndefined();
    expect(publicPhoneEndpoint(undefined)).toBeUndefined();
    expect(publicPhoneAccess(overview([tunnel()], false))).toEqual({ state: "unavailable" });
  });

  it("needs a live Host tunnel, not a starting, stopped or dev-server one", () => {
    for (const patch of [
      { state: "starting" as const, publicUrl: undefined },
      { state: "stopped" as const },
      { target: "dev-server" as const },
      { publicUrl: undefined },
      { publicUrl: "http://plain.example.com" },
    ])
      expect(publicPhoneEndpoint(overview([tunnel(patch)]))).toBeUndefined();
  });
});

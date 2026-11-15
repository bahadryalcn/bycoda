import { describe, expect, it } from "vitest";
import { mergeRoutes, savedRoutes, summarizeRoutes } from "./machineRoutes";
import { RECONNECT_GRACE_MS, type RemoteConnectionState } from "./remoteConnection";
import {
  machineStatus,
  machineSummary,
  machineSummaryText,
  reconnectingEndsIn,
  routeKindOfAddress,
} from "./machineSummary";
import type { RemoteMachine } from "./protocol";

const NOW = 1_000_000;
const base = { enabled: true, reconnecting: false, autoReconnect: true, now: NOW };
const state = (patch: Partial<RemoteConnectionState>): RemoteConnectionState => ({
  status: "connected",
  ...patch,
});
const LONG_AGO = NOW - 5 * RECONNECT_GRACE_MS;

describe("machine status", () => {
  it.each([
    ["answers", state({ lastSeen: NOW }), undefined, "connected"],
    ["has not answered yet", state({ status: "connecting" }), undefined, "connecting"],
    [
      "is connecting but this page's check answered",
      state({ status: "connecting" }),
      "connected",
      "connected",
    ],
    ["answers but needs a provider", state({}), "provider", "connected"],
    ["needs a host update (probe)", state({}), "update", "update"],
    ["has an outdated host", state({ status: "outdated-host" }), undefined, "update"],
    [
      "did not answer long ago",
      state({ status: "unreachable", lastSeen: LONG_AGO }),
      "offline",
      "offline",
    ],
    ["never answered and is not retried", state({ status: "unreachable" }), undefined, "offline"],
    ["needs a password", state({ status: "needs-auth", lastSeen: NOW - 1 }), undefined, "offline"],
    [
      "changed identity",
      state({ status: "identity-mismatch", lastSeen: NOW - 1 }),
      undefined,
      "offline",
    ],
  ] as const)("a machine that %s is %s", (_name, connection, probed, expected) => {
    expect(machineStatus({ ...base, connection, probed })).toBe(expected);
  });

  it("is Reconnecting inside the shared grace and Offline from it on", () => {
    const quiet = (age: number) =>
      machineStatus({
        ...base,
        connection: state({ status: "unreachable", lastSeen: NOW - age }),
        probed: "offline",
      });
    expect(quiet(RECONNECT_GRACE_MS - 1)).toBe("reconnecting");
    expect(quiet(RECONNECT_GRACE_MS)).toBe("offline");
  });

  it("is Reconnecting while an attempt runs, however long the machine was quiet", () => {
    expect(
      machineStatus({
        ...base,
        reconnecting: true,
        connection: state({ status: "unreachable", lastSeen: LONG_AGO }),
      }),
    ).toBe("reconnecting");
  });

  it("is Offline, not Reconnecting, when automatic reconnecting is off or the owner must act", () => {
    const quiet = state({ status: "unreachable", lastSeen: NOW - 1 });
    expect(machineStatus({ ...base, autoReconnect: false, connection: quiet })).toBe("offline");
    expect(
      machineStatus({
        ...base,
        reconnecting: true,
        connection: state({ status: "host-key", lastSeen: NOW - 1 }),
      }),
    ).toBe("offline");
  });

  it("is Disabled whatever else is known", () => {
    expect(
      machineStatus({ ...base, enabled: false, connection: state({ status: "unreachable" }) }),
    ).toBe("disabled");
    expect(
      machineStatus({ ...base, enabled: false, connection: state({}), probed: "update" }),
    ).toBe("disabled");
  });

  it("says when Reconnecting ends so the row can re-render", () => {
    expect(reconnectingEndsIn(state({ status: "unreachable", lastSeen: NOW - 10_000 }), NOW)).toBe(
      RECONNECT_GRACE_MS - 10_000,
    );
    expect(reconnectingEndsIn(state({ lastSeen: NOW - RECONNECT_GRACE_MS }), NOW)).toBeUndefined();
    expect(reconnectingEndsIn(state({}), NOW)).toBeUndefined();
  });
});

describe("machine summary line", () => {
  it("joins route kind, status and routes with middle dots", () => {
    const summary = machineSummary({ routeKind: "lan", status: "connected", routeCount: 3 });
    expect(machineSummaryText(summary)).toBe("LAN · Connected · 3 routes");
    expect(summary.routes).toBe("3 routes");
  });

  it("shows the version only when it differs from this desktop's", () => {
    const text = (version?: string, desktopVersion?: string) =>
      machineSummaryText(
        machineSummary({
          routeKind: "tailscale",
          status: "connected",
          version,
          desktopVersion,
          routeCount: 1,
        }),
      );
    expect(text("0.7.9", "0.7.9")).toBe("Tailscale · Connected · 1 route");
    expect(text("0.7.8", "0.7.9")).toBe("Tailscale · Connected · 0.7.8 · 1 route");
    expect(text("0.7.8", undefined)).toBe("Tailscale · Connected · 1 route");
    expect(text(undefined, "0.7.9")).toBe("Tailscale · Connected · 1 route");
  });

  it("leaves out what is not known", () => {
    expect(machineSummaryText(machineSummary({ status: "disabled" }))).toBe("Disabled");
    expect(machineSummary({ status: "offline", routeCount: 0 }).routes).toBeUndefined();
  });

  it("names every status", () => {
    const statuses = [
      "connected",
      "connecting",
      "reconnecting",
      "offline",
      "update",
      "disabled",
    ] as const;
    expect(statuses.map((status) => machineSummary({ status }).parts[0]!.text)).toEqual([
      "Connected",
      "Connecting",
      "Reconnecting",
      "Offline",
      "Update required",
      "Disabled",
    ]);
  });
});

describe("route kinds", () => {
  it.each([
    ["192.168.2.145", "lan"],
    ["10.0.0.4", "lan"],
    ["172.20.1.1", "lan"],
    ["100.97.82.0", "tailscale"],
    ["studio.tail123.ts.net", "tailscale"],
    ["calm-river.trycloudflare.com", "tunnel"],
    ["https://calm-river.trycloudflare.com", "tunnel"],
    ["owner@macbook", "ssh"],
    ["http://127.0.0.1:3776", "lan"],
  ] as const)("%s is %s", (address, kind) => {
    expect(routeKindOfAddress(address)).toBe(kind);
  });

  const machine = {
    id: "m",
    name: "Mac",
    endpoint: "ssh://me@100.97.82.0",
    environmentId: "env",
    ssh: { target: "me@100.97.82.0", remotePort: 3776, alternate: "me@192.168.2.145" },
  } as unknown as RemoteMachine;
  const tunnel = {
    address: "calm-river.trycloudflare.com",
    kind: "tunnel",
    source: "account",
    enabled: true,
  } as const;

  it("names the route in use, counts the routes turned on, and includes a learned tunnel", () => {
    const routes = mergeRoutes(machine, {
      prefer: "saved",
      active: tunnel.address,
      routes: [
        { address: "100.97.82.0", kind: "tailscale", source: "saved", enabled: true },
        { address: "192.168.95.2", kind: "lan", source: "reported", enabled: false },
        tunnel,
      ],
    });
    expect(summarizeRoutes(routes)).toEqual({ kind: "tunnel", count: 2 });
  });

  it("falls back to the machine's own record when the desktop store cannot be read", () => {
    expect(summarizeRoutes(mergeRoutes(machine))).toEqual({ kind: "tailscale", count: 2 });
    const url = { ...machine, ssh: null, endpoint: "https://host.example.com" } as RemoteMachine;
    expect(savedRoutes(url)[0]).toMatchObject({ kind: "url", address: "host.example.com" });
    expect(summarizeRoutes(mergeRoutes(url, { prefer: "saved", routes: [tunnel] }))).toEqual({
      kind: "url",
      count: 2,
    });
    const lan = { ...url, endpoint: "http://192.168.1.20:3776" } as RemoteMachine;
    expect(summarizeRoutes(mergeRoutes(lan))).toEqual({ kind: "lan", count: 1 });
  });
});

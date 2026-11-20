import { describe, expect, it, vi } from "vitest";
import {
  availableMobilePort,
  existingMobileEndpoint,
  tailscaleApprovalUrl,
} from "./mobile-access-config";
import { mobileAccessFailure } from "./mobile-access-process";
import { createMobileAccessService } from "./mobile-access";

const dns = "desktop.example.ts.net";
const identity = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: `${dns}.`, HostName: "Desktop", Online: true },
});
const configured = (httpsPort = 443, backendPort = 3776) => ({
  TCP: { [httpsPort]: { HTTPS: true } },
  Web: {
    [`${dns}:${httpsPort}`]: {
      Handlers: { "/": { Proxy: `http://127.0.0.1:${backendPort}` } },
    },
  },
});

describe("private mobile access", () => {
  it("reads status without enabling anything", async () => {
    const run = vi.fn(async (_program: string, args: string[]) =>
      args[0] === "status" ? identity : JSON.stringify(configured()),
    );
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
    });
    expect(await service.status()).toEqual({
      state: "ready",
      endpoint: `https://${dns}`,
      machineName: "Desktop",
    });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["status", "--json"],
      ["serve", "status", "--json"],
    ]);
  });
  it("does not overwrite another backend or public Funnel port", () => {
    const other = configured(443, 3000);
    expect(existingMobileEndpoint(other, dns, 3776)).toBeUndefined();
    expect(availableMobilePort(other)).toBe(8443);
    const publicConfig = {
      ...configured(),
      AllowFunnel: { [`${dns}:443`]: true },
    };
    expect(existingMobileEndpoint(publicConfig, dns, 3776)).toBeUndefined();
    expect(availableMobilePort(publicConfig)).toBe(8443);
  });
  it("enables a free private port and verifies the resulting config", async () => {
    let config = configured(443, 3000);
    const run = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "status") return identity;
      if (args[1] === "status") return JSON.stringify(config);
      config = {
        TCP: { ...config.TCP, ...configured(8443).TCP },
        Web: { ...config.Web, ...configured(8443).Web },
      };
      return "enabled";
    });
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
    });
    expect(await service.enable()).toEqual({
      state: "ready",
      endpoint: `https://${dns}:8443`,
      machineName: "Desktop",
    });
    expect(run.mock.calls.map((call) => call[1])).toContainEqual([
      "serve",
      "--bg",
      "--yes",
      "--https=8443",
      "http://127.0.0.1:3776",
    ]);
    expect(config.Web[`${dns}:443`]).toEqual(configured(443, 3000).Web[`${dns}:443`]);
  });
  it("coalesces simultaneous explicit enable requests", async () => {
    let config: unknown = {};
    const run = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "status") return identity;
      if (args[1] === "status") return JSON.stringify(config);
      config = configured();
      return "enabled";
    });
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
    });
    const results = await Promise.all([service.enable(), service.enable()]);
    expect(results.every((result) => result.state === "ready")).toBe(true);
    expect(run.mock.calls.filter((call) => call[1][1] === "--bg")).toHaveLength(1);
  });
  it("reports every status and enable result to observers without letting them fail the call", async () => {
    let config: unknown = {};
    const run = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "status") return identity;
      if (args[1] === "status") return JSON.stringify(config);
      config = configured();
      return "enabled";
    });
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
    });
    const seen: string[] = [];
    service.observe((status) => seen.push(status.state));
    service.observe(() => {
      throw new Error("observer failed");
    });
    expect((await service.status()).state).toBe("setup-required");
    expect((await service.enable()).state).toBe("ready");
    expect(seen).toEqual(["setup-required", "ready"]);
  });
  // Regression: environment.describe read this on every call, and each probe started
  // two Tailscale processes that blocked the Host event loop.
  it("reuses a status until the network changes and coalesces concurrent probes", async () => {
    let network = "Wi-Fi=192.168.1.5";
    const run = vi.fn(async () => {
      throw new Error("Tailscale service is not running");
    });
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
      network: () => network,
    });
    const seen: string[] = [];
    service.observe((status) => seen.push(status.state));
    const first = await Promise.all([service.status(), service.status()]);
    expect(first.map((status) => status.state)).toEqual(["unavailable", "unavailable"]);
    expect((await service.status()).state).toBe("unavailable");
    expect(run).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["unavailable"]);
    // The owner's explicit check bypasses the cache.
    await service.status({ fresh: true });
    expect(run).toHaveBeenCalledTimes(2);
    // Tailscale coming up gives its adapter an address: the next read probes again.
    network = "Tailscale=100.97.82.0|Wi-Fi=192.168.1.5";
    run.mockImplementation(async (_program: string, args: string[]) =>
      args[0] === "status" ? identity : JSON.stringify(configured()),
    );
    expect((await service.status()).state).toBe("ready");
    expect(run).toHaveBeenCalledTimes(4);
  });
  it("keeps an enable result over a probe that started before it", async () => {
    let config: unknown = {};
    let releaseProbe!: () => void;
    const gate = new Promise<void>((resolve) => (releaseProbe = resolve));
    let firstProbe = true;
    const run = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "status") {
        if (firstProbe) {
          // The earlier probe saw an older answer and finishes last.
          firstProbe = false;
          await gate;
          return JSON.stringify({ BackendState: "NeedsLogin" });
        }
        return identity;
      }
      if (args[1] === "status") return JSON.stringify(config);
      config = configured();
      return "enabled";
    });
    const service = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
      network: () => "Wi-Fi=192.168.1.5",
    });
    const seen: string[] = [];
    service.observe((status) => seen.push(status.state));
    const stale = service.status();
    const enabled = service.enable();
    // While an enable runs, a status read waits for it instead of probing again.
    const during = service.status();
    expect((await enabled).state).toBe("ready");
    expect((await during).state).toBe("ready");
    releaseProbe();
    expect((await stale).state).toBe("ready");
    expect(seen).toEqual(["ready"]);
    const calls = run.mock.calls.length;
    expect((await service.status()).state).toBe("ready");
    expect(run).toHaveBeenCalledTimes(calls);
  });
  it("needs installation or login instead of silently configuring networking", async () => {
    const run = vi.fn(async () => JSON.stringify({ BackendState: "NeedsLogin" }));
    const missing = createMobileAccessService(() => 3776, {
      executable: async () => undefined,
      run,
    });
    expect(await missing.enable()).toEqual({ state: "install-required" });
    expect(run).not.toHaveBeenCalled();
    const loggedOut = createMobileAccessService(() => 3776, {
      executable: async () => "tailscale",
      run,
    });
    expect(await loggedOut.enable()).toEqual({ state: "sign-in-required" });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects insecure lookalike approval links and hides CLI diagnostics", () => {
    expect(
      tailscaleApprovalUrl("https://login.tailscale.com.attacker.test/approve"),
    ).toBeUndefined();
    expect(tailscaleApprovalUrl("https://user:secret@login.tailscale.com/approve")).toBeUndefined();
    expect(
      mobileAccessFailure({
        stdout: "Enable at https://login.tailscale.com/f/serve",
        stderr: "internal",
      }),
    ).toEqual({
      state: "approval-required",
      approvalUrl: "https://login.tailscale.com/f/serve",
    });
    expect(
      mobileAccessFailure({
        stderr: "Access is denied: credential-sensitive-text",
      }),
    ).toEqual({ state: "permission-required" });
    expect(mobileAccessFailure(new Error("private-diagnostic"))).toEqual({
      state: "unavailable",
    });
  });
  it("bounds port allocation and refuses an invalid host listener", async () => {
    const ports = [443, ...Array.from({ length: 16 }, (_, index) => 8443 + index)];
    expect(
      availableMobilePort({
        TCP: Object.fromEntries(ports.map((port) => [port, { HTTPS: true }])),
      }),
    ).toBeUndefined();
    const run = vi.fn(async () => identity);
    const service = createMobileAccessService(() => 0, {
      executable: async () => "tailscale",
      run,
    });
    expect(await service.enable()).toEqual({ state: "unavailable" });
    expect(run).not.toHaveBeenCalled();
  });
});

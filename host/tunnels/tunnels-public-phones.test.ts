import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalTunnels } from "./tunnels";
import type { TunnelEvent } from "./tunnel-providers";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup(funnelPort = 8443) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-tunnels-public-"));
  directories.push(directory);
  const callbacks: ((event: TunnelEvent) => void)[] = [];
  const launch = vi.fn((_command, emit: (event: TunnelEvent) => void) => {
    callbacks.push(emit);
    return { stop: vi.fn(async () => emit({ type: "exit" })) };
  });
  const funnel = vi.fn(async (_program: string) => funnelPort);
  const service = new ExternalTunnels(directory, "host-a", () => "http://127.0.0.1:3776", {
    credentials: { get: vi.fn(async () => undefined), set: vi.fn(), delete: vi.fn() },
    executable: vi.fn(async () => "/test/provider"),
    probe: vi.fn(async () => true),
    install: vi.fn(async () => "/x"),
    funnelPort: funnel,
    launch,
  });
  return { service, directory, launch, callbacks, funnel };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const origin = () => "http://127.0.0.1:3776";

describe("phones over public tunnels (opt-in)", () => {
  it("is off by default, off after damaged state, and persists the owner's choice", async () => {
    const s = await setup();
    expect((await s.service.status()).phonesOverPublic).toBe(false);
    expect(s.service.allowsPhonesOverPublic()).toBe(false);
    expect(s.service.publicPhoneUrls()).toEqual([]);
    expect(await s.service.setPhonesOverPublic({ enabled: true })).toEqual({
      phonesOverPublic: true,
    });
    expect(JSON.parse(await readFile(join(s.directory, "phones.json"), "utf8"))).toEqual({
      environmentId: "host-a",
      enabled: true,
    });
    const reloaded = new ExternalTunnels(s.directory, "host-a", origin);
    expect((await reloaded.status()).phonesOverPublic).toBe(true);
    await writeFile(join(s.directory, "phones.json"), "{not json");
    const damaged = new ExternalTunnels(s.directory, "host-a", origin);
    expect((await damaged.status()).phonesOverPublic).toBe(false);
    expect(damaged.allowsPhonesOverPublic()).toBe(false);
    // The owner can set it again after the damage.
    expect(await damaged.setPhonesOverPublic({ enabled: true })).toEqual({
      phonesOverPublic: true,
    });
    await writeFile(
      join(s.directory, "phones.json"),
      JSON.stringify({ environmentId: "other-host", enabled: true }),
    );
    const foreign = new ExternalTunnels(s.directory, "host-a", origin);
    expect((await foreign.status()).phonesOverPublic).toBe(false);
  });

  it("accepts only a boolean", async () => {
    const s = await setup();
    for (const enabled of ["true", 1, undefined, null])
      await expect(s.service.setPhonesOverPublic({ enabled })).rejects.toThrow("invalid-target");
    expect(s.service.allowsPhonesOverPublic()).toBe(false);
  });

  it("advertises live Host tunnels as phone routes only while allowed", async () => {
    const s = await setup();
    await s.service.start({ provider: "cloudflare", target: "host" });
    s.callbacks[0]({ type: "ready", publicUrl: "https://a-b.trycloudflare.com" });
    await settle();
    expect((await s.service.status()).tunnels[0].state).toBe("ready");
    expect(s.service.publicPhoneUrls()).toEqual([]);
    await s.service.setPhonesOverPublic({ enabled: true });
    expect(s.service.publicPhoneUrls()).toEqual(["https://a-b.trycloudflare.com"]);
    await s.service.setPhonesOverPublic({ enabled: false });
    expect(s.service.publicPhoneUrls()).toEqual([]);
    await s.service.close();
  });
});

describe("Tailscale Funnel tunnel", () => {
  it("starts the host target on the chosen port against the tunnel ingress", async () => {
    const s = await setup(443);
    await s.service.start({ provider: "tailscale", target: "host" });
    expect(s.funnel).toHaveBeenCalledWith("/test/provider");
    expect(s.launch.mock.calls[0][0]).toMatchObject({
      provider: "tailscale",
      program: "/test/provider",
      args: ["funnel", "--https=443", "http://127.0.0.1:3776"],
    });
    s.callbacks[0]({ type: "ready", publicUrl: "https://bab.tail.ts.net" });
    await settle();
    expect((await s.service.status()).tunnels[0]).toMatchObject({
      state: "ready",
      publicUrl: "https://bab.tail.ts.net",
    });
    await s.service.close();
  });

  it("refuses dev servers and fails closed when no Funnel port is free", async () => {
    const s = await setup();
    await expect(
      s.service.start({ provider: "tailscale", target: "dev-server", localUrl: "3000" }),
    ).rejects.toThrow("invalid-target");
    const full = await setup(0);
    expect(await full.service.start({ provider: "tailscale", target: "host" })).toMatchObject({
      state: "error",
      issue: "connection-failed",
    });
    expect(full.launch).not.toHaveBeenCalled();
  });

  it("keeps a validated approval URL with the approval-required issue", async () => {
    const s = await setup();
    await s.service.start({ provider: "tailscale", target: "host" });
    s.callbacks[0]({
      type: "error",
      issue: "approval-required",
      approvalUrl: "https://login.tailscale.com/f/funnel?node=n1",
    });
    await settle();
    expect((await s.service.status()).tunnels[0]).toMatchObject({
      state: "error",
      issue: "approval-required",
      approvalUrl: "https://login.tailscale.com/f/funnel?node=n1",
    });
    await s.service.close();
    const bad = await setup();
    await bad.service.start({ provider: "tailscale", target: "host" });
    bad.callbacks[0]({
      type: "error",
      issue: "approval-required",
      approvalUrl: "https://evil.example/",
    });
    await settle();
    const record = (await bad.service.status()).tunnels[0];
    expect(record.issue).toBe("approval-required");
    expect(record.approvalUrl).toBeUndefined();
    await bad.service.close();
  });
});

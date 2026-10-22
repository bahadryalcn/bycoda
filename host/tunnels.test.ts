import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalTunnels } from "./tunnels";
import type { TunnelEvent } from "./tunnel-providers";
import type { SocialCredential } from "./social-credentials";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-tunnels-"));
  directories.push(directory);
  const secrets = new Map<string, SocialCredential>();
  const credentials = {
    get: vi.fn(async (id: string) => secrets.get(id)),
    set: vi.fn(async (id: string, value: SocialCredential) => {
      secrets.set(id, value);
    }),
    delete: vi.fn(async (id: string) => {
      secrets.delete(id);
    }),
  };
  const callbacks: ((event: TunnelEvent) => void)[] = [];
  const stops: ReturnType<typeof vi.fn>[] = [];
  const launch = vi.fn((_command, emit) => {
    callbacks.push(emit);
    const stop = vi.fn(async () => {
      emit({ type: "exit" });
    });
    stops.push(stop);
    return { stop };
  });
  const executable = vi.fn(async () => "/test/provider");
  const probe = vi.fn(async () => true);
  const dependencies = { credentials, executable, probe, launch };
  const service = new ExternalTunnels(
    directory,
    "host-a",
    () => "http://127.0.0.1:3776",
    dependencies,
  );
  return {
    service,
    directory,
    dependencies,
    credentials,
    secrets,
    launch,
    stops,
    callbacks,
    executable,
    probe,
  };
}
const dev = { provider: "cloudflare", target: "dev-server", localUrl: "3000" } as const;

describe("external tunnels host ownership", () => {
  it("observes missing credentials without creating a real OS vault", async () => {
    const s = await setup();
    const service = new ExternalTunnels(s.directory, "host-a", () => "http://127.0.0.1:3776", {
      executable: s.executable,
    });
    expect(
      (await service.status()).providers.find((item) => item.provider === "ngrok")?.credential,
    ).toBe("missing");
    await expect(readFile(join(s.directory, "credentials", "tokens.enc"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(s.directory, "credentials", "key.dpapi"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("runs against this host's loopback, exposes safe status and stops only its retained handle", async () => {
    const s = await setup();
    const starting = await s.service.start(dev);
    expect(starting.state).toBe("starting");
    expect(s.probe).toHaveBeenCalledWith("http://127.0.0.1:3000");
    expect(s.launch.mock.calls[0][0].args).toContain("http://127.0.0.1:3000");
    expect((await s.service.start(dev)).id).toBe(starting.id);
    expect(s.launch).toHaveBeenCalledTimes(1);
    s.callbacks[0]({ type: "ready", publicUrl: "https://host-a.trycloudflare.com" });
    const status = await s.service.status();
    expect(status.tunnels[0]).toMatchObject({ state: "ready", canStop: true });
    expect(status.publicReachability).toBe("unverified");
    await expect(s.service.stop({ id: "foreign-process-id" })).rejects.toThrow("invalid-target");
    expect(s.stops[0]).not.toHaveBeenCalled();
    expect((await s.service.stop({ id: starting.id })).state).toBe("stopped");
    expect(s.stops[0]).toHaveBeenCalledTimes(1);
    expect((await s.service.status()).tunnels[0]).toMatchObject({ canStop: false });
  });

  it("forces host access to the authenticated host port and prevents disguising it as a dev server", async () => {
    const s = await setup();
    await expect(s.service.start({ ...dev, localUrl: "http://localhost:3776" })).rejects.toThrow(
      "host-target-required",
    );
    await expect(s.service.start({ ...dev, target: "host", localUrl: "3000" })).rejects.toThrow(
      "invalid-target",
    );
    for (const url of [
      "http://evil.example:3000",
      "http://user:secret@localhost:3000",
      "http://localhost:3000/?token=secret",
    ]) {
      await expect(s.service.start({ ...dev, localUrl: url })).rejects.toThrow("invalid-target");
    }
    const record = await s.service.start({ provider: "cloudflare", target: "host" });
    expect(record.localUrl).toBe("http://127.0.0.1:3776");
    expect(s.launch).toHaveBeenCalledTimes(1);
    await s.service.close();
  });

  it("keeps tokens only in the existing vault and private launch payload", async () => {
    const s = await setup();
    expect((await s.service.start({ ...dev, provider: "ngrok" })).issue).toBe("credential-missing");
    expect(s.launch).not.toHaveBeenCalled();
    await s.service.credential({ provider: "ngrok", token: "synthetic-token-do-not-print" });
    await s.service.start({ ...dev, provider: "ngrok" });
    const command = s.launch.mock.calls[0][0];
    expect(command.token).toBe("synthetic-token-do-not-print");
    expect(command.args.join(" ")).not.toContain("synthetic-token");
    expect(await readFile(join(s.directory, "ngrok.yml"), "utf8")).not.toContain("synthetic-token");
    expect(await readFile(join(s.directory, "state.json"), "utf8")).not.toContain(
      "synthetic-token",
    );
    expect(JSON.stringify(await s.service.status())).not.toContain("synthetic-token");
    await s.service.credential({ provider: "ngrok", token: "" });
    expect(s.credentials.delete).toHaveBeenCalledWith("ngrok");
    await s.service.close();
  });

  it("reports missing CLI, locked vault and unreachable origin without raw output", async () => {
    const s = await setup();
    s.executable.mockResolvedValueOnce(undefined as never);
    expect((await s.service.start(dev)).issue).toBe("cli-missing");
    s.credentials.get.mockRejectedValueOnce(new Error("private-secret-in-vault-error"));
    expect((await s.service.start({ ...dev, provider: "ngrok" })).issue).toBe(
      "credential-store-unavailable",
    );
    s.probe.mockResolvedValueOnce(false);
    expect((await s.service.start(dev)).issue).toBe("origin-unreachable");
    expect(s.launch).not.toHaveBeenCalled();
    expect(JSON.stringify(await s.service.status())).not.toContain("private-secret");
    s.credentials.set.mockRejectedValueOnce(new Error("private-secret"));
    await expect(s.service.credential({ provider: "ngrok", token: "test-token" })).rejects.toThrow(
      "credential-store-unavailable",
    );
  });

  it("invalidates a ready URL on connection failure or unexpected exit", async () => {
    const s = await setup();
    await s.service.start(dev);
    s.callbacks[0]({ type: "ready", publicUrl: "https://host-a.trycloudflare.com" });
    await s.service.status();
    s.callbacks[0]({ type: "error", issue: "connection-failed" });
    let record = (await s.service.status()).tunnels[0];
    expect(record).toMatchObject({ state: "error", issue: "connection-failed" });
    expect(record.publicUrl).toBeUndefined();
    await s.service.start(dev);
    s.callbacks[1]({ type: "exit" });
    record = (await s.service.status()).tunnels[1];
    expect(record).toMatchObject({ state: "error", issue: "unexpected-exit", canStop: false });
  });

  it("reconciles restart records without adopting or signalling a persisted PID", async () => {
    const s = await setup();
    const first = await s.service.start(dev);
    const manifest = JSON.parse(await readFile(join(s.directory, "state.json"), "utf8"));
    manifest.tunnels[0] = {
      ...manifest.tunnels[0],
      state: "ready",
      publicUrl: "https://old.trycloudflare.com",
      pid: process.pid,
      canStop: true,
    };
    await writeFile(join(s.directory, "state.json"), JSON.stringify(manifest));
    const replacement = new ExternalTunnels(
      s.directory,
      "host-a",
      () => "http://127.0.0.1:3776",
      s.dependencies,
    );
    const restored = (await replacement.status()).tunnels[0];
    expect(restored).toMatchObject({
      state: "interrupted",
      issue: "host-restarted",
      canStop: false,
    });
    expect(restored.publicUrl).toBeUndefined();
    await replacement.stop({ id: first.id });
    expect(s.stops[0]).not.toHaveBeenCalled();
    expect(s.launch).toHaveBeenCalledTimes(1);
    await s.service.close();
  });

  it("preserves an unreadable or foreign manifest and refuses to launch", async () => {
    const s = await setup();
    const content = JSON.stringify({ version: 1, environmentId: "another-host", tunnels: [] });
    await writeFile(join(s.directory, "state.json"), content);
    await expect(s.service.status()).rejects.toThrow("storage-unavailable");
    await expect(s.service.start(dev)).rejects.toThrow("storage-unavailable");
    await s.service.close();
    expect(await readFile(join(s.directory, "state.json"), "utf8")).toBe(content);
    expect(s.launch).not.toHaveBeenCalled();
  });
  it("retains ownership after a failed stop so only that same child can be retried", async () => {
    const s = await setup();
    const record = await s.service.start(dev);
    s.callbacks[0]({ type: "ready", publicUrl: "https://owned.trycloudflare.com" });
    await s.service.status();
    s.stops[0].mockRejectedValueOnce(new Error("private-process-details"));
    expect(await s.service.stop({ id: record.id })).toMatchObject({
      state: "error",
      issue: "stop-failed",
    });
    const failed = (await s.service.status()).tunnels[0];
    expect(failed.canStop).toBe(true);
    expect(failed.publicUrl).toBeUndefined();
    expect(await s.service.stop({ id: record.id })).toMatchObject({ state: "stopped" });
    expect(s.stops[0]).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await s.service.status())).not.toContain("private-process-details");
  });
});

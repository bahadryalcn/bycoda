import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalTunnels } from "./tunnels";
import * as atomicWrite from "../storage/atomic-write";

// Pass-through spy so one test can make a state read fail with a real I/O error code.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import type { TunnelEvent } from "./tunnel-providers";
import type { SocialCredential } from "../social/social-credentials";

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

  it("moves a foreign manifest aside untouched and starts an empty control lane", async () => {
    const s = await setup();
    const content = JSON.stringify({ version: 1, environmentId: "another-host", tunnels: [] });
    await writeFile(join(s.directory, "state.json"), content);
    expect((await s.service.status()).tunnels).toEqual([]);
    expect(await readFile(join(s.directory, "state.foreign-another-host.json"), "utf8")).toBe(
      content,
    );
    expect(JSON.parse(await readFile(join(s.directory, "state.json"), "utf8"))).toMatchObject({
      environmentId: "host-a",
      tunnels: [],
    });
    const record = await s.service.start(dev);
    expect(record.state).toBe("starting");
    expect(s.launch).toHaveBeenCalledTimes(1);
    await s.service.close();
  });

  it("never overwrites an earlier foreign aside copy", async () => {
    const s = await setup();
    await writeFile(join(s.directory, "state.foreign-another-host.json"), "earlier-evidence");
    await writeFile(
      join(s.directory, "state.json"),
      JSON.stringify({ version: 1, environmentId: "another-host", tunnels: [] }),
    );
    await s.service.status();
    expect(await readFile(join(s.directory, "state.foreign-another-host.json"), "utf8")).toBe(
      "earlier-evidence",
    );
    expect(
      await readFile(join(s.directory, "state.foreign-another-host-1.json"), "utf8"),
    ).toContain("another-host");
  });

  it("quarantines damaged state, starts from a usable manifest and keeps the original bytes", async () => {
    const s = await setup();
    const path = join(s.directory, "state.json");
    for (const original of ["", "{", "[]", JSON.stringify({ version: 2, tunnels: [] })]) {
      await writeFile(path, original);
      // Each damaged file is repaired by a service instance's first load.
      const service = new ExternalTunnels(
        s.directory,
        "host-a",
        () => "http://127.0.0.1:3776",
        s.dependencies,
      );
      expect(await service.status()).toMatchObject({
        tunnels: [],
        repair: { repaired: true, dropped: 0 },
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        version: 1,
        environmentId: "host-a",
        tunnels: [],
      });
    }
    const copies = (await readdir(s.directory)).filter((name) =>
      name.startsWith("state.json.corrupt-"),
    );
    expect(copies.length).toBeGreaterThan(0);
    const retained = await Promise.all(
      copies.map((name) => readFile(join(s.directory, name), "utf8")),
    );
    // The oldest copy (the empty file) is pruned; the three newest are retained.
    expect(retained).toEqual(
      expect.arrayContaining(["{", "[]", JSON.stringify({ version: 2, tunnels: [] })]),
    );
    expect(s.launch).not.toHaveBeenCalled();
  });

  it("salvages valid records from a damaged manifest as interrupted and drops invalid ones", async () => {
    const s = await setup();
    const valid = {
      id: "0b5c1a2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      provider: "cloudflare",
      target: "dev-server",
      localUrl: "http://127.0.0.1:3000",
      state: "ready",
      publicUrl: "https://old.trycloudflare.com",
      startedAt: 1,
    };
    const invalid = { ...valid, id: "not-a-uuid" };
    const damaged = JSON.stringify({
      version: 1,
      environmentId: "host-a",
      tunnels: [
        valid,
        invalid,
        { ...valid, id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", provider: "ftp" },
      ],
    });
    await writeFile(join(s.directory, "state.json"), damaged);
    const status = await s.service.status();
    expect(status.repair).toEqual({ repaired: true, dropped: 2 });
    expect(status.tunnels).toEqual([
      {
        id: valid.id,
        provider: "cloudflare",
        target: "dev-server",
        localUrl: "http://127.0.0.1:3000",
        state: "interrupted",
        startedAt: 1,
        issue: "host-restarted",
        canStop: false,
      },
    ]);
    expect(JSON.stringify(status)).not.toContain("old.trycloudflare.com");
    const copies = (await readdir(s.directory)).filter((name) =>
      name.startsWith("state.json.corrupt-"),
    );
    expect(copies).toHaveLength(1);
    expect(await readFile(join(s.directory, copies[0]), "utf8")).toBe(damaged);
    expect(s.launch).not.toHaveBeenCalled();
  });

  it("keeps at most three quarantined manifests", async () => {
    const s = await setup();
    for (let round = 0; round < 4; round++) {
      await writeFile(join(s.directory, "state.json"), `damaged-${round}`);
      await s.service.status();
      // A fresh service instance performs the load on the next round.
      s.service = new ExternalTunnels(
        s.directory,
        "host-a",
        () => "http://127.0.0.1:3776",
        s.dependencies,
      );
    }
    const copies = (await readdir(s.directory)).filter((name) =>
      name.startsWith("state.json.corrupt-"),
    );
    expect(copies).toHaveLength(3);
    const retained = await Promise.all(
      copies.map((name) => readFile(join(s.directory, name), "utf8")),
    );
    expect(retained.sort()).toEqual(["damaged-1", "damaged-2", "damaged-3"]);
  });

  it("reports storage-unavailable for a real read error instead of repairing", async () => {
    const s = await setup();
    const path = join(s.directory, "state.json");
    const content = JSON.stringify({ version: 1, environmentId: "host-a", tunnels: [] });
    await writeFile(path, content);
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    await expect(s.service.status()).rejects.toThrow("storage-unavailable");
    expect(await readFile(path, "utf8")).toBe(content);
    expect((await readdir(s.directory)).some((name) => name.includes(".corrupt-"))).toBe(false);
    // The read was transient: the next call retries initialization and loads the intact state.
    const retried = await s.service.status();
    expect(retried.tunnels).toEqual([]);
    expect(retried).not.toHaveProperty("repair");
    expect(s.launch).not.toHaveBeenCalled();
  });
  it("does not launch or retry a tunnel when its starting state write has uncertain publication", async () => {
    const s = await setup();
    const error = Object.assign(new Error("directory sync failed"), { published: true });
    const write = vi.spyOn(atomicWrite, "writeFileAtomic").mockRejectedValueOnce(error);
    try {
      const result = await s.service.start(dev);
      expect(result).toMatchObject({ state: "error", issue: "storage-unavailable" });
      expect(s.launch).not.toHaveBeenCalled();
      expect((await s.service.status()).tunnels).toHaveLength(1);
    } finally {
      write.mockRestore();
    }
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

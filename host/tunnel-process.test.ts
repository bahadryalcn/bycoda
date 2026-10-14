import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { createServer } from "node:net";
import { startProviderProcess, startTunnelGuardian, runTunnelWorker } from "./tunnel-process";
import {
  tunnelCommand,
  tunnelEnvironment,
  tunnelOutput,
  probeTunnelOrigin,
  type TunnelEvent,
} from "./tunnel-providers";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.mocked(spawn).mockClear();
  for (const work of cleanup.splice(0).reverse()) await work();
});

describe("tunnel provider adapters", () => {
  it("checks only the selected host's local listener without public requests", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    expect(await probeTunnelOrigin(`http://127.0.0.1:${port}`)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await probeTunnelOrigin(`http://127.0.0.1:${port}`)).toBe(false);
  });
  it("isolates provider credentials and passes authtokens through environment only", () => {
    const command = tunnelCommand(
      "ngrok",
      "/bin/ngrok",
      "http://127.0.0.1:3000",
      "/private/ngrok.yml",
      "synthetic-token",
    );
    expect(command.args.join(" ")).not.toContain("synthetic-token");
    vi.stubEnv("TUNNEL_TOKEN", "unrelated-cloudflare-token");
    vi.stubEnv("NGROK_AUTHTOKEN", "unrelated-ngrok-token");
    expect(tunnelEnvironment(command)).toMatchObject({ NGROK_AUTHTOKEN: "synthetic-token" });
    expect(tunnelEnvironment(command).TUNNEL_TOKEN).toBeUndefined();
    expect(
      tunnelEnvironment(
        tunnelCommand("cloudflare", "/bin/cloudflared", "http://127.0.0.1:3000", "/private/cf.yml"),
      ).NGROK_AUTHTOKEN,
    ).toBeUndefined();
    vi.unstubAllEnvs();
  });
  it("handles fragmented stdout/stderr and waits for Cloudflare registration", () => {
    const events: TunnelEvent[] = [];
    const parser = tunnelOutput("cloudflare", (event) => events.push(event));
    const stdout = parser.stream(),
      stderr = parser.stream();
    stderr.write(Buffer.from("INF https://host-a.trycloud"));
    stderr.write(Buffer.from("flare.com\n"));
    expect(events).toEqual([]);
    stdout.write(Buffer.from("INF Registered tunnel con"));
    stdout.write(Buffer.from("nection connIndex=0\n"));
    expect(events).toEqual([{ type: "ready", publicUrl: "https://host-a.trycloudflare.com" }]);
    stderr.write(Buffer.from("INF Registered tunnel connection\n"));
    expect(events).toHaveLength(1);
  });
  it("does not treat diagnostic links, forged provider suffixes or large output as a ready URL", () => {
    const emit = vi.fn();
    const parser = tunnelOutput("cloudflare", emit),
      stream = parser.stream();
    stream.write(Buffer.from("x".repeat(32_000) + "https://bad.trycloudflare.com\n"));
    stream.write(
      Buffer.from(
        "https://a.trycloudflare.com.evil.example/?token=private\nRegistered tunnel connection\n",
      ),
    );
    expect(emit).not.toHaveBeenCalled();
    stream.write(Buffer.from("https://real.trycloudflare.com\n"));
    expect(emit).toHaveBeenCalledWith({
      type: "ready",
      publicUrl: "https://real.trycloudflare.com",
    });
    const ngrok = tunnelOutput("ngrok", emit).stream();
    ngrok.write(Buffer.from('{"msg":"diagnostic","url":"https://other.ngrok.app"}\n'));
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("classifies auth and connection failures without returning CLI output", () => {
    for (const [text, issue] of [
      ["ERR_NGROK_4018 private-secret", "credential-missing"],
      ["failed to request quick tunnel private-secret", "connection-failed"],
    ]) {
      const events: TunnelEvent[] = [];
      const parser = tunnelOutput("ngrok", (event) => events.push(event));
      const stream = parser.stream();
      stream.write(Buffer.from(text));
      stream.end();
      expect(events).toEqual([{ type: "error", issue }]);
      expect(JSON.stringify(events)).not.toContain("private-secret");
    }
  });

  it("uses hidden shell-free children, reports missing CLI and kills only the returned handle on timeout", async () => {
    vi.useFakeTimers();
    const fake = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => {
        queueMicrotask(() => fake.emit("close", 0));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValueOnce(fake as unknown as ChildProcess);
    const events: TunnelEvent[] = [];
    startProviderProcess(
      tunnelCommand("cloudflare", "/fake/cloudflared", "http://127.0.0.1:3000", "/fake/config"),
      (event) => events.push(event),
    );
    expect(spawn).toHaveBeenLastCalledWith(
      "/fake/cloudflared",
      expect.any(Array),
      expect.objectContaining({ windowsHide: true, shell: false, detached: false }),
    );
    await vi.advanceTimersByTimeAsync(45_000);
    expect(events).toContainEqual({ type: "error", issue: "startup-timeout" });
    expect(fake.kill).toHaveBeenCalledTimes(1);
    const failed = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    vi.mocked(spawn).mockReturnValueOnce(failed as unknown as ChildProcess);
    startProviderProcess(
      tunnelCommand("ngrok", "/missing/ngrok", "http://127.0.0.1:3000", "/fake/config", "private"),
      (event) => events.push(event),
    );
    failed.emit("error", Object.assign(new Error("private-command-output"), { code: "ENOENT" }));
    failed.emit("close", -1);
    expect(events).toContainEqual({ type: "error", issue: "cli-missing" });
    expect(JSON.stringify(events)).not.toContain("private-command-output");
  });

  it("opens private guardian IPC without a token in argv and waits for its closure", async () => {
    const fake = Object.assign(new EventEmitter(), {
      connected: true,
      send: vi.fn((_message, callback) => callback?.(null)),
    });
    vi.mocked(spawn).mockReturnValueOnce(fake as unknown as ChildProcess);
    const processHandle = startTunnelGuardian(
      tunnelCommand(
        "ngrok",
        "/fake/ngrok",
        "http://127.0.0.1:3000",
        "/fake/config",
        "synthetic-token",
      ),
      () => {},
    );
    fake.emit("spawn");
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]?.join(" ")).not.toContain("synthetic-token");
    expect(spawn).toHaveBeenLastCalledWith(
      process.execPath,
      [process.argv[1], "tunnel-worker"],
      expect.objectContaining({ windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] }),
    );
    expect(fake.send).toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.objectContaining({ token: "synthetic-token" }) }),
      expect.any(Function),
    );
    const stopping = processHandle.stop();
    expect(fake.send).toHaveBeenLastCalledWith({ type: "stop" }, expect.any(Function));
    fake.emit("exit", 0);
    await stopping;
  });

  it("stops its provider handle after host IPC disconnect", async () => {
    const parent = Object.assign(new EventEmitter(), { send: vi.fn(), exit: vi.fn() });
    const stop = vi.fn(async () => {});
    runTunnelWorker(parent as unknown as NodeJS.Process, () => ({ stop }));
    parent.emit("message", {
      type: "start",
      command: tunnelCommand("cloudflare", "fake", "http://127.0.0.1:3000", "fake"),
    });
    parent.emit("disconnect");
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(parent.exit).toHaveBeenCalledWith(0);
  });
});

describe("simulated provider process integration (no external tunnel)", () => {
  it("parses a real stand-in Node child and detects its unexpected exit", async () => {
    const events: TunnelEvent[] = [];
    const child = startProviderProcess(
      {
        provider: "ngrok",
        program: process.execPath,
        args: [
          "-e",
          'console.log(JSON.stringify({msg:"started tunnel",url:"https://stand-in.ngrok.app"}));console.error("diagnostic private-secret");setTimeout(()=>process.exit(0),100);',
        ],
      },
      (event) => events.push(event),
    );
    cleanup.push(() => child.stop());
    await vi.waitFor(() => expect(events).toContainEqual({ type: "exit" }), { timeout: 4000 });
    expect(events).toContainEqual({ type: "ready", publicUrl: "https://stand-in.ngrok.app" });
    expect(events).toContainEqual({ type: "error", issue: "unexpected-exit" });
    expect(JSON.stringify(events)).not.toContain("private-secret");
  });

  it("terminates the real guardian's stand-in child on disconnect, preserving an unrelated process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-tunnel-worker-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const entry = buildSync({
      stdin: {
        contents: 'import {runTunnelWorker} from "./host/tunnel-process";runTunnelWorker();',
        resolveDir: resolve("."),
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      target: "node24",
    });
    const file = join(directory, "worker.mjs"),
      marker = join(directory, "stand-in.pid");
    await writeFile(file, entry.outputFiles[0].text);
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    cleanup.push(async () => {
      const done = once(unrelated, "close");
      unrelated.kill();
      await done;
    });
    const worker = spawn(process.execPath, [file], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    cleanup.push(async () => {
      if (worker.connected) worker.disconnect();
      if (worker.exitCode === null && worker.signalCode === null) await once(worker, "exit");
    });
    const events: TunnelEvent[] = [];
    worker.on("message", (event) => events.push(event as TunnelEvent));
    worker.send({
      type: "start",
      command: {
        provider: "cloudflare",
        program: process.execPath,
        args: [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));console.log('https://stand-in.trycloudflare.com');console.log('Registered tunnel connection');setInterval(()=>{},1000);`,
        ],
      },
    });
    await vi.waitFor(
      () =>
        expect(events).toContainEqual({
          type: "ready",
          publicUrl: "https://stand-in.trycloudflare.com",
        }),
      { timeout: 5000 },
    );
    const pid = Number(await readFile(marker, "utf8"));
    const done = once(worker, "exit");
    worker.disconnect();
    await done;
    expect(() => process.kill(pid, 0)).toThrow();
    expect(unrelated.kill(0)).toBe(true);
  });
});

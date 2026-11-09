import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { runCommand } from "./local-command";

export const IDLE_STOP_MS = 10 * 60_000;
const IDLE_CHECK_MS = 30_000;
const HEALTH_INTERVAL_MS = 500;
const HEALTH_ATTEMPTS = 120;
const CONTEXT_TOKENS = 8192;
const LOOPBACK = "127.0.0.1";

type Running = { child: ChildProcess; port: number; lastUsed: number; alive: boolean };

export type LocalRuntimeOptions = {
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
  now?: () => number;
  idleMs?: number;
  allocatePort?: () => Promise<number>;
};

/** Asks the OS for a free loopback port, then releases it. A later bind race is reported as a start failure. */
export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("No loopback port was available."));
      });
    });
  });
}

/**
 * Starts local llama.cpp-style servers on 127.0.0.1 and stops them after 10 idle minutes or on
 * request. Each source has at most one process. Process output is not read or stored.
 */
export class LocalRuntime {
  private readonly running = new Map<string, Running>();
  private readonly starting = new Map<string, Promise<{ port: number }>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly spawnImpl: typeof spawn;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly allocatePort: () => Promise<number>;

  constructor(options: LocalRuntimeOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.fetchImpl =
      options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.idleMs = options.idleMs ?? IDLE_STOP_MS;
    this.allocatePort = options.allocatePort ?? allocateLoopbackPort;
  }

  /** Concurrent starts for one source share the same launch, so at most one process is spawned. */
  start(request: {
    sourceId: string;
    executable: string;
    modelPath: string;
  }): Promise<{ port: number }> {
    const pending = this.starting.get(request.sourceId);
    if (pending) return pending;
    const launch = this.launch(request).finally(() => this.starting.delete(request.sourceId));
    this.starting.set(request.sourceId, launch);
    return launch;
  }

  private async launch(request: {
    sourceId: string;
    executable: string;
    modelPath: string;
  }): Promise<{ port: number }> {
    const current = this.running.get(request.sourceId);
    if (current?.alive) {
      this.touch(request.sourceId);
      return { port: current.port };
    }
    const port = await this.allocatePort();
    const child = this.spawnImpl(
      request.executable,
      [
        "-m",
        request.modelPath,
        "--host",
        LOOPBACK,
        "--port",
        String(port),
        "-c",
        String(CONTEXT_TOKENS),
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const entry: Running = { child, port, lastUsed: this.now(), alive: true };
    const markExited = () => {
      entry.alive = false;
      if (this.running.get(request.sourceId) === entry) this.running.delete(request.sourceId);
    };
    child.once("exit", markExited);
    child.once("error", markExited);
    this.running.set(request.sourceId, entry);
    this.ensureTimer();
    try {
      await this.waitUntilReady(entry);
    } catch {
      await this.stop(request.sourceId);
      throw new Error("The local decision model did not start.");
    }
    return { port };
  }

  touch(sourceId: string): void {
    const entry = this.running.get(sourceId);
    if (entry) entry.lastUsed = this.now();
  }

  endpoint(sourceId: string): string | undefined {
    const entry = this.running.get(sourceId);
    return entry?.alive ? `http://${LOOPBACK}:${entry.port}` : undefined;
  }

  isRunning(sourceId: string): boolean {
    return this.running.get(sourceId)?.alive === true;
  }

  async stop(sourceId: string): Promise<void> {
    const entry = this.running.get(sourceId);
    if (!entry) return;
    this.running.delete(sourceId);
    entry.alive = false;
    if (entry.child.pid !== undefined && process.platform === "win32") {
      await runCommand("taskkill", ["/PID", String(entry.child.pid), "/T", "/F"], {
        timeoutMs: 5_000,
      });
    }
    entry.child.kill();
    if (!this.running.size) this.clearTimer();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((sourceId) => this.stop(sourceId)));
  }

  /** Stops processes idle for longer than the limit. The timer calls this; tests call it directly. */
  async reap(): Promise<void> {
    const now = this.now();
    const idle = [...this.running].filter(([, entry]) => now - entry.lastUsed >= this.idleMs);
    await Promise.all(idle.map(([sourceId]) => this.stop(sourceId)));
  }

  private async waitUntilReady(entry: Running): Promise<void> {
    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
      if (!entry.alive) throw new Error("exited");
      const ready = await this.fetchImpl(`http://${LOOPBACK}:${entry.port}/health`, {
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
    }
    throw new Error("timeout");
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reap().catch(() => undefined);
    }, IDLE_CHECK_MS);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

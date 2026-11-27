import { spawn, type ChildProcess } from "node:child_process";

/** One `tools/call` result as cua-driver returns it. */
export type CuaToolResult = {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
export type CuaSpawn = (binary: string, env: NodeJS.ProcessEnv) => ChildProcess;

const MAX_LINE_BYTES = 24 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const decoder = new TextDecoder("utf-8", { fatal: false });

const defaultSpawn: CuaSpawn = (binary, env) =>
  spawn(binary, ["mcp"], {
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "ignore"],
    env,
  });

/** The driver must not inherit helper overrides and never sends product telemetry for bycoda. */
function driverEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(AGENT_DESKTOP_|CUA_)/i.test(key) &&
        !["RUST_LOG", "DO_NOT_TRACK"].includes(key.toUpperCase()),
    ),
  ) as NodeJS.ProcessEnv;
  env.DO_NOT_TRACK = "1";
  env.CUA_TELEMETRY_ENABLED = "false";
  env.CUA_DRIVER_DISABLE_RUN_SCRIPT = "1";
  return env;
}

/**
 * A long-lived `cua-driver mcp` stdio process. Element tokens live in this process, so a restart
 * bumps `generation` and every earlier token becomes foreign. A cancelled call kills the process:
 * its delivery is unknown and nothing may reuse its state.
 */
export class CuaDriverRestarted extends Error {}

export class CuaDriverClient {
  generation = 0;
  private proc?: ChildProcess;
  private binary?: string;
  private ready?: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  constructor(private readonly spawnChild: CuaSpawn = defaultSpawn) {}

  async call(
    binary: string,
    name: string,
    args: Record<string, unknown>,
    options: { signal: AbortSignal; expectedGeneration?: number },
  ): Promise<CuaToolResult> {
    options.signal.throwIfAborted();
    if (this.binary !== binary) this.close();
    await this.start(binary, options.signal);
    if (options.expectedGeneration !== undefined && options.expectedGeneration !== this.generation)
      throw new CuaDriverRestarted("The desktop helper restarted; take a fresh snapshot.");
    return (await this.request(
      "tools/call",
      { name, arguments: args },
      options.signal,
    )) as CuaToolResult;
  }

  close() {
    const proc = this.proc;
    this.proc = undefined;
    this.ready = undefined;
    this.binary = undefined;
    for (const pending of this.pending.values())
      pending.reject(new Error("cua-driver stopped; delivery is unknown."));
    this.pending.clear();
    if (proc && proc.exitCode === null) proc.kill();
  }

  private start(binary: string, signal: AbortSignal) {
    if (this.ready) return this.ready;
    const proc = this.spawnChild(binary, driverEnv());
    this.proc = proc;
    this.binary = binary;
    this.generation++;
    // A response line (a screenshot can be megabytes) arrives in many small chunks. Keep the
    // unfinished tail as a chunk list, scan only each new chunk for the newline and join once
    // when a line completes, so the cost stays linear in the line size.
    let partial: Buffer[] = [];
    let partialBytes = 0;
    proc.stdout?.on("data", (chunk: Buffer) => {
      let rest = chunk;
      let newline: number;
      while ((newline = rest.indexOf(10)) >= 0) {
        partial.push(rest.subarray(0, newline));
        const line = decoder.decode(partial.length === 1 ? partial[0] : Buffer.concat(partial));
        partial = [];
        partialBytes = 0;
        rest = rest.subarray(newline + 1);
        this.receive(line);
      }
      if (rest.length === 0) return;
      partial.push(rest);
      partialBytes += rest.length;
      if (partialBytes > MAX_LINE_BYTES) {
        partial = [];
        partialBytes = 0;
        if (this.proc === proc) this.close();
      }
    });
    proc.once("error", () => {
      if (this.proc === proc) this.close();
    });
    proc.once("exit", () => {
      if (this.proc === proc) this.close();
    });
    const handshake = AbortSignal.any([signal, AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS)]);
    this.ready = this.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bycoda-desktop-control", version: "1" },
      },
      handshake,
    ).then(() => {
      proc.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
    });
    this.ready.catch(() => {
      if (this.proc === proc) this.close();
    });
    return this.ready;
  }

  private receive(line: string) {
    if (!line.trim()) return;
    let message: { id?: unknown; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error)
      pending.reject(
        new Error(String(message.error.message ?? "cua-driver request failed.").slice(0, 300)),
      );
    else pending.resolve(message.result);
  }

  private request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const proc = this.proc;
    if (!proc?.stdin) return Promise.reject(new Error("cua-driver is not running."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const abort = () => {
        // The driver may already be acting; only a fresh process is trustworthy afterwards.
        if (this.proc === proc) this.close();
        reject(new Error("cua-driver request was cancelled; its delivery is unknown."));
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
      proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
}

import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Transform } from "node:stream";
import { isAbsolute } from "node:path";
import { NativeAuthorityHelperRuntime } from "./helper-client";
import { isHelperAddress, type JsonValue } from "./protocol";

// Opt-in source integration: the freshly compiled Rust LIBTEST executable is not
// an installed desktop binary. Production never accepts/strips a stdout prelude.
const executable = process.env.BYCODA_NATIVE_AUTHORITY_TEST_EXE;
const enabled = process.platform === "win32" && !!executable && isAbsolute(executable);
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

class FixturePrelude extends Transform {
  private buffered = Buffer.alloc(0);
  private ready = false;
  private bytes = 0;
  constructor(private readonly marker: string) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (this.ready) {
      this.push(chunk);
      callback();
      return;
    }
    this.bytes += chunk.length;
    this.buffered = Buffer.concat([this.buffered, chunk]);
    for (;;) {
      const end = this.buffered.indexOf(10);
      if (end < 0) break;
      const line = this.buffered.subarray(0, end).toString("utf8").trim();
      this.buffered = this.buffered.subarray(end + 1);
      if (line === this.marker) {
        this.ready = true;
        this.push(this.buffered);
        this.buffered = Buffer.alloc(0);
        callback();
        return;
      }
    }
    if (this.bytes > 4096) {
      callback(new Error("Native fixture prelude exceeded bound"));
      return;
    }
    callback();
  }
  override _flush(callback: (error?: Error | null) => void) {
    callback(this.ready ? undefined : new Error("Native fixture marker missing"));
  }
}

function stripped(child: ChildProcessWithoutNullStreams, marker: string): Transform {
  const wire = new FixturePrelude(marker);
  // The runtime also observes this error; keep fixture startup errors handled.
  wire.on("error", () => {});
  child.stdout.on("error", (error) => wire.destroy(error));
  child.stdout.pipe(wire);
  return wire;
}
async function nativeServer() {
  const child = spawn(
    executable!,
    [
      "--ignored",
      "--exact",
      "native_authority_helper::tests::windows::node_pipe_server_fixture",
      "--nocapture",
    ],
    {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", reject);
  });
  void exited.catch(() => {});
  child.stderr.resume();
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  const output = stripped(child, "NATIVE_AUTHORITY_SERVER_FIXTURE");
  const address = await new Promise<string>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("Native fixture startup deadline")), 5_000);
    output.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    output.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.length > 1024) {
        clearTimeout(timer);
        reject(new Error("Native fixture descriptor exceeded bound"));
        return;
      }
      const end = text.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      try {
        const value = JSON.parse(text.slice(0, end));
        if (value.version !== 1 || value.kind !== "listening" || !isHelperAddress(value.address))
          throw new Error("Invalid native fixture descriptor");
        resolve(value.address);
      } catch (error) {
        reject(error);
      }
    });
  });
  return { address, exited };
}

describe.skipIf(!enabled)("actual Node/native helper/private pipe source integration", () => {
  for (const [label, value] of [
    [
      "structured UTF8",
      {
        text: "MacBook → Windows → mobil",
        scope: "environment/session",
        nested: [null, true, 1.5],
      },
    ],
    ["fragmented bulk-sized control value", { retained: "ç".repeat(24_000), empty: [] }],
  ] as const) {
    it(`transfers ${label} and owns both native processes through actual close`, async () => {
      const server = await nativeServer();
      const runtime = new NativeAuthorityHelperRuntime({
        executablePath: executable!,
        defaultTimeoutMs: 5_000,
        spawn: (_file, _args, options) => {
          const child = spawn(
            executable!,
            [
              "--ignored",
              "--exact",
              "native_authority_helper::tests::windows::hidden_stdio_helper",
              "--nocapture",
            ],
            options,
          );
          const wire = stripped(child, "NATIVE_AUTHORITY_HELPER_FIXTURE");
          Object.defineProperty(child, "stdout", { value: wire });
          return child;
        },
      });
      cleanups.push(() => runtime.close());
      const client = await runtime.open(server.address);
      await client.send(value as JsonValue);
      expect(await client.receive()).toEqual(value);
      expect(client.observation().qualified).toBe(false);
      await client.close();
      expect((await client.exited).code).toBe(0);
      expect(await server.exited).toBe(0);
    });
  }
});

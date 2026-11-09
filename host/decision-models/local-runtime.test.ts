import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { allocateLoopbackPort, IDLE_STOP_MS, LocalRuntime } from "./local-runtime";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.kill = vi.fn(() => true);
  return child;
}

const healthy = async () => new Response("{}", { status: 200 });

describe("local runtime", () => {
  it("binds the server to 127.0.0.1 and reports a loopback endpoint", async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const runtime = new LocalRuntime({
      spawnImpl,
      fetchImpl: healthy as unknown as typeof fetch,
      allocatePort: async () => 45111,
    });
    await runtime.start({
      sourceId: "src-1",
      executable: "llama-server",
      modelPath: "/models/m.gguf",
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "llama-server",
      expect.arrayContaining(["-m", "/models/m.gguf", "--host", "127.0.0.1", "--port", "45111"]),
      expect.objectContaining({ stdio: "ignore" }),
    );
    expect(runtime.endpoint("src-1")).toBe("http://127.0.0.1:45111");
    expect(runtime.isRunning("src-1")).toBe(true);
    await runtime.stopAll();
  });

  it("stops an idle process after the idle limit and keeps one that was used", async () => {
    let clock = 0;
    const children: ReturnType<typeof fakeChild>[] = [];
    const runtime = new LocalRuntime({
      spawnImpl: vi.fn(() => {
        const child = fakeChild();
        children.push(child);
        return child;
      }) as unknown as typeof spawn,
      fetchImpl: healthy as unknown as typeof fetch,
      allocatePort: async () => 45112,
      now: () => clock,
      idleMs: IDLE_STOP_MS,
    });
    await runtime.start({ sourceId: "idle", executable: "llama-server", modelPath: "/m.gguf" });
    await runtime.start({ sourceId: "used", executable: "llama-server", modelPath: "/m.gguf" });
    clock = IDLE_STOP_MS - 1;
    runtime.touch("used");
    clock = IDLE_STOP_MS + 1;
    await runtime.reap();
    expect(runtime.isRunning("idle")).toBe(false);
    expect(children[0].kill).toHaveBeenCalled();
    expect(runtime.isRunning("used")).toBe(true);
    await runtime.stopAll();
  });

  it("stops a process whose health check never succeeds and reports a generic failure", async () => {
    const child = fakeChild();
    const runtime = new LocalRuntime({
      spawnImpl: vi.fn(() => {
        // The process exits before it becomes healthy, so the wait ends without many retries.
        queueMicrotask(() => child.emit("exit", 1));
        return child;
      }) as unknown as typeof spawn,
      fetchImpl: (async () => {
        throw new TypeError("refused");
      }) as unknown as typeof fetch,
      allocatePort: async () => 45113,
    });
    await expect(
      runtime.start({ sourceId: "bad", executable: "llama-server", modelPath: "/m.gguf" }),
    ).rejects.toThrow("did not start");
    expect(runtime.isRunning("bad")).toBe(false);
  });

  it("spawns one process when two starts for the same source overlap", async () => {
    const spawnImpl = vi.fn(() => fakeChild()) as unknown as typeof spawn;
    const runtime = new LocalRuntime({
      spawnImpl,
      fetchImpl: healthy as unknown as typeof fetch,
      allocatePort: async () => 45114,
    });
    const request = { sourceId: "same", executable: "llama-server", modelPath: "/m.gguf" };
    const [first, second] = await Promise.all([runtime.start(request), runtime.start(request)]);
    expect(first).toEqual(second);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    await runtime.stopAll();
  });

  it("allocates a free loopback port from the operating system", async () => {
    const port = await allocateLoopbackPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});

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
  it("passes a vision projector and model alias as separate arguments", async () => {
    const spawnImpl = vi.fn(() => fakeChild()) as unknown as typeof spawn;
    const runtime = new LocalRuntime({
      spawnImpl,
      fetchImpl: healthy as unknown as typeof fetch,
      allocatePort: async () => 45115,
    });
    await runtime.start({
      sourceId: "vision",
      executable: "llama-server",
      modelPath: "/m.gguf",
      projectorPath: "/mmproj.gguf",
      model: "clef-flash",
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "llama-server",
      expect.arrayContaining(["--mmproj", "/mmproj.gguf", "--alias", "clef-flash"]),
      expect.anything(),
    );
    await runtime.stopAll();
  });
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

  describe("Host shutdown", () => {
    const request = (sourceId: string) => ({
      sourceId,
      executable: "llama-server",
      modelPath: `/${sourceId}.gguf`,
    });

    it("stops every process it started and refuses later starts", async () => {
      const children: ReturnType<typeof fakeChild>[] = [];
      const spawnImpl = vi.fn(() => {
        const child = fakeChild();
        children.push(child);
        return child;
      }) as unknown as typeof spawn;
      const runtime = new LocalRuntime({
        spawnImpl,
        fetchImpl: healthy as unknown as typeof fetch,
        allocatePort: async () => 45120,
      });
      await Promise.all([runtime.start(request("a")), runtime.start(request("b"))]);
      await runtime.close();
      expect(children).toHaveLength(2);
      for (const child of children) expect(child.kill).toHaveBeenCalledTimes(1);
      expect(runtime.isRunning("a")).toBe(false);
      expect(runtime.endpoint("b")).toBeUndefined();
      await expect(runtime.start(request("a"))).rejects.toThrow("closed");
      expect(spawnImpl).toHaveBeenCalledTimes(2);
    });

    it("never spawns for starts that were still allocating a port when it closed", async () => {
      const spawnImpl = vi.fn(() => fakeChild()) as unknown as typeof spawn;
      const releases: ((port: number) => void)[] = [];
      const runtime = new LocalRuntime({
        spawnImpl,
        fetchImpl: healthy as unknown as typeof fetch,
        allocatePort: () => new Promise<number>((resolve) => releases.push(resolve)),
      });
      const starts = ["a", "b", "c"].map((id) =>
        expect(runtime.start(request(id))).rejects.toThrow("closed"),
      );
      const closing = runtime.close();
      releases.forEach((release, index) => release(45130 + index));
      await closing;
      await Promise.all(starts);
      expect(spawnImpl).not.toHaveBeenCalled();
    });

    it("stops a process that is still becoming healthy and fails that start", async () => {
      const child = fakeChild();
      let onSpawn!: () => void;
      const spawned = new Promise<void>((resolve) => {
        onSpawn = resolve;
      });
      const runtime = new LocalRuntime({
        spawnImpl: vi.fn(() => {
          onSpawn();
          return child;
        }) as unknown as typeof spawn,
        fetchImpl: (async () => {
          throw new TypeError("refused");
        }) as unknown as typeof fetch,
        allocatePort: async () => 45121,
      });
      const failure = expect(runtime.start(request("slow"))).rejects.toThrow("did not start");
      await spawned;
      await runtime.close();
      await failure;
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(runtime.isRunning("slow")).toBe(false);
    });

    it("kills each process once when stop, stopAll and close overlap", async () => {
      const child = fakeChild();
      const runtime = new LocalRuntime({
        spawnImpl: vi.fn(() => child) as unknown as typeof spawn,
        fetchImpl: healthy as unknown as typeof fetch,
        allocatePort: async () => 45122,
      });
      await runtime.start(request("a"));
      await Promise.all([runtime.stop("a"), runtime.stopAll(), runtime.close(), runtime.close()]);
      expect(child.kill).toHaveBeenCalledTimes(1);
    });

    it("leaves a model server it did not start alone", async () => {
      const owned = fakeChild();
      const spawnImpl = vi.fn(() => owned) as unknown as typeof spawn;
      const runtime = new LocalRuntime({
        spawnImpl,
        fetchImpl: healthy as unknown as typeof fetch,
        allocatePort: async () => 45123,
      });
      await runtime.start(request("owned"));
      // "external" is a model the owner runs; the runtime has no entry for it and must not look one up.
      await runtime.stop("external");
      await runtime.close();
      expect(owned.kill).toHaveBeenCalledTimes(1);
      expect(spawnImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("allocates a free loopback port from the operating system", async () => {
    const port = await allocateLoopbackPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});

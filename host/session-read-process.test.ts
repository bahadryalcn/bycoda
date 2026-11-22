import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { SessionReadProcesses, type SessionReadRequest } from "./session-read-process";
import { SessionReadError } from "./domains/sessions/read-errors";
const request: SessionReadRequest = {
  kind: "desktop",
  paths: [],
  platform: process.platform,
  method: "snapshot",
  sessionId: "original",
  projectId: "project",
};
afterEach(() => vi.useRealTimers());
function fixture(options: { sendError?: Error } = {}) {
  const children: Array<
    EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
      input?: { id: string };
      send: ReturnType<typeof vi.fn>;
    }
  > = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 42 + children.length,
      kill: vi.fn(() => true),
      ref: vi.fn(),
      unref: vi.fn(),
      send: vi.fn(),
    });
    child.send.mockImplementation((input, callback) => {
      Object.assign(child, { input });
      callback?.(options.sendError ?? null);
      return true;
    });
    children.push(child);
    return child as unknown as ChildProcess;
  });
  return {
    processes: new SessionReadProcesses(
      new URL("./session-read-helper.mjs", import.meta.url),
      spawn as unknown as typeof fork,
    ),
    spawn,
    children,
  };
}
const dispatch = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
it("holds dispatched cancellation until exact original child EXIT and sanitizes helper launch", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = new AbortController();
  const other = f.processes.read(
    { ...request, sessionId: "parallel" },
    new AbortController().signal,
  );
  let settled = false;
  const work = f.processes.read(request, controller.signal).finally(() => {
    settled = true;
  });
  void work.catch(() => undefined);
  await dispatch();
  const [parallel, original] = f.children;
  controller.abort();
  await dispatch();
  expect(original.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  await dispatch();
  expect(original.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(settled).toBe(false);
  const options = f.spawn.mock.calls[0] as unknown as [
    string,
    string[],
    { windowsHide: boolean; execPath: string; env: NodeJS.ProcessEnv },
  ];
  expect(options[2].windowsHide).toBe(true);
  expect(options[2].execPath).toBe(process.execPath);
  expect(options[2].env.NODE_OPTIONS).toBeUndefined();
  original.emit("message", { id: original.input!.id, value: "late" });
  original.emit("close");
  expect(settled).toBe(false);
  original.emit("exit", null, "SIGKILL");
  await expect(work).rejects.toThrow("cancelled");
  const next = f.processes.read(request, new AbortController().signal);
  await dispatch();
  expect(f.spawn).toHaveBeenCalledTimes(3);
  expect(parallel.kill).not.toHaveBeenCalled();
  parallel.emit("message", { id: parallel.input!.id, value: "parallel result" });
  f.children[2].emit("message", { id: f.children[2].input!.id, value: "replacement result" });
  await expect(other).resolves.toBe("parallel result");
  await expect(next).resolves.toBe("replacement result");
});
it("does not kill a coalesced read another original observer still owns", async () => {
  const f = fixture();
  const one = new AbortController(),
    two = new AbortController();
  const first = f.processes.read(request, one.signal);
  const second = f.processes.read(request, two.signal);
  await dispatch();
  one.abort();
  await expect(first).rejects.toThrow("cancelled");
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(f.children[0].kill).not.toHaveBeenCalled();
  f.children[0].emit("message", { id: f.children[0].input!.id, value: "original result" });
  await expect(second).resolves.toBe("original result");
});
it("retains capacity after kill request and rejects forged result identity until EXIT", async () => {
  const f = fixture();
  const controller = new AbortController();
  const work = f.processes.read(request, controller.signal);
  void work.catch(() => undefined);
  await dispatch();
  f.children[0].emit("message", { id: "replacement", value: "wrong" });
  const repeated = f.processes.read(request, new AbortController().signal);
  void repeated.catch(() => undefined);
  await dispatch();
  expect(f.spawn).toHaveBeenCalledTimes(1);
  f.children[0].emit("exit", 0);
  await expect(work).rejects.toThrow("identity changed");
  await expect(repeated).rejects.toThrow("identity changed");
});

it("refuses excess jobs as retryable overload without releasing occupied slots", async () => {
  const f = fixture();
  const pending = Array.from({ length: 8 }, (_, index) =>
    f.processes.read({ ...request, sessionId: String(index) }, new AbortController().signal),
  );
  await dispatch();
  await expect(
    f.processes.read({ ...request, sessionId: "excess" }, new AbortController().signal),
  ).rejects.toMatchObject({ name: "SessionReadError", kind: "overloaded" });
  expect(f.spawn).toHaveBeenCalledTimes(2);
  for (let i = 0; i < pending.length; i++) {
    const child = f.children[i % 2];
    child.emit("message", { id: child.input!.id, value: i });
  }
  expect(await Promise.all(pending)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(f.spawn).toHaveBeenCalledTimes(2);
});

it("bounds coalesced observers without killing the shared read", async () => {
  const f = fixture();
  const pending = Array.from({ length: 128 }, () =>
    f.processes.read(request, new AbortController().signal),
  );
  await dispatch();
  await expect(f.processes.read(request, new AbortController().signal)).rejects.toMatchObject({
    kind: "overloaded",
  });
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(f.children[0].kill).not.toHaveBeenCalled();
  f.children[0].emit("message", { id: f.children[0].input!.id, value: "done" });
  await Promise.all(pending);
});

it("rehydrates allowlisted helper failures with safe text", async () => {
  const f = fixture();
  const pending = f.processes.read(request, new AbortController().signal);
  const rejected = expect(pending).rejects.toEqual(new SessionReadError("snapshot-budget"));
  await dispatch();
  f.children[0].emit("message", {
    id: f.children[0].input!.id,
    error: "private database details",
    errorKind: "snapshot-budget",
  });
  await rejected;
});

it("does not trust unknown helper error kinds", async () => {
  const f = fixture();
  const pending = f.processes.read(request, new AbortController().signal);
  const rejected = expect(pending).rejects.not.toBeInstanceOf(SessionReadError);
  await dispatch();
  f.children[0].emit("message", {
    id: f.children[0].input!.id,
    error: "private error",
    errorKind: "__proto__",
  });
  await rejected;
});

it("reuses one helper for sequential jobs and retires it after one idle minute", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const work = f.processes.read(
      { ...request, sessionId: String(i) },
      new AbortController().signal,
    );
    await dispatch();
    const child = f.children[0];
    ids.add(child.input!.id);
    child.emit("message", { id: child.input!.id, value: i });
    await expect(work).resolves.toBe(i);
  }
  expect(ids.size).toBe(5);
  expect(f.spawn).toHaveBeenCalledTimes(1);
  const child = f.children[0];
  expect(child.unref).toHaveBeenCalled();
  vi.advanceTimersByTime(59_999);
  expect(child.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  child.emit("exit", null, "SIGKILL");
});

it("times out after 30 seconds and waits for helper exit", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const work = f.processes.read(request, new AbortController().signal);
  const rejected = expect(work).rejects.toThrow("cancelled");
  const settled = vi.fn();
  void work.catch(settled);
  await dispatch();
  const child = f.children[0];
  vi.advanceTimersByTime(29_999);
  expect(child.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  await dispatch();
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(settled).not.toHaveBeenCalled();
  child.emit("exit", null, "SIGKILL");
  await rejected;
});

it("rejects the job on helper crash and starts a new helper for the next job", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const work = f.processes.read(request, signal);
  const rejected = expect(work).rejects.toThrow("exited without a confirmed result");
  await dispatch();
  f.children[0].emit("exit", 1);
  await rejected;
  const next = f.processes.read(request, signal);
  await dispatch();
  f.children[1].emit("message", { id: f.children[1].input!.id, value: "recovered" });
  await expect(next).resolves.toBe("recovered");
});

it("retires a helper that cannot confirm DB handle closure before rejecting its job", async () => {
  const f = fixture();
  const work = f.processes.read(request, new AbortController().signal);
  const settled = vi.fn();
  void work.catch(settled);
  const rejected = expect(work).rejects.toThrow("connection close was not confirmed");
  await dispatch();
  const child = f.children[0];
  child.emit("message", { id: child.input!.id, retire: true });
  await dispatch();
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(settled).not.toHaveBeenCalled();
  child.emit("exit", null, "SIGKILL");
  await rejected;
});

it("close waits for busy and idle helpers to exit", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const first = f.processes.read(request, signal);
  const second = f.processes.read({ ...request, sessionId: "busy" }, signal);
  const rejected = expect(second).rejects.toThrow("cancelled");
  await dispatch();
  const [idle, busy] = f.children;
  idle.emit("message", { id: idle.input!.id, value: "first" });
  await expect(first).resolves.toBe("first");
  const closed = vi.fn();
  const close = f.processes.close().then(closed);
  await dispatch();
  expect(busy.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(idle.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  busy.emit("exit", null, "SIGKILL");
  await rejected;
  expect(closed).not.toHaveBeenCalled();
  idle.emit("exit", null, "SIGKILL");
  await close;
});

it("cancels a queued job without sending it or killing a helper", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const first = f.processes.read(request, signal);
  const second = f.processes.read({ ...request, sessionId: "busy" }, signal);
  const controller = new AbortController();
  const queued = f.processes.read({ ...request, sessionId: "queued" }, controller.signal);
  const rejected = expect(queued).rejects.toThrow("cancelled");
  await dispatch();
  controller.abort();
  await rejected;
  expect(f.spawn).toHaveBeenCalledTimes(2);
  for (const child of f.children) {
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("message", { id: child.input!.id, value: "done" });
    expect(child.send).toHaveBeenCalledTimes(1);
  }
  await Promise.all([first, second]);
});

it("keeps the helper when it replies inside the abort grace and discards the result", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = new AbortController();
  const work = f.processes.read(request, controller.signal);
  const rejected = expect(work).rejects.toThrow("cancelled");
  await dispatch();
  const child = f.children[0];
  controller.abort();
  vi.advanceTimersByTime(100);
  child.emit("message", { id: child.input!.id, value: "late" });
  await rejected;
  vi.advanceTimersByTime(1_000);
  expect(child.kill).not.toHaveBeenCalled();
  const next = f.processes.read({ ...request, sessionId: "next" }, new AbortController().signal);
  await dispatch();
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(child.send).toHaveBeenCalledTimes(2);
  child.emit("message", { id: child.input!.id, value: "next result" });
  await expect(next).resolves.toBe("next result");
});

it("starts the 30 second deadline at dispatch, not while queued", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const signal = new AbortController().signal;
  const first = f.processes.read({ ...request, sessionId: "a" }, signal);
  const second = f.processes.read({ ...request, sessionId: "b" }, signal);
  const queued = f.processes.read({ ...request, sessionId: "c" }, signal);
  const rejected = expect(queued).rejects.toThrow("cancelled");
  await dispatch();
  vi.advanceTimersByTime(20_000);
  for (const child of f.children) child.emit("message", { id: child.input!.id, value: "ok" });
  await Promise.all([first, second]);
  await dispatch();
  const helper = f.children.find((child) => child.send.mock.calls.length === 2)!;
  vi.advanceTimersByTime(29_999);
  expect(helper.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  helper.emit("exit", null, "SIGKILL");
  await rejected;
});

it("takes admission when a job is dispatched, not when it is queued", async () => {
  const f = fixture();
  const accept = vi.spyOn(
    (f.processes as unknown as { admission: { accept: () => unknown } }).admission,
    "accept",
  );
  const signal = new AbortController().signal;
  const reads = ["a", "b", "c"].map((sessionId) =>
    f.processes.read({ ...request, sessionId }, signal),
  );
  await dispatch();
  expect(accept).toHaveBeenCalledTimes(2);
  for (const child of f.children) child.emit("message", { id: child.input!.id, value: "ok" });
  await dispatch();
  expect(accept).toHaveBeenCalledTimes(3);
  f.children[0].emit("message", { id: f.children[0].input!.id, value: "ok" });
  f.children[1].emit("message", { id: f.children[1].input!.id, value: "ok" });
  await Promise.all(reads);
});

it("rejects the job when the helper cannot be spawned", async () => {
  const f = fixture();
  const work = f.processes.read(request, new AbortController().signal);
  const rejected = expect(work).rejects.toThrow("spawn failed");
  await dispatch();
  const child = f.children[0];
  Object.assign(child, { pid: undefined });
  child.emit("error", new Error("spawn failed"));
  expect(child.kill).not.toHaveBeenCalled();
  child.emit("close");
  await rejected;
  const next = f.processes.read(request, new AbortController().signal);
  await dispatch();
  expect(f.spawn).toHaveBeenCalledTimes(2);
  f.children[1].emit("message", { id: f.children[1].input!.id, value: "recovered" });
  await expect(next).resolves.toBe("recovered");
});

it("kills the helper and rejects with the error when sending the job fails", async () => {
  const f = fixture({ sendError: new Error("send failed") });
  const work = f.processes.read(request, new AbortController().signal);
  const rejected = expect(work).rejects.toThrow("send failed");
  await dispatch();
  expect(f.children[0].kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  f.children[0].emit("exit", null, "SIGKILL");
  await rejected;
});

it("rejects reads after close instead of starting a helper", async () => {
  const f = fixture();
  await f.processes.close();
  await expect(f.processes.read(request, new AbortController().signal)).rejects.toThrow("closed");
  expect(f.spawn).not.toHaveBeenCalled();
});

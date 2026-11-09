import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";
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
function fixture() {
  const children: Array<
    EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      input?: { id: string };
      send: ReturnType<typeof vi.fn>;
    }
  > = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 42 + children.length,
      kill: vi.fn(() => true),
      send: vi.fn(),
    });
    child.send.mockImplementation((input, callback) => {
      Object.assign(child, { input });
      callback?.(null);
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
  const f = fixture();
  const controller = new AbortController();
  let settled = false;
  const work = f.processes.read(request, controller.signal).finally(() => {
    settled = true;
  });
  void work.catch(() => undefined);
  await dispatch();
  const original = f.children[0];
  controller.abort();
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
  expect(settled).toBe(false);
  original.emit("exit", null, "SIGKILL");
  await expect(work).rejects.toThrow("cancelled");
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
  f.children[0].emit("exit", 0);
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
  expect(f.spawn).toHaveBeenCalledTimes(8);
  for (const child of f.children) {
    child.emit("message", { id: child.input!.id, value: "done" });
    child.emit("exit", 0);
  }
  await Promise.all(pending);
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
  f.children[0].emit("exit", 0);
  await Promise.all(pending);
});

it("rehydrates allowlisted helper failures with safe text after original child exit", async () => {
  const f = fixture();
  const pending = f.processes.read(request, new AbortController().signal);
  const rejected = expect(pending).rejects.toEqual(new SessionReadError("snapshot-budget"));
  await dispatch();
  f.children[0].emit("message", {
    id: f.children[0].input!.id,
    error: "private database details",
    errorKind: "snapshot-budget",
  });
  f.children[0].emit("exit", 1);
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
  f.children[0].emit("exit", 1);
  await rejected;
});

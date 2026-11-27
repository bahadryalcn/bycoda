import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TREE_KILL_DEADLINE_MS,
  hubChildLeadsGroup,
  killProcessTree,
  reapProcessGroup,
  type TreePorts,
} from "./process-tree";

type Fake = EventEmitter & { kill: ReturnType<typeof vi.fn> };

function fakeProc(pid: number | undefined, exited = false): ChildProcess & Fake {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: exited ? 0 : null,
    signalCode: null,
    kill: vi.fn(),
  }) as unknown as ChildProcess & Fake;
}

function ports(platform: NodeJS.Platform) {
  const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const spawnMock = vi.fn(() => killer);
  const killGroup = vi.fn();
  return {
    killer,
    spawnMock,
    killGroup,
    ports: { platform, spawn: spawnMock as unknown as typeof spawn, killGroup } as TreePorts,
  };
}

afterEach(() => vi.useRealTimers());

describe("hub child process trees", () => {
  it("leads a process group only off Windows", () => {
    expect(hubChildLeadsGroup("win32")).toBe(false);
    expect(hubChildLeadsGroup("linux")).toBe(true);
    expect(hubChildLeadsGroup("darwin")).toBe(true);
  });

  it("kills the owned tree with taskkill /T /F on Windows and never signals a group", () => {
    const { ports: p, spawnMock, killGroup, killer } = ports("win32");
    const proc = fakeProc(4321);
    killProcessTree(proc, p);
    expect(spawnMock).toHaveBeenCalledWith("taskkill.exe", ["/pid", "4321", "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.emit("close", 0);
    expect(killGroup).not.toHaveBeenCalled();
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("falls back to the direct child when taskkill fails or cannot start", () => {
    const failed = ports("win32");
    const a = fakeProc(1);
    killProcessTree(a, failed.ports);
    failed.killer.emit("close", 1);
    expect(a.kill).toHaveBeenCalledTimes(1);

    const missing = ports("win32");
    const b = fakeProc(2);
    killProcessTree(b, missing.ports);
    missing.killer.emit("error", new Error("ENOENT"));
    expect(b.kill).toHaveBeenCalledTimes(1);

    const gone = ports("win32");
    const c = fakeProc(3, true);
    killProcessTree(c, gone.ports);
    gone.killer.emit("close", 128);
    expect(c.kill).not.toHaveBeenCalled();
  });

  it("bounds a taskkill that never finishes", () => {
    vi.useFakeTimers();
    const { ports: p, killer } = ports("win32");
    const proc = fakeProc(7);
    killProcessTree(proc, p);
    vi.advanceTimersByTime(TREE_KILL_DEADLINE_MS);
    expect(killer.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledTimes(1);
  });

  it("signals the child's own process group on POSIX, falling back to the child", () => {
    const { ports: p, killGroup, spawnMock } = ports("linux");
    const proc = fakeProc(555);
    killProcessTree(proc, p);
    expect(killGroup).toHaveBeenCalledWith(555);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(proc.kill).not.toHaveBeenCalled();

    killGroup.mockImplementationOnce(() => {
      throw new Error("EPERM");
    });
    const other = fakeProc(556);
    killProcessTree(other, p);
    expect(other.kill).toHaveBeenCalledTimes(1);
  });

  it("kills only the direct child when it has no pid", () => {
    const { ports: p, killGroup, spawnMock } = ports("linux");
    const proc = fakeProc(undefined);
    killProcessTree(proc, p);
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(killGroup).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("reaps leftover group members after the launcher exits, on POSIX only", () => {
    const posix = ports("linux");
    reapProcessGroup(fakeProc(900), posix.ports);
    expect(posix.killGroup).toHaveBeenCalledWith(900);

    posix.killGroup.mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    expect(() => reapProcessGroup(fakeProc(901), posix.ports)).not.toThrow();

    const windows = ports("win32");
    reapProcessGroup(fakeProc(902), windows.ports);
    expect(windows.killGroup).not.toHaveBeenCalled();
    expect(windows.spawnMock).not.toHaveBeenCalled();

    reapProcessGroup(fakeProc(undefined), posix.ports);
    expect(posix.killGroup).toHaveBeenCalledTimes(2);
  });
});

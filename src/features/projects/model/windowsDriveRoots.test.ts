import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_ROOT_TIMEOUT_MS, probeWindowsDriveRoots } from "./windowsDriveRoots";

const fs = vi.hoisted(() => ({
  listWindowsDrives: vi.fn(),
  statFiles: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => fs);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("probeWindowsDriveRoots", () => {
  it("stats only the drives the OS reports, never every letter", async () => {
    fs.listWindowsDrives.mockResolvedValue(["C:/", "D:/"]);
    fs.statFiles.mockImplementation(async ([path]: string[]) => [
      { path, mtimeMs: null, isDir: true },
    ]);

    const onRoots = vi.fn();
    await probeWindowsDriveRoots(() => true, onRoots);

    expect(fs.statFiles.mock.calls.map(([paths]) => paths)).toEqual([["C:/"], ["D:/"]]);
    expect(onRoots).toHaveBeenLastCalledWith(["C:/", "D:/"]);
  });

  it("keeps a responsive drive visible while a hung drive is dropped at its deadline", async () => {
    fs.listWindowsDrives.mockResolvedValue(["C:/", "Z:/"]);
    fs.statFiles.mockImplementation(([path]: string[]) =>
      path === "C:/"
        ? Promise.resolve([{ path, mtimeMs: null, isDir: true }])
        : new Promise<never>(() => {}),
    );

    const onRoots = vi.fn();
    const probe = probeWindowsDriveRoots(() => true, onRoots);

    await vi.advanceTimersByTimeAsync(0);
    expect(onRoots).toHaveBeenLastCalledWith(["C:/"]);

    await vi.advanceTimersByTimeAsync(DRIVE_ROOT_TIMEOUT_MS);
    await probe;
    expect(onRoots).toHaveBeenCalledTimes(1);
    expect(onRoots).toHaveBeenLastCalledWith(["C:/"]);
  });

  it("omits roots that are not directories and reports nothing after unmount", async () => {
    fs.listWindowsDrives.mockResolvedValue(["C:/", "E:/"]);
    fs.statFiles.mockImplementation(async ([path]: string[]) => [
      { path, mtimeMs: 1, isDir: path === "E:/" ? false : true },
    ]);

    const onRoots = vi.fn();
    let mounted = true;
    await probeWindowsDriveRoots(() => mounted, onRoots);
    expect(onRoots).toHaveBeenLastCalledWith(["C:/"]);

    mounted = false;
    onRoots.mockClear();
    fs.statFiles.mockResolvedValue([{ path: "D:/", mtimeMs: null, isDir: true }]);
    fs.listWindowsDrives.mockResolvedValue(["D:/"]);
    await probeWindowsDriveRoots(() => mounted, onRoots);
    expect(onRoots).not.toHaveBeenCalled();
  });

  it("rejects when the OS drive enumeration itself fails", async () => {
    fs.listWindowsDrives.mockRejectedValue(new Error("enumeration failed"));

    await expect(probeWindowsDriveRoots(() => true, vi.fn())).rejects.toThrow(
      "enumeration failed",
    );
    expect(fs.statFiles).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const statFiles = vi.hoisted(() => vi.fn());

vi.mock("../../../platform/tauri/fs", () => ({ statFiles, statFilesSettled: statFiles }));

import { invalidateWatchedFiles, nudgeWatchedFiles, watchFile } from "./fileWatch";

describe("file watch", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    while (stops.length > 0) stops.pop()?.();
    statFiles.mockReset();
  });

  it("reconciles the file after establishing its initial mtime baseline", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();

    stops.push(watchFile("/repo/README.md", changed));

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("does not notify again while the sampled mtime is unchanged", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    nudgeWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(2));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("notifies when a later sample observes a different mtime", async () => {
    statFiles
      .mockResolvedValueOnce([{ path: "/repo/README.md", mtimeMs: 2 }])
      .mockResolvedValueOnce([{ path: "/repo/README.md", mtimeMs: 3 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    nudgeWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  });

  it("keeps local results and does not read an unreachable machine as a deletion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const remote = "remote://box/repo/a.ts";
    let localMtime = 2;
    let online = false;
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) =>
        path !== remote
          ? { path, mtimeMs: localMtime }
          : online
            ? { path, mtimeMs: 7 }
            : { path, unavailable: new Error("offline") },
      ),
    );
    const localChanged = vi.fn();
    const remoteChanged = vi.fn();
    stops.push(watchFile("/repo/a.ts", localChanged));
    stops.push(watchFile(remote, remoteChanged));
    await vi.waitFor(() => expect(localChanged).toHaveBeenCalledOnce());
    expect(remoteChanged).not.toHaveBeenCalled();

    localMtime = 3;
    nudgeWatchedFiles();
    await vi.waitFor(() => expect(localChanged).toHaveBeenCalledTimes(2));
    expect(remoteChanged).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();

    online = true;
    nudgeWatchedFiles();
    await vi.waitFor(() => expect(remoteChanged).toHaveBeenCalledOnce());
    warn.mockRestore();
  });

  it("does not duplicate an invalidation while resetting its baseline", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    invalidateWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(2));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

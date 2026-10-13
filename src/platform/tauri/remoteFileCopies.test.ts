// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  openPathWithDefaultApp,
  openLiveRemoteFolder,
  prepareLocalFile,
  prepareLocalFileCopy,
  setRemoteCommandRunner,
} from "./fs";
import { saveExplorerMapping } from "../../shared/lib/remoteExplorerPaths";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const machines = vi.hoisted(() => ({ remoteMachineFor: vi.fn() }));
vi.mock("../../features/connections/model/connections", () => machines);
const remote = vi.fn();
const path = "remote://mac/Users/dev/report.pdf";

beforeEach(() => {
  localStorage.clear();
  remote.mockReset();
  machines.remoteMachineFor.mockReset();
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "cached_remote_file_copy") return null;
      if (command === "begin_remote_file_copy") return "transfer";
      if (command === "finish_remote_file_copy") return "C:/cache/report.pdf";
      if (command === "prepare_local_file") return "C:/work/report.pdf";
      return undefined;
    });
  setRemoteCommandRunner(remote);
});

it("authorizes local asset access and opens an explicitly mapped original on this computer", async () => {
  await prepareLocalFile("C:/work/report.pdf", { maxBytes: 1024 });
  expect(invoke).toHaveBeenCalledWith("prepare_local_file", {
    path: "C:/work/report.pdf",
    maxBytes: 1024,
  });
  saveExplorerMapping("remote://mac/Users/dev", "//MacBook/dev");
  await openPathWithDefaultApp(path);
  expect(invoke).toHaveBeenCalledWith("open_path_with_default_app", {
    path: "//MacBook/dev/report.pdf",
  });
  expect(remote).not.toHaveBeenCalled();
});

it("streams a versioned snapshot and publishes it only after the final version check", async () => {
  remote.mockImplementation(async (command) =>
    command === "read_file_info"
      ? { size: 3, version: "v1" }
      : { data: "YWJj", offset: 0, length: 3 },
  );
  const progress = vi.fn();
  expect(await prepareLocalFileCopy(path, { onProgress: progress })).toBe("C:/cache/report.pdf");
  expect(remote).toHaveBeenCalledWith("read_file_chunk", {
    path,
    version: "v1",
    offset: 0,
    length: 3,
  });
  expect(invoke).toHaveBeenCalledWith("append_remote_file_copy", {
    id: "transfer",
    offset: 0,
    data: "YWJj",
  });
  expect(progress).toHaveBeenLastCalledWith(3, 3);
  expect(remote.mock.calls.filter(([command]) => command === "read_file_info")).toHaveLength(2);
  expect(invoke).not.toHaveBeenCalledWith("cancel_remote_file_copy", expect.anything());
});

it("cancels and removes a partial copy when the remote file changes", async () => {
  remote
    .mockResolvedValueOnce({ size: 3, version: "v1" })
    .mockResolvedValueOnce({ data: "YWJj", offset: 0, length: 3 })
    .mockResolvedValueOnce({ size: 3, version: "v2" });
  await expect(prepareLocalFileCopy(path)).rejects.toThrow("changed while downloading");
  expect(invoke).toHaveBeenCalledWith("cancel_remote_file_copy", { id: "transfer" });
  expect(invoke).not.toHaveBeenCalledWith("finish_remote_file_copy", expect.anything());
});

it("rejects malformed chunks and honors cancellation without opening a file", async () => {
  remote
    .mockResolvedValueOnce({ size: 3, version: "v1" })
    .mockResolvedValueOnce({ data: "YWJj", offset: 1, length: 3 });
  await expect(prepareLocalFileCopy(path)).rejects.toThrow("invalid file chunk");
  const controller = new AbortController();
  controller.abort();
  await expect(prepareLocalFileCopy(path, { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(invoke).not.toHaveBeenCalledWith("finish_remote_file_copy", expect.anything());
});

it("checks document limits before downloading and reuses an unchanged native cache entry", async () => {
  remote.mockResolvedValue({ size: 3, version: "v1" });
  await expect(prepareLocalFileCopy(path, { maxBytes: 2 })).rejects.toThrow("too large to preview");
  expect(invoke).not.toHaveBeenCalled();
  vi.mocked(invoke).mockResolvedValueOnce("C:/cache/report.pdf");
  expect(await prepareLocalFileCopy(path)).toBe("C:/cache/report.pdf");
  expect(invoke).toHaveBeenCalledOnce();
});

it("opens live folders on the exact recorded owning machine without storing a share mapping", async () => {
  machines.remoteMachineFor.mockResolvedValue({ id: "paired-mac", environmentId: "mac" });
  await openLiveRemoteFolder("remote://mac/Users/dev/assets");
  expect(machines.remoteMachineFor).toHaveBeenCalledWith("mac");
  expect(invoke).toHaveBeenCalledWith("remote_open_live_folder", {
    machineId: "paired-mac",
    environmentId: "mac",
    path: "/Users/dev/assets",
  });
  expect(localStorage.getItem("bycoda.remote-explorer-paths.v1")).toBeNull();
  expect(remote).not.toHaveBeenCalled();
});

it("never opens a local fallback when a live folder's machine is unavailable", async () => {
  machines.remoteMachineFor.mockResolvedValue(undefined);
  await expect(openLiveRemoteFolder("remote://linux/home/dev")).rejects.toThrow("not connected");
  await expect(openLiveRemoteFolder("C:/local")).rejects.toThrow("connected computer");
  expect(invoke).not.toHaveBeenCalled();
});

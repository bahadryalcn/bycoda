import { expect, it, vi } from "vitest";
import { statFiles } from "../../../platform/tauri/fs";
import { existingChatPath } from "./chatPathChecks";
vi.mock("../../../platform/tauri/fs", () => ({ statFiles: vi.fn() }));

it("batches ambiguous references and recognizes only existing files and folders", async () => {
  vi.mocked(statFiles).mockResolvedValueOnce([
    { path: "/repo/src/components", isDir: true, mtimeMs: null },
    { path: "/repo/currentTime/read", isDir: false, mtimeMs: null },
    { path: "/repo/src/app", isDir: false, mtimeMs: 4 },
  ]);
  const results = await Promise.all([
    existingChatPath("/repo/src/components"),
    existingChatPath("/repo/currentTime/read"),
    existingChatPath("/repo/src/app"),
    existingChatPath("/repo/src/components"),
  ]);
  expect(results).toEqual([true, false, true, true]);
  expect(statFiles).toHaveBeenCalledTimes(1);
  expect(statFiles).toHaveBeenCalledWith([
    "/repo/src/components",
    "/repo/currentTime/read",
    "/repo/src/app",
  ]);
});

it("reuses completed results until TTL expires but retries failed owner reads", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.mocked(statFiles).mockResolvedValueOnce([{ path: "/ttl/new", isDir: false, mtimeMs: 1 }]);
  expect(await existingChatPath("/ttl/new")).toBe(true);
  expect(await existingChatPath("/ttl/new")).toBe(true);
  now.mockReturnValue(7000);
  vi.mocked(statFiles).mockResolvedValueOnce([]);
  expect(await existingChatPath("/ttl/new")).toBe(false);
  vi.mocked(statFiles).mockRejectedValueOnce(new Error("offline"));
  expect(await existingChatPath("/ttl/error")).toBe(false);
  vi.mocked(statFiles).mockResolvedValueOnce([{ path: "/ttl/error", isDir: true, mtimeMs: null }]);
  expect(await existingChatPath("/ttl/error")).toBe(true);
  now.mockRestore();
});

// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readProjectImage, setRemoteCommandRunner } from "./fs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const MAX = 20 * 1024 * 1024;
const root = "remote://mac/Users/dev/repo";
const remote = vi.fn();

beforeEach(() => {
  remote.mockReset();
  vi.mocked(invoke).mockReset();
  setRemoteCommandRunner(remote);
});

it("refuses an oversized remote image from its metadata before any bytes are read", async () => {
  remote.mockResolvedValueOnce({ size: MAX + 1, version: "v1" });
  await expect(readProjectImage(root, ".github/hero.png")).rejects.toThrow(
    "Document image exceeds 20 MB",
  );
  expect(remote).toHaveBeenCalledTimes(1);
  expect(remote).toHaveBeenCalledWith(
    "read_file_info",
    expect.objectContaining({
      path: expect.stringMatching(/hero\.png$/),
    }),
  );
  expect(remote).not.toHaveBeenCalledWith("read_binary_file", expect.anything());
});

it("rejects a remote image whose size is unknown instead of reading it unbounded", async () => {
  for (const size of [Number.NaN, -1, 1.5, "3"]) {
    remote.mockReset();
    remote.mockResolvedValueOnce({ size, version: "v1" });
    await expect(readProjectImage(root, "a.png")).rejects.toThrow("size is unknown");
    expect(remote).toHaveBeenCalledTimes(1);
  }
});

it("reads a remote image at exactly the cap and decodes its base64 reply", async () => {
  remote.mockResolvedValueOnce({ size: MAX, version: "v1" }).mockResolvedValueOnce("AQID");
  const bytes = await readProjectImage(root, "a.png");
  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  expect(remote).toHaveBeenNthCalledWith(2, "read_binary_file", expect.anything());
});

it("still enforces the cap on the bytes actually read when the file grew after the stat", async () => {
  remote
    .mockResolvedValueOnce({ size: 3, version: "v1" })
    .mockResolvedValueOnce(new Uint8Array(MAX + 1).buffer);
  await expect(readProjectImage(root, "a.png")).rejects.toThrow("Document image exceeds 20 MB");
});

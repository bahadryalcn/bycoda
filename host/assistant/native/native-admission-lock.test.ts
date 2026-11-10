import { lstat, open, unlink } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireNativeAdmissionLock } from "../../native-admission-lock";

vi.mock("node:fs/promises", () => ({ lstat: vi.fn(), open: vi.fn(), unlink: vi.fn() }));

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const denied = Object.assign(new Error("sharing violation"), { code: "EPERM" });
const close = vi.fn();
const handle = { close } as unknown as Awaited<ReturnType<typeof open>>;
const regularFile = { isFile: () => true } as Awaited<ReturnType<typeof lstat>>;

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  close.mockResolvedValue(undefined);
  vi.mocked(unlink).mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
});

it("waits for a proven Windows sharing violation without removing the other owner's lock", async () => {
  vi.mocked(open).mockRejectedValueOnce(denied).mockResolvedValueOnce(handle);
  vi.mocked(lstat).mockResolvedValue(regularFile);
  const release = await acquireNativeAdmissionLock("registry.json", 500);
  expect(open).toHaveBeenCalledTimes(2);
  expect(lstat).toHaveBeenCalledWith("registry.json.lock");
  expect(unlink).not.toHaveBeenCalled();
  await release();
  await release();
  expect(close).toHaveBeenCalledOnce();
  expect(unlink).toHaveBeenCalledExactlyOnceWith("registry.json.lock");
});

it("keeps the existing acquisition deadline while a Windows lock remains held", async () => {
  vi.mocked(open).mockRejectedValue(denied);
  vi.mocked(lstat).mockResolvedValue(regularFile);
  await expect(acquireNativeAdmissionLock("registry.json", 35)).rejects.toThrow(
    "Native admission registry is busy.",
  );
  expect(open).toHaveBeenCalled();
  expect(unlink).not.toHaveBeenCalled();
});

it.each(["missing", "directory", "unreadable"])(
  "retains the original Windows permission error for an unproven %s lock",
  async (kind) => {
    vi.mocked(open).mockRejectedValue(denied);
    if (kind === "directory")
      vi.mocked(lstat).mockResolvedValue({ isFile: () => false } as typeof regularFile);
    else vi.mocked(lstat).mockRejectedValue(new Error(kind));
    await expect(acquireNativeAdmissionLock("registry.json")).rejects.toBe(denied);
    expect(open).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
  },
);

it("does not reinterpret a non-Windows permission error as contention", async () => {
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  vi.mocked(open).mockRejectedValue(denied);
  await expect(acquireNativeAdmissionLock("registry.json")).rejects.toBe(denied);
  expect(lstat).not.toHaveBeenCalled();
  expect(unlink).not.toHaveBeenCalled();
});

import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import type { HostStore } from "../store";
import { nativeBufferGitStoreFor } from "./native-buffer-git-registry";
import { createNativeBufferPersistence } from "./native-buffer-persistence-factory";
import type { NativeBufferGitPersistence } from "./native-buffer-git-persistence";

const store = () => ({ attachmentDir: "/data/attachments" }) as unknown as HostStore;
const git = (available: boolean) =>
  ({
    available: async () => available,
    gc: async () => ({}),
    read: async () => Buffer.from("git"),
  }) as unknown as NativeBufferGitPersistence;

it("falls back to the SQL store with one warning when git is unavailable", async () => {
  const warn = vi.fn();
  const host = store();
  const persistence = createNativeBufferPersistence(host, { git: git(false), warn });
  await persistence.read("x", 1).catch(() => undefined);
  await persistence.read("y", 1).catch(() => undefined);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/git not found/);
  expect(nativeBufferGitStoreFor(host)).toBeUndefined();
});

it("uses git as primary and registers it for maintenance when available", async () => {
  const host = store();
  const persistence = createNativeBufferPersistence(host, { git: git(true) });
  expect((await persistence.read("x", 1))?.toString()).toBe("git");
  expect(nativeBufferGitStoreFor(host)).toBeDefined();
});

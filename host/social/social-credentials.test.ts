import { afterEach, expect, it, vi } from "vitest";
import * as atomicWrite from "../storage/atomic-write";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv } from "node:crypto";
import { tmpdir } from "node:os";
import { OsSocialCredentials } from "./social-credentials";
const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
it.skipIf(process.platform !== "win32")(
  "Windows DPAPI kasası tokenı şifreler; restart sonrası okur ve anahtar kaybında veriyi korur",
  async () => {
    const path = mkdtempSync(join(tmpdir(), "social-dpapi-"));
    paths.push(path);
    const id = crypto.randomUUID();
    const vault = new OsSocialCredentials(path, id);
    await Promise.all([
      vault.set("one", { accessToken: "synthetic-one-secret" }),
      vault.set("two", { accessToken: "synthetic-two-secret" }),
    ]);
    const encrypted = readFileSync(join(path, "tokens.enc"));
    expect(encrypted.includes(Buffer.from("synthetic"))).toBe(false);
    const reopened = new OsSocialCredentials(path, id);
    expect((await reopened.get("one"))?.accessToken).toBe("synthetic-one-secret");
    await reopened.delete("one");
    expect(await reopened.get("one")).toBeUndefined();
    expect((await reopened.get("two"))?.accessToken).toBe("synthetic-two-secret");
    const before = readFileSync(join(path, "tokens.enc"));
    unlinkSync(join(path, "key.dpapi"));
    await expect(new OsSocialCredentials(path, id).get("two")).rejects.toThrow("key unavailable");
    expect(readFileSync(join(path, "tokens.enc"))).toEqual(before);
  },
);

it("preserves corrupt, foreign and invalid-schema ciphertext through failed mutations", async () => {
  const path = mkdtempSync(join(tmpdir(), "social-vault-test-"));
  paths.push(path);
  const key = Buffer.alloc(32, 7);
  const vault = new OsSocialCredentials(path, "owner");
  Object.defineProperty(vault, "key", { value: async () => key });
  const encrypt = (text: string, owner: string) => {
    const iv = Buffer.alloc(12, 1);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(owner));
    const body = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const target = join(path, "tokens.enc");
  for (const bytes of [
    Buffer.alloc(0),
    encrypt("{}", "foreign"),
    encrypt("[]", "owner"),
    encrypt('{"id":{}}', "owner"),
  ]) {
    writeFileSync(target, bytes);
    await expect(vault.set("new", { accessToken: "secret" })).rejects.toThrow();
    expect(readFileSync(target)).toEqual(bytes);
    await expect(vault.delete("id")).rejects.toThrow();
    expect(readFileSync(target)).toEqual(bytes);
  }
  unlinkSync(target);
  await vault.set("new", { accessToken: "secret" });
  expect(await vault.get("new")).toEqual({ accessToken: "secret" });
});

it("retains prior ciphertext and allows retry after a failed durable write", async () => {
  const path = mkdtempSync(join(tmpdir(), "social-write-test-"));
  paths.push(path);
  const vault = new OsSocialCredentials(path, "owner");
  Object.defineProperty(vault, "key", { value: async () => Buffer.alloc(32, 3) });
  await vault.set("id", { accessToken: "first" });
  const target = join(path, "tokens.enc");
  const before = readFileSync(target);
  const fail = vi
    .spyOn(atomicWrite, "writeFileAtomic")
    .mockRejectedValueOnce(new Error("disk failure"));
  try {
    await expect(vault.set("id", { accessToken: "second" })).rejects.toThrow("disk failure");
    expect(readFileSync(target)).toEqual(before);
    expect(await vault.get("id")).toEqual({ accessToken: "first" });
    await vault.set("id", { accessToken: "second" });
    expect(await vault.get("id")).toEqual({ accessToken: "second" });
  } finally {
    fail.mockRestore();
  }
});

it("bounds OS key load retries to one helper attempt per cooldown window", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const path = mkdtempSync(join(tmpdir(), "social-key-retry-test-"));
    paths.push(path);
    const vault = new OsSocialCredentials(path, "owner");
    const loadKey = vi.fn(async (): Promise<Buffer> => {
      throw new Error("OS credential store unavailable.");
    });
    Object.defineProperty(vault, "loadKey", { value: loadKey });
    await expect(vault.get("id")).rejects.toThrow("OS credential store unavailable.");
    await expect(Promise.all([vault.get("id"), vault.get("id")])).rejects.toThrow(
      "OS credential store unavailable.",
    );
    expect(loadKey).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 30_000);
    await expect(vault.get("id")).rejects.toThrow("OS credential store unavailable.");
    expect(loadKey).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("returns independent credential copies to concurrent readers", async () => {
  const path = mkdtempSync(join(tmpdir(), "social-copy-test-"));
  paths.push(path);
  const vault = new OsSocialCredentials(path, "owner");
  Object.defineProperty(vault, "loadKey", { value: async () => Buffer.alloc(32, 4) });
  await vault.set("id", { accessToken: "first" });
  const [a, b] = await Promise.all([vault.get("id"), vault.get("id")]);
  expect(a).not.toBe(b);
  a!.accessToken = "mutated";
  expect(b?.accessToken).toBe("first");
  expect((await vault.get("id"))?.accessToken).toBe("first");
});

it("never serves a pre-write read to a get that starts after the write", async () => {
  const path = mkdtempSync(join(tmpdir(), "social-stale-read-test-"));
  paths.push(path);
  const vault = new OsSocialCredentials(path, "owner");
  Object.defineProperty(vault, "loadKey", { value: async () => Buffer.alloc(32, 6) });
  await vault.set("id", { accessToken: "first" });
  const pending = vault.get("id");
  await vault.set("id", { accessToken: "second" });
  expect((await vault.get("id"))?.accessToken).toBe("second");
  await pending;
  await vault.delete("id");
  expect(await vault.get("id")).toBeUndefined();
});

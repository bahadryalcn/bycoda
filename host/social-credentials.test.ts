import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
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

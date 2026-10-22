import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createPasswordRecord,
  parsePasswordRecord,
  passwordProblem,
  PBKDF2_ITERATIONS,
  verifyPassword,
  type Kdf,
} from "./passwordRecord";

const fastKdf: Kdf = async (password) => new TextEncoder().encode(password.padEnd(32, "."));

describe("password record", () => {
  it("verifies the right password and rejects others, using real WebCrypto", async () => {
    const record = await createPasswordRecord("hunter22");
    expect(record).toMatchObject({
      v: 1,
      alg: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
    });
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(200_000);
    expect(JSON.stringify(record)).not.toContain("hunter22");
    expect(await verifyPassword("hunter22", record)).toBe(true);
    expect(await verifyPassword("hunter23", record)).toBe(false);
    expect(await verifyPassword("", record)).toBe(false);
  });

  it("uses a fresh 16-byte salt each time", async () => {
    const salts: Uint8Array[] = [];
    const kdf: Kdf = async (_password, salt) => {
      salts.push(salt);
      return new Uint8Array(32).fill(7);
    };
    const a = await createPasswordRecord("same-password", kdf);
    const b = await createPasswordRecord("same-password", kdf);
    expect(salts[0]).toHaveLength(16);
    expect(a.salt).not.toBe(b.salt);
  });

  it("verifies with the iterations stored in the record", async () => {
    const seen: number[] = [];
    const kdf: Kdf = async (password, salt, iterations) => {
      seen.push(iterations);
      return fastKdf(password, salt, iterations);
    };
    const record = {
      ...(await createPasswordRecord("pw-1234", kdf)),
      iterations: 250_000,
    };
    await verifyPassword("pw-1234", record, kdf);
    expect(seen.at(-1)).toBe(250_000);
  });

  it("compares in full and treats different lengths as unequal", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });

  it("rejects malformed or unreasonable stored records", async () => {
    const good = await createPasswordRecord("pw-1234", fastKdf);
    expect(parsePasswordRecord(good)).toEqual(good);
    expect(parsePasswordRecord(null)).toBeNull();
    expect(parsePasswordRecord({ ...good, v: 2 })).toBeNull();
    expect(parsePasswordRecord({ ...good, alg: "MD5" })).toBeNull();
    expect(parsePasswordRecord({ ...good, iterations: 0 })).toBeNull();
    expect(parsePasswordRecord({ ...good, iterations: 1e12 })).toBeNull();
    expect(parsePasswordRecord({ ...good, salt: "***" })).toBeNull();
    expect(parsePasswordRecord({ ...good, hash: "AA==" })).toBeNull();
  });

  it("requires at least four characters", () => {
    expect(passwordProblem("abc")).toBe("short");
    expect(passwordProblem("abcd")).toBeNull();
    expect(passwordProblem("x".repeat(300))).toBe("long");
  });
});

import { describe, expect, it } from "vitest";
import { failureFields } from "./failure-fields";

const SECRET = "/home/owner/private/prompt: sk-synthetic-123";

describe("failureFields", () => {
  it("never includes the error message text", () => {
    const fields = failureFields(new Error(SECRET));
    expect(JSON.stringify(fields)).not.toContain("sk-synthetic-123");
    expect(JSON.stringify(fields)).not.toContain("/home/owner");
  });

  it("gives identical messages the same fingerprint and different messages another", () => {
    const first = failureFields(new Error("tunnel refused"));
    const same = failureFields(new Error("tunnel refused"));
    const other = failureFields(new Error("mobile lan refused"));
    expect(first.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(first.fingerprint).toBe(same.fingerprint);
    expect(first.fingerprint).not.toBe(other.fingerprint);
  });

  it("reports the error name and short system code and syscall", () => {
    const error = Object.assign(new Error("listen EADDRINUSE: 127.0.0.1:4100"), {
      name: "SystemError",
      code: "EADDRINUSE",
      syscall: "listen",
    });
    expect(failureFields(error)).toMatchObject({
      error: "SystemError",
      code: "EADDRINUSE",
      syscall: "listen",
    });
  });

  it("bounds oversized code and syscall values", () => {
    const long = "X".repeat(500);
    const fields = failureFields(Object.assign(new Error("boom"), { code: long, syscall: long }));
    expect(fields.code).toBe("X".repeat(64));
    expect(fields.syscall).toBe("X".repeat(64));
  });

  it("drops non-string, non-number codes instead of logging objects", () => {
    const fields = failureFields(Object.assign(new Error("boom"), { code: { token: SECRET } }));
    expect(fields.code).toBeUndefined();
    expect(JSON.stringify(fields)).not.toContain("sk-synthetic-123");
  });

  it("handles thrown non-Error values without a fingerprint or message", () => {
    expect(failureFields("sk-synthetic-123")).toEqual({
      error: "string",
      code: undefined,
      syscall: undefined,
      fingerprint: undefined,
    });
    expect(failureFields(undefined)).toMatchObject({ error: "undefined", fingerprint: undefined });
  });
});

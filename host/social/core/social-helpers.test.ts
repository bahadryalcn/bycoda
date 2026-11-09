import { describe, expect, it } from "vitest";
import { sanitizeSocialError } from "./social-helpers";

describe("sanitizeSocialError", () => {
  it("masks token-looking values and bearer credentials", () => {
    expect(sanitizeSocialError(new Error("token=abc123 failed"))).toBe("token=[redacted] failed");
    expect(sanitizeSocialError("refused Bearer abcdef")).toBe("refused Bearer [redacted]");
  });

  it("masks long opaque strings", () => {
    expect(sanitizeSocialError(new Error(`key ${"A".repeat(40)}`))).toBe("key [redacted]");
  });

  it("bounds the message length and marks the cut", () => {
    const result = sanitizeSocialError(new Error("word ".repeat(200)));
    expect(result.endsWith("…")).toBe(true);
    expect([...result].length).toBeLessThanOrEqual(300);
  });
});

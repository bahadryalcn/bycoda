import { describe, expect, it } from "vitest";
import { shortSha } from "./shortSha";

describe("shortSha", () => {
  it("abbreviates a full commit id to seven characters for display", () => {
    expect(shortSha("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
  });
});

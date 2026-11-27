import { describe, expect, it } from "vitest";
import { draftFingerprint } from "./draftFingerprint";

describe("draftFingerprint", () => {
  it("matches equal content held in separate strings", () => {
    const first = "A".repeat(1_000_000) + "tail";
    const second = ["A".repeat(1_000_000), "tail"].join("");
    expect(draftFingerprint(first)).toBe(draftFingerprint(second));
  });

  it("separates same-length content that differs in one character", () => {
    const base = "A".repeat(100_000);
    expect(draftFingerprint(base + "B")).not.toBe(draftFingerprint(base + "C"));
    expect(draftFingerprint("ab")).not.toBe(draftFingerprint("ba"));
  });

  it("stays tiny however large the input is", () => {
    expect(draftFingerprint("A".repeat(8_000_000)).length).toBeLessThan(40);
  });

  it("never equals the draft store's stale sentinel", () => {
    expect(draftFingerprint("stale")).not.toBe("stale");
    expect(draftFingerprint("")).toMatch(/^fp:0:/);
  });
});

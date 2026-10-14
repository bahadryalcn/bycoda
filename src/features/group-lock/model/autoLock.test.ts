import { describe, expect, it } from "vitest";
import { autoLockDue, parseAutoLockMinutes } from "./autoLock";

describe("auto-lock rule", () => {
  it("never fires when off", () => {
    expect(autoLockDue(0, 10 * 60 * 60_000, 0)).toBe(false);
  });

  it("fires once the whole interval has passed without input", () => {
    expect(autoLockDue(0, 5 * 60_000 - 1, 5)).toBe(false);
    expect(autoLockDue(0, 5 * 60_000, 5)).toBe(true);
    expect(autoLockDue(60_000, 5 * 60_000, 5)).toBe(false);
  });

  it("only accepts the offered intervals", () => {
    expect(parseAutoLockMinutes(15)).toBe(15);
    expect(parseAutoLockMinutes(7)).toBe(0);
    expect(parseAutoLockMinutes("5")).toBe(0);
  });
});

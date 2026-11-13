import { describe, expect, it, vi } from "vitest";
import { AUTO_LOCK_MINUTES, autoLockDue, autoLockLabel, parseAutoLockMinutes } from "./autoLock";
vi.mock("../../../shared/i18n", () => ({
  formatNumber: (value: number) => String(value),
  t: (key: string, slots?: { p0: string }) => (key === "Off" ? "Kapalı" : `${slots?.p0} dakika`),
}));

describe("auto-lock rule", () => {
  it("translates all labels while retaining every numeric option", () => {
    expect(AUTO_LOCK_MINUTES.map(autoLockLabel)).toEqual([
      "Kapalı",
      "5 dakika",
      "15 dakika",
      "30 dakika",
      "60 dakika",
    ]);
    expect(AUTO_LOCK_MINUTES.map(parseAutoLockMinutes)).toEqual([0, 5, 15, 30, 60]);
  });
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

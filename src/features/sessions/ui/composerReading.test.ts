import { describe, expect, it } from "vitest";
import { composerReadingActive, nextReadingHistory, READING_ENTER_PX } from "./composerReading";

describe("nextReadingHistory", () => {
  it("does not start reading near the end, where compacting would clamp the position", () => {
    expect(
      nextReadingHistory(false, { following: false, distance: READING_ENTER_PX - 1 }),
    ).toBe(false);
  });

  it("starts reading once the reader is clearly away from the end", () => {
    expect(nextReadingHistory(false, { following: false, distance: READING_ENTER_PX })).toBe(true);
  });

  it("stays latched while the compact layout shortens the measured distance", () => {
    // Compacting grows the viewport, so the same position now reads closer to the end.
    expect(nextReadingHistory(true, { following: false, distance: 12 })).toBe(true);
    expect(nextReadingHistory(true, { following: false, distance: 0 })).toBe(true);
  });

  it("clears only when following the end resumes", () => {
    expect(nextReadingHistory(true, { following: true, distance: 900 })).toBe(false);
    expect(nextReadingHistory(false, { following: true, distance: 900 })).toBe(false);
  });
});

describe("composerReadingActive", () => {
  it("compacts only while reading history with focus away from the composer", () => {
    expect(composerReadingActive({ readingHistory: true, engaged: false, blocked: false })).toBe(
      true,
    );
    expect(composerReadingActive({ readingHistory: false, engaged: false, blocked: false })).toBe(
      false,
    );
    expect(composerReadingActive({ readingHistory: true, engaged: true, blocked: false })).toBe(
      false,
    );
  });

  it("keeps the full layout while a question or edit needs it", () => {
    expect(composerReadingActive({ readingHistory: true, engaged: false, blocked: true })).toBe(
      false,
    );
  });
});

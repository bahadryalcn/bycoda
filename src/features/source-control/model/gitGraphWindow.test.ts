import { describe, expect, it } from "vitest";
import { visibleRange } from "./gitGraphWindow";

describe("visibleRange", () => {
  it("renders nothing for an empty list", () => {
    expect(visibleRange(0, 200, 0, 22, 4)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("covers the viewport plus overscan at the top", () => {
    // 220px / 22px = 10 rows in view.
    expect(visibleRange(0, 220, 1000, 22, 5)).toEqual({
      start: 0,
      end: 15,
      padTop: 0,
      padBottom: 985 * 22,
    });
  });

  it("includes partially visible rows and overscan above and below", () => {
    const range = visibleRange(110, 220, 1000, 22, 3);
    // Rows 5..14 intersect [110, 330); a partial row at each edge counts.
    expect(range.start).toBe(2);
    expect(range.end).toBe(18);
    expect(range.padTop).toBe(2 * 22);
    expect(range.padBottom).toBe(982 * 22);
  });

  it("keeps spacers plus rows equal to the full height", () => {
    const range = visibleRange(4321, 333, 777, 22, 6);
    const total = range.padTop + (range.end - range.start) * 22 + range.padBottom;
    expect(total).toBe(777 * 22);
  });

  it("clamps at the end of the list", () => {
    const range = visibleRange(999 * 22, 220, 1000, 22, 5);
    expect(range.end).toBe(1000);
    expect(range.padBottom).toBe(0);
  });

  it("recovers from a scrollTop past the end after the list shrinks", () => {
    const range = visibleRange(50_000, 220, 30, 22, 2);
    expect(range.end).toBe(30);
    expect(range.start).toBeLessThan(30);
  });

  it("treats negative scroll (overscroll bounce) as the top", () => {
    expect(visibleRange(-40, 220, 100, 22, 2).start).toBe(0);
  });

  it("renders everything for a short list", () => {
    const range = visibleRange(0, 400, 5, 22, 5);
    expect([range.start, range.end, range.padTop, range.padBottom]).toEqual([0, 5, 0, 0]);
  });
});

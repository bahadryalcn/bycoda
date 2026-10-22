import { describe, expect, it } from "vitest";
import {
  buildRulerSpans,
  scrollTopToCenter,
  spanAtY,
  trackToContentY,
  viewportBand,
  type RulerMark,
} from "./overviewRuler";

const mark = (kind: RulerMark["kind"], top: number, bottom: number, pos = top): RulerMark => ({
  kind,
  top,
  bottom,
  pos,
});

describe("buildRulerSpans", () => {
  it("scales content pixels onto the track", () => {
    const spans = buildRulerSpans([mark("add", 1_000, 1_200)], 2_000, 200);
    expect(spans).toEqual([{ kind: "add", top: 100, bottom: 120, pos: 1_000 }]);
  });

  it("gives a thin mark a minimum height and keeps it on the track", () => {
    const [first] = buildRulerSpans([mark("del", 100, 100)], 10_000, 100);
    expect(first.bottom - first.top).toBe(3);
    const [last] = buildRulerSpans([mark("del", 10_000, 10_000)], 10_000, 100);
    expect(last).toMatchObject({ top: 97, bottom: 100 });
  });

  it("merges touching marks of one kind and keeps the first position", () => {
    const spans = buildRulerSpans(
      [mark("add", 0, 100, 7), mark("add", 100, 200, 8), mark("add", 210, 300)],
      10_000,
      100,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: "add", top: 0, pos: 7 });
  });

  it("never merges different kinds", () => {
    const spans = buildRulerSpans([mark("add", 0, 100), mark("del", 100, 200)], 10_000, 100);
    expect(spans.map((span) => span.kind)).toEqual(["add", "del"]);
  });

  it("keeps distant marks apart and sorts unsorted input", () => {
    const spans = buildRulerSpans(
      [mark("add", 9_000, 9_100), mark("add", 1_000, 1_100)],
      10_000,
      100,
    );
    expect(spans.map((span) => span.pos)).toEqual([1_000, 9_000]);
  });

  it("copes with thousands of marks and degenerate geometry", () => {
    const many = Array.from({ length: 20_000 }, (_, index) =>
      mark("add", index * 20, index * 20 + 10),
    );
    const merged = buildRulerSpans(many, 400_000, 800);
    expect(merged.length).toBeLessThanOrEqual(800);
    expect(buildRulerSpans(many, 0, 800)).toEqual([]);
    expect(buildRulerSpans(many, 400_000, 0)).toEqual([]);
    expect(buildRulerSpans([], 400_000, 800)).toEqual([]);
  });
});

describe("click mapping", () => {
  it("maps a track position to content and centres it", () => {
    expect(trackToContentY(50, 200, 4_000)).toBe(1_000);
    expect(trackToContentY(-5, 200, 4_000)).toBe(0);
    expect(trackToContentY(999, 200, 4_000)).toBe(4_000);
    expect(scrollTopToCenter(1_000, 4_000, 400)).toBe(800);
    expect(scrollTopToCenter(50, 4_000, 400)).toBe(0);
    expect(scrollTopToCenter(3_990, 4_000, 400)).toBe(3_600);
    expect(scrollTopToCenter(100, 300, 400)).toBe(0);
  });
});

describe("spanAtY", () => {
  const spans = buildRulerSpans(
    [mark("add", 1_000, 1_100, 11), mark("del", 3_000, 3_100, 33)],
    10_000,
    100,
  );

  it("finds the tick under or within a pixel or two of the pointer", () => {
    expect(spanAtY(spans, 10.5)?.pos).toBe(11);
    expect(spanAtY(spans, 12.5)?.pos).toBe(11);
    expect(spanAtY(spans, 31)?.pos).toBe(33);
    expect(spanAtY(spans, 20)).toBeNull();
  });

  it("leaves tall regions to the drag", () => {
    const wide = buildRulerSpans([mark("add", 0, 5_000, 1)], 10_000, 100);
    expect(spanAtY(wide, 20)).toBeNull();
  });
});

describe("viewportBand", () => {
  it("places the band like a scrollbar thumb", () => {
    expect(viewportBand(0, 400, 4_000, 200)).toEqual({ top: 0, height: 20 });
    expect(viewportBand(3_600, 400, 4_000, 200)).toEqual({
      top: 180,
      height: 20,
    });
    expect(viewportBand(1_800, 400, 4_000, 200)?.top).toBe(90);
  });

  it("is absent when everything fits", () => {
    expect(viewportBand(0, 400, 400, 200)).toBeNull();
  });

  it("keeps a tiny band visible", () => {
    expect(viewportBand(0, 400, 400_000, 200)?.height).toBe(6);
  });
});

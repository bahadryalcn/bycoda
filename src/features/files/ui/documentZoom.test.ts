import { describe, expect, it } from "vitest";
import {
  anchoredScroll,
  clampZoom,
  formatZoomPercent,
  isZoomWheel,
  recalledZoom,
  rememberZoom,
  wheelZoomFactor,
} from "./documentZoom";

describe("wheelZoomFactor", () => {
  it("zooms in when scrolling up and out when scrolling down", () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeLessThan(1);
    expect(wheelZoomFactor({ deltaY: 0, deltaMode: 0 })).toBe(1);
  });

  it("is multiplicative: opposite ticks cancel", () => {
    const up = wheelZoomFactor({ deltaY: -60, deltaMode: 0 });
    const down = wheelZoomFactor({ deltaY: 60, deltaMode: 0 });
    expect(up * down).toBeCloseTo(1, 10);
  });

  it("makes one notch a step of roughly 1.2x", () => {
    const notch = wheelZoomFactor({ deltaY: -100, deltaMode: 0 });
    expect(notch).toBeGreaterThan(1.15);
    expect(notch).toBeLessThan(1.3);
  });

  it("treats line-mode deltas as larger than pixel ones", () => {
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeGreaterThan(
      wheelZoomFactor({ deltaY: -3, deltaMode: 0 }),
    );
  });

  it("caps a single huge event", () => {
    expect(wheelZoomFactor({ deltaY: -100000, deltaMode: 0 })).toBe(
      wheelZoomFactor({ deltaY: -240, deltaMode: 0 }),
    );
  });
});

describe("clampZoom", () => {
  it("keeps values inside the limits", () => {
    expect(clampZoom(0.1, 0.5, 3)).toBe(0.5);
    expect(clampZoom(9, 0.5, 3)).toBe(3);
    expect(clampZoom(1.5, 0.5, 3)).toBe(1.5);
  });
});

describe("anchoredScroll", () => {
  it("leaves the scroll alone for a ratio of 1", () => {
    expect(anchoredScroll(240, 100, 1)).toBe(240);
  });

  it("keeps the content point under the pointer fixed", () => {
    const scroll = 240;
    const pointer = 100;
    const ratio = 1.5;
    const next = anchoredScroll(scroll, pointer, ratio);
    // The point at content offset scroll+pointer moves to (scroll+pointer)*ratio.
    expect((scroll + pointer) * ratio - next).toBe(pointer);
  });

  it("zooms about the viewport edge when the pointer is at 0", () => {
    expect(anchoredScroll(200, 0, 2)).toBe(400);
  });
});

describe("isZoomWheel", () => {
  it("accepts Ctrl and Cmd but not a plain wheel", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe("zoom memory and formatting", () => {
  it("remembers a zoom per viewer kind", () => {
    expect(recalledZoom("test-kind")).toBeUndefined();
    rememberZoom("test-kind", 1.5);
    expect(recalledZoom("test-kind")).toBe(1.5);
    expect(recalledZoom("other-kind")).toBeUndefined();
  });

  it("formats a percentage", () => {
    expect(formatZoomPercent(1.256)).toBe("126%");
  });
});

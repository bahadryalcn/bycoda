import { describe, expect, it } from "vitest";
import { placePopover, type AnchorRect } from "./popover";

function anchor(left: number, top: number, width: number, height: number): AnchorRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const menu = { width: 200, height: 150 };
const viewport = { width: 800, height: 600 };

describe("placePopover", () => {
  it("opens below the anchor, aligned to its leading edge", () => {
    expect(placePopover(anchor(100, 100, 80, 20), menu, viewport)).toEqual({
      side: "bottom",
      left: 100,
      top: 126,
      width: 200,
      maxHeight: 466,
    });
  });

  it("flips above when the space below cannot hold it", () => {
    expect(placePopover(anchor(100, 560, 80, 20), menu, viewport)).toEqual({
      side: "top",
      left: 100,
      bottom: 46,
      width: 200,
      maxHeight: 546,
    });
  });

  it("pins a top-side popover by its bottom edge so growth stays put", () => {
    const position = placePopover(anchor(100, 400, 80, 20), menu, viewport, {
      side: "top",
    });
    expect(position.bottom).toBe(206);
    expect(position.top).toBeUndefined();
  });

  it("keeps a menu inside the trailing viewport edge", () => {
    expect(placePopover(anchor(700, 100, 80, 20), menu, viewport).left).toBe(592);
  });

  it("aligns to the anchor's center and trailing edge", () => {
    expect(
      placePopover(anchor(300, 100, 80, 20), menu, viewport, {
        align: "center",
      }).left,
    ).toBe(240);
    expect(placePopover(anchor(400, 100, 80, 20), menu, viewport, { align: "end" }).left).toBe(280);
  });

  it("caps the height by the requested maximum", () => {
    expect(
      placePopover(anchor(100, 100, 80, 20), menu, viewport, {
        maxHeight: 200,
      }).maxHeight,
    ).toBe(200);
  });

  it("keeps the minimum height when neither side has room", () => {
    expect(
      placePopover(
        anchor(100, 100, 80, 20),
        menu,
        { width: 800, height: 200 },
        { side: "top", minHeight: 180 },
      ),
    ).toEqual({
      side: "top",
      left: 100,
      bottom: 106,
      width: 200,
      maxHeight: 180,
    });
  });

  it("narrows a popover wider than the viewport", () => {
    expect(placePopover(anchor(0, 100, 80, 20), menu, { width: 180, height: 600 })).toMatchObject({
      left: 8,
      width: 164,
    });
  });

  it("hangs a flyout off the anchor's right edge, overlapping by the gap", () => {
    expect(
      placePopover(anchor(100, 100, 200, 24), { width: 240, height: 300 }, viewport, {
        side: "right",
        gap: -4,
      }),
    ).toEqual({
      side: "right",
      left: 296,
      top: 100,
      width: 240,
      maxHeight: 492,
    });
  });

  it("flips a flyout to the left when the right runs out", () => {
    expect(
      placePopover(
        anchor(200, 100, 200, 24),
        { width: 240, height: 300 },
        { width: 420, height: 600 },
        { side: "right", gap: -4 },
      ),
    ).toMatchObject({ side: "left", left: 8 });
  });

  it("clamps a flyout that would hang below the viewport", () => {
    expect(
      placePopover(anchor(100, 560, 200, 24), { width: 240, height: 300 }, viewport, {
        side: "right",
      }),
    ).toMatchObject({ top: 292, maxHeight: 300 });
  });

  describe("short windows", () => {
    const short = { width: 1280, height: 520 };
    const tall = { width: 228, height: 1288 };

    it("fits a tall menu under a top anchor and leaves it scrollable inside the room", () => {
      const position = placePopover(anchor(16, 16, 100, 28), tall, short, { side: "bottom" });
      expect(position.side).toBe("bottom");
      expect(position.top).toBe(50);
      // The surface never extends past the bottom padding of the viewport.
      expect(position.top! + position.maxHeight).toBe(short.height - 8);
    });

    it("opens a tall menu above a bottom anchor, bounded to the room above it", () => {
      const position = placePopover(anchor(1100, 480, 100, 28), tall, short, { side: "bottom" });
      expect(position.side).toBe("top");
      expect(position.bottom).toBe(short.height - 480 + 6);
      expect(position.maxHeight).toBe(480 - 6 - 8);
    });

    it("picks the larger side when neither fits and still stays inside the viewport", () => {
      const position = placePopover(anchor(500, 300, 100, 28), tall, short, { side: "bottom" });
      // Below: 520 - 328 - 14 = 178. Above: 300 - 14 = 286.
      expect(position.side).toBe("top");
      expect(position.maxHeight).toBe(286);
      expect(position.bottom! + position.maxHeight).toBeLessThanOrEqual(short.height - 8);
    });

    it("never gives a flyout more height than the window has", () => {
      const position = placePopover(anchor(900, 200, 228, 30), tall, short, {
        side: "right",
        gap: 4,
      });
      expect(position.top).toBeGreaterThanOrEqual(8);
      expect(position.top! + position.maxHeight).toBeLessThanOrEqual(short.height - 8);
      expect(position.maxHeight).toBe(short.height - 16);
    });
  });

  describe("nested menus at the edge", () => {
    it("flips a submenu to the left when the right edge has no room", () => {
      // Parent row ends at 1272 of 1280: no 228px of room on the right, plenty on the left.
      const position = placePopover(
        anchor(1044, 100, 228, 28),
        { width: 228, height: 200 },
        { width: 1280, height: 600 },
        { side: "right", gap: 4, width: 228 },
      );
      expect(position.side).toBe("left");
      expect(position.left).toBe(1044 - 4 - 228);
    });

    it("flips to whichever side has more room when neither fits the full width", () => {
      const position = placePopover(
        anchor(100, 100, 228, 28),
        { width: 228, height: 200 },
        { width: 380, height: 600 },
        { side: "right", gap: 4, width: 228 },
      );
      // 380 - 328 - 12 = 40 on the right, 100 - 12 = 88 on the left: the left is larger.
      expect(position.side).toBe("left");
      expect(position.left).toBeGreaterThanOrEqual(8);
    });

    it("clamps into the viewport when the window is narrower than two menus", () => {
      const position = placePopover(
        anchor(8, 100, 228, 28),
        { width: 228, height: 200 },
        { width: 300, height: 600 },
        { side: "right", gap: 4, width: 228 },
      );
      expect(position.left).toBeGreaterThanOrEqual(8);
      expect(position.left + position.width).toBeLessThanOrEqual(300 - 8);
    });
  });
});

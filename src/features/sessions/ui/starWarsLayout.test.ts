import { describe, expect, it } from "vitest";
import { starWarsLayout } from "./starWarsLayout";

describe("Star Wars crescent layout", () => {
  it("places the six core characters on a visibly deep symmetric crescent", () => {
    const places = starWarsLayout(6);
    expect(places.map((place) => place.id)).toEqual([0, 1, 2, 3, 4, 5]);
    for (let index = 0; index < 3; index++) {
      const left = places[index];
      const right = places[5 - index];
      expect(left.x + right.x).toBeCloseTo(760);
      expect(left.y).toBeCloseTo(right.y);
      expect(left.scale).toBeCloseTo(right.scale);
    }
    expect(places[0].y - places[2].y).toBeGreaterThanOrEqual(80);
    expect(places[0].y - places[2].y).toBeLessThanOrEqual(100);
    expect(places[0].y + 70).toBeCloseTo(312);
    expect(places[2].y + 70).toBeGreaterThanOrEqual(210);
    expect(places[2].y + 70).toBeLessThanOrEqual(235);
    expect(places[2].scale).toBeLessThan(places[0].scale);
    expect(places[2].scale).toBeGreaterThanOrEqual(0.74);
    expect(places[0].scale).toBeCloseTo(0.78);
  });

  it("adds unique helpers on alternating wings without splitting into extra rows", () => {
    expect(starWarsLayout(8).map((place) => place.id)).toEqual([6, 0, 1, 2, 3, 4, 5, 7]);
    for (let count = 6; count <= 30; count++) {
      const places = starWarsLayout(count);
      expect(new Set(places.map((place) => place.id)).size).toBe(count);
      expect(places.filter((place) => place.id < 6).map((place) => place.id)).toEqual([
        0, 1, 2, 3, 4, 5,
      ]);
      const middle = (count - 1) / 2;
      for (let index = 1; index < count; index++) {
        const previous = places[index - 1];
        const current = places[index];
        expect(current.x - previous.x).toBeGreaterThan(
          80 * Math.max(previous.scale, current.scale),
        );
        const [inner, outer] =
          Math.abs(index - middle) < Math.abs(index - 1 - middle)
            ? [current, previous]
            : [previous, current];
        expect(outer.y + 1e-9).toBeGreaterThanOrEqual(inner.y);
      }
    }
  });

  it("keeps swept weapons and head labels within the stage at narrow and wide widths", () => {
    for (const width of [420, 800, 1280]) {
      for (const count of [6, 7, 12, 18, 30]) {
        const places = starWarsLayout(count, width);
        expect(places).toEqual(starWarsLayout(count));
        for (const place of places) {
          expect([place.x, place.y, place.scale].every(Number.isFinite)).toBe(true);
          expect(place.scale).toBeGreaterThan(0);
          expect(place.x - 100 * place.scale).toBeGreaterThanOrEqual(4);
          expect(place.x + 120 * place.scale).toBeLessThanOrEqual(756);
          // Allow a raised head/weapon plus a 28px label above the character.
          expect(place.y + 70 - 230 * place.scale - 28).toBeGreaterThanOrEqual(0);
          expect(place.y + 70 + 8 * place.scale).toBeLessThanOrEqual(390);
        }
      }
    }
  });

  it("only shrinks characters and never widens the occupied stage when helpers arrive", () => {
    const occupiedWidth = (places: ReturnType<typeof starWarsLayout>) =>
      Math.max(...places.map((place) => place.x + 120 * place.scale)) -
      Math.min(...places.map((place) => place.x - 100 * place.scale));
    for (let count = 7; count <= 30; count++) {
      const previous = starWarsLayout(count - 1);
      const next = starWarsLayout(count);
      expect(occupiedWidth(next)).toBeLessThan(occupiedWidth(previous));
      for (const place of previous) {
        expect(next.find((candidate) => candidate.id === place.id)!.scale).toBeLessThan(
          place.scale,
        );
      }
    }
  });
});

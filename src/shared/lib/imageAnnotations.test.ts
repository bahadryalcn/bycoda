import { describe, expect, it } from "vitest";
import {
  fitImageAnnotation,
  imageAnnotationPoint,
  imageAnnotationArrowHead,
  MAX_IMAGE_ANNOTATION_MARKS,
  rasterizeImageAnnotations,
  validateImageAnnotationDocument,
  type ImageAnnotationDocument,
} from "./imageAnnotations";

describe("image coordinates", () => {
  it("preserves portrait aspect ratio in wide and short viewports", () => {
    expect(fitImageAnnotation(390, 844, 480, 900)).toEqual({
      width: (390 * 900) / 844,
      height: 900,
    });
    expect(fitImageAnnotation(390, 844, 300, 900)).toEqual({
      width: 300,
      height: (844 * 300) / 390,
    });
    expect(fitImageAnnotation(390, 844, 480, 0)).toEqual({ width: 0, height: 0 });
  });

  it("uses the fitted image bounds and clamps a captured pointer outside the image", () => {
    const bounds = { left: 50, top: 20, width: 200, height: 400 };
    expect(imageAnnotationPoint({ x: 100, y: 120 }, bounds)).toEqual({ x: 0.25, y: 0.25 });
    expect(imageAnnotationPoint({ x: 800, y: -20 }, bounds)).toEqual({ x: 1, y: 0 });
    expect(imageAnnotationPoint({ x: NaN, y: 1 }, bounds)).toBeUndefined();
    expect(imageAnnotationPoint({ x: 10, y: 10 }, { ...bounds, height: 0 })).toBeUndefined();
  });

  it("keeps an arrow tip on the selected image point for non-square images", () => {
    const head = imageAnnotationArrowHead({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }, 400, 800);
    expect(head[1]).toEqual({ x: 360, y: 640 });
    const shaft = { x: 320, y: 480 };
    for (const wing of [head[0], head[2]]) {
      expect((wing.x - 360) * shaft.x + (wing.y - 640) * shaft.y).toBeLessThan(0);
    }
  });
});

describe("bounded annotation data", () => {
  const valid: ImageAnnotationDocument = {
    marks: [
      { id: "box", type: "box", start: { x: 0.1, y: 0.2 }, end: { x: 0.8, y: 0.7 } },
      { id: "pin", type: "pin", point: { x: 0.5, y: 0.8 }, number: 1 },
    ],
  };
  it("accepts normalized marks and rejects invalid coordinates, duplicate IDs and excess work", () => {
    expect(() => validateImageAnnotationDocument(valid)).not.toThrow();
    expect(() =>
      validateImageAnnotationDocument({ marks: [...valid.marks, valid.marks[0]] }),
    ).toThrow();
    expect(() =>
      validateImageAnnotationDocument({
        marks: [{ id: "bad", type: "pen", points: [{ x: Infinity, y: 0 }] }],
      }),
    ).toThrow();
    expect(() =>
      validateImageAnnotationDocument({
        marks: [{ id: "bad", type: "arrow", start: { x: -0.1, y: 0 }, end: { x: 0, y: 1 } }],
      }),
    ).toThrow();
    expect(() =>
      validateImageAnnotationDocument({
        marks: Array.from({ length: MAX_IMAGE_ANNOTATION_MARKS + 1 }, (_, index) => ({
          id: String(index),
          type: "pin",
          point: { x: 0, y: 0 },
          number: 1,
        })),
      }),
    ).toThrow();
  });

  it("does not load remote URLs or malformed images while exporting a frozen frame", async () => {
    await expect(
      rasterizeImageAnnotations("https://example.invalid/phone.png", valid),
    ).rejects.toThrow("source");
    await expect(
      rasterizeImageAnnotations("data:image/svg+xml;base64,AAAA", valid),
    ).rejects.toThrow("source");
    await expect(rasterizeImageAnnotations("data:image/png;base64,!!!", valid)).rejects.toThrow(
      "source",
    );
  });
});

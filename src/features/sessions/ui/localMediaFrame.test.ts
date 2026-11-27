import { expect, it } from "vitest";
import { localMediaFrameStyle } from "./localMediaFrame";

it("keeps the stable placeholder while the intrinsic size is unknown", () => {
  expect(localMediaFrameStyle(undefined)).toBeUndefined();
  expect(localMediaFrameStyle({ width: 0, height: 0 })).toBeUndefined();
  expect(localMediaFrameStyle({ width: 1000, height: 0 })).toBeUndefined();
  expect(localMediaFrameStyle({ width: Number.NaN, height: 720 })).toBeUndefined();
});

it("sizes a tall capture from its own ratio and caps it by the frame height", () => {
  expect(localMediaFrameStyle({ width: 1000, height: 4000 })).toEqual({
    aspectRatio: "1000 / 4000",
    width: "min(100%, 1000px, 40rem, calc(32rem * 0.25))",
  });
});

it("sizes a wide diagram by its ratio without exceeding the frame width", () => {
  expect(localMediaFrameStyle({ width: 3200, height: 800 })).toEqual({
    aspectRatio: "3200 / 800",
    width: "min(100%, 3200px, 40rem, calc(32rem * 4))",
  });
});

it("never upscales a small image past its intrinsic width", () => {
  expect(localMediaFrameStyle({ width: 120, height: 90 })?.width).toBe(
    "min(100%, 120px, 40rem, calc(32rem * 1.3333333333333333))",
  );
});

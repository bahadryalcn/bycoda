import { expect, it } from "vitest";
import {
  androidRawPixels,
  decodePng,
  deviceFrameMaxEdge,
  encodePng,
  fitDevicePixels,
  scalePixels,
} from "./device-frame-fit";

function rawCapture(
  width: number,
  height: number,
  format: number,
  header: 12 | 16,
  pixel: number[],
) {
  const buffer = Buffer.alloc(header + width * height * 4);
  buffer.writeUInt32LE(width, 0);
  buffer.writeUInt32LE(height, 4);
  buffer.writeUInt32LE(format, 8);
  for (let at = header; at < buffer.length; at += 4) buffer.set(pixel, at);
  return buffer;
}

it("reads Android raw captures with both header sizes and refuses unknown formats", () => {
  const modern = androidRawPixels(rawCapture(4, 2, 1, 16, [10, 20, 30, 255]));
  expect(modern).toMatchObject({ width: 4, height: 2, channels: 4, bgr: false });
  expect(Array.from(modern!.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  expect(androidRawPixels(rawCapture(4, 2, 5, 12, [1, 2, 3, 255]))).toMatchObject({ bgr: true });
  // RGB_565 and truncated buffers keep the full PNG path.
  expect(androidRawPixels(rawCapture(4, 2, 4, 16, [0, 0, 0, 0]))).toBeUndefined();
  expect(androidRawPixels(rawCapture(4, 2, 1, 16, [0, 0, 0, 0]).subarray(0, 20))).toBeUndefined();
});

it("scales to the longer edge, keeps the aspect and averages colors", () => {
  const pixels = androidRawPixels(rawCapture(2560, 1600, 5, 16, [30, 20, 10, 255]))!;
  const scaled = scalePixels(pixels, 960);
  expect([scaled.width, scaled.height]).toEqual([960, 600]);
  // BGRA input comes out as RGB.
  expect(Array.from(scaled.rgb.subarray(0, 3))).toEqual([10, 20, 30]);
});

it("round-trips a fitted PNG with the device size it came from", async () => {
  const pixels = androidRawPixels(rawCapture(1600, 2560, 1, 16, [200, 100, 50, 255]))!;
  const fitted = (await fitDevicePixels(pixels, 800))!;
  expect([fitted.sourceWidth, fitted.sourceHeight]).toEqual([1600, 2560]);
  const decoded = (await decodePng(fitted.png))!;
  expect([decoded.width, decoded.height, decoded.channels]).toEqual([500, 800, 3]);
  expect(Array.from(decoded.data.subarray(-3))).toEqual([200, 100, 50]);
});

it("decodes every PNG row filter it writes and leaves fitting RGB frames alone", async () => {
  const rgb = new Uint8Array(3 * 3 * 3).map((_, index) => (index * 37) % 256);
  const png = await encodePng(3, 3, rgb);
  const decoded = (await decodePng(png))!;
  expect(Array.from(decoded.data)).toEqual(Array.from(rgb));
  expect(await fitDevicePixels(decoded, 1080)).toBeUndefined();
  expect(await decodePng(Buffer.from("not a png"))).toBeUndefined();
});

it("accepts only bounded integer frame sizes", () => {
  expect(deviceFrameMaxEdge(undefined)).toBeUndefined();
  expect(deviceFrameMaxEdge(1080)).toBe(1080);
  for (const value of [0, 319, 4097, 1080.5, "1080"])
    expect(() => deviceFrameMaxEdge(value)).toThrow("Invalid frame size");
});

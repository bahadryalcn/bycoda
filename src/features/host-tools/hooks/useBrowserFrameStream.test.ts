import { expect, it } from "vitest";
import { parseBrowserFrame } from "./useBrowserFrameStream";

it("reads the native sequence, document identity, and bounded JPEG payload", () => {
  const identity = { documentId: "d", navigationId: "n", width: 3840, height: 2160 };
  const metadata = new TextEncoder().encode(JSON.stringify(identity));
  const packet = new ArrayBuffer(10 + metadata.length);
  const view = new DataView(packet);
  view.setUint32(0, 14);
  view.setUint16(4, metadata.length);
  const bytes = new Uint8Array(packet);
  bytes.set(metadata, 6);
  bytes.set([255, 216, 255, 217], 6 + metadata.length);
  expect(parseBrowserFrame(packet)).toMatchObject({
    sequence: 14,
    identity,
    jpeg: { size: 4, type: "image/jpeg" },
  });
  expect(parseBrowserFrame(new ArrayBuffer(0))).toBeUndefined();
  view.setUint16(4, 65535);
  expect(() => parseBrowserFrame(packet)).toThrow("Invalid browser frame packet");
});

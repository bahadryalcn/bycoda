import { expect, it, vi } from "vitest";
import { boundToolOutput, deliverToolImages } from "./voiceToolOutput";

const shot = { app: "x", windowId: 3, mimeType: "image/png", data: "QUJD", width: 4, height: 2 };

it("delivers a top-level screenshot as an image and strips base64", () => {
  const image = vi.fn(() => ({ accepted: true }));
  const out = deliverToolImages(shot, image) as Record<string, unknown>;
  expect(image).toHaveBeenCalledWith("data:image/png;base64,QUJD");
  expect(out).toMatchObject({ imageDelivered: true, width: 4, app: "x", windowId: 3 });
  expect(JSON.stringify(out)).not.toContain("QUJD");
});

it("handles the nested screenshot shape", () => {
  const image = vi.fn(() => ({ accepted: true }));
  const out = deliverToolImages(
    { status: "ok", screenshot: { ...shot, mimeType: "image/jpeg" } },
    image,
  );
  expect(image).toHaveBeenCalledWith("data:image/jpeg;base64,QUJD");
  expect(out).toMatchObject({ status: "ok", imageDelivered: true });
  expect(JSON.stringify(out)).not.toContain("QUJD");
});

it("reports imageDelivered false when the port is missing or rejects", () => {
  const none = deliverToolImages(shot, undefined) as Record<string, unknown>;
  expect(none).toMatchObject({
    imageDelivered: false,
    imageError: "This voice provider cannot inspect images.",
    data: "[image omitted]",
  });
  const rejected = deliverToolImages(shot, () => ({ accepted: false, error: "too big" }));
  expect(rejected).toMatchObject({ imageDelivered: false, imageError: "too big" });
  expect(JSON.stringify(rejected)).not.toContain("QUJD");
});

it("leaves non-image and malformed results untouched", () => {
  const image = vi.fn(() => ({ accepted: true }));
  for (const value of [
    { status: "ok" },
    "text",
    null,
    { mimeType: "image/gif", data: "QUJD" },
    { mimeType: "image/png", data: "not base64!" },
  ])
    expect(deliverToolImages(value, image)).toBe(value);
  expect(image).not.toHaveBeenCalled();
});

it("keeps small top-level keys and valid JSON when truncating", () => {
  const raw = JSON.stringify({ status: "ok", nextOffset: 40, items: "x".repeat(60_000) });
  const out = JSON.parse(boundToolOutput(raw, 48_000));
  expect(out).toMatchObject({
    status: "ok",
    nextOffset: 40,
    truncated: true,
    originalLength: raw.length,
  });
  expect(out.preview.length).toBeLessThanOrEqual(8_000);
  expect(out.next).toContain("Omitted data is unknown");
  expect(out.items).toBeUndefined();
});

it("passes small output through and bounds non-object output", () => {
  expect(boundToolOutput('{"a":1}', 100)).toBe('{"a":1}');
  const out = JSON.parse(boundToolOutput(JSON.stringify("y".repeat(500)), 100, 50));
  expect(out.truncated).toBe(true);
});

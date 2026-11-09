import { expect, it } from "vitest";
import { placeVoiceSidePanel, voiceOverlaySide } from "./voiceSidePanel";

const viewport = { width: 1280, height: 800 };

it("opens beside the companion on the right first, aligned to its bottom", () => {
  expect(placeVoiceSidePanel({ left: 16, top: 200, right: 376, bottom: 784 }, viewport)).toEqual({
    side: "right",
    x: 384,
    bottom: 16,
    width: 340,
    maxHeight: 776,
  });
});

it("opens on the left when the companion sits at the right edge", () => {
  expect(
    placeVoiceSidePanel({ left: 900, top: 200, right: 1260, bottom: 760 }, viewport),
  ).toMatchObject({ side: "left", x: 552, bottom: 40 });
});

it("opens above when neither side fits, and inside the panel when nothing fits", () => {
  const narrow = { width: 500, height: 800 };
  expect(placeVoiceSidePanel({ left: 70, top: 420, right: 430, bottom: 784 }, narrow)).toEqual({
    side: "top",
    x: 70,
    bottom: 388,
    width: 360,
    maxHeight: 404,
  });
  expect(placeVoiceSidePanel({ left: 70, top: 60, right: 430, bottom: 784 }, narrow)).toEqual({
    side: "inline",
  });
});

it("grows the detached window toward the side of the screen with room", () => {
  expect(voiceOverlaySide({ left: 0, right: 600 })).toBe("right");
  expect(voiceOverlaySide({ left: 600, right: 100 })).toBe("left");
  expect(voiceOverlaySide({ left: 100, right: 100 })).toBe("inline");
});

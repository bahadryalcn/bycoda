import { expect, it } from "vitest";
import type { CampaignVariant } from "../model/social";
import { validFacebookReel } from "./FacebookReelFields";

const variant = (): CampaignVariant => ({
  accountId: "page",
  text: "",
  media: [{ kind: "video", uploadId: "owner-video" }],
  factIds: [],
  scheduledAt: 1,
  facebook: { target: "reel", durationSeconds: 4, width: 540, height: 960, frameRate: 23 },
});

it("allows the supported Reel boundary without changing ordinary Page feed validation", () => {
  expect(validFacebookReel(variant())).toBe(true);
  expect(validFacebookReel({ ...variant(), facebook: undefined, media: [] })).toBe(true);
  expect(
    validFacebookReel({
      ...variant(),
      facebook: {
        ...variant().facebook!,
        durationSeconds: 60,
        frameRate: 29.97,
        width: 1080,
        height: 1920,
      },
    }),
  ).toBe(true);
});

it.each([
  { durationSeconds: 3.99 },
  { durationSeconds: 60.01 },
  { durationSeconds: NaN },
  { width: 539 },
  { width: 1080, height: 1080 },
  { height: 959 },
  { width: 540.5 },
  { frameRate: 0 },
  { frameRate: 22.99 },
  { frameRate: Infinity },
])("keeps incompatible Reel metadata unsavable: %j", (patch) => {
  const value = variant();
  value.facebook = { ...value.facebook!, ...patch };
  expect(validFacebookReel(value)).toBe(false);
});

it.each([
  [],
  [{ kind: "image", uploadId: "image" }],
  [{ kind: "video", url: "https://example.test/v.mp4" }],
  [{ kind: "video", uploadId: "video", alt: "unsupported" }],
  [{ kind: "video", uploadId: "video", title: "unsupported" }],
  [
    { kind: "video", uploadId: "first" },
    { kind: "video", uploadId: "second" },
  ],
] as CampaignVariant["media"][])(
  "rejects incompatible media for an explicit Reel: %j",
  (...media) => {
    // Vitest spreads array cases; preserve the selected media collection.
    expect(validFacebookReel({ ...variant(), media: media as CampaignVariant["media"] })).toBe(
      false,
    );
  },
);

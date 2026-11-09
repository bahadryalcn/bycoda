import { expect, it } from "vitest";
import {
  ASSISTANT_AVATAR_PRESETS,
  assistantAvatarGeneratedValue,
  assistantAvatarPresetValue,
  assistantAvatarView,
} from "./assistantAvatar";

it("draws the default portrait when no avatar is stored", () => {
  expect(assistantAvatarView("")).toEqual({
    kind: "image",
    id: "orb",
    src: "/assistant/avatars/orb.webp",
  });
  expect(assistantAvatarView(undefined)).toMatchObject({ kind: "image", id: "orb" });
  expect(assistantAvatarView("   ")).toMatchObject({ kind: "image", id: "orb" });
});

it("draws a chosen preset and falls back to the default for an unknown one", () => {
  expect(assistantAvatarView("preset:fox")).toEqual({
    kind: "image",
    id: "fox",
    src: "/assistant/avatars/fox.webp",
  });
  expect(assistantAvatarView("preset:dragon")).toMatchObject({ kind: "image", id: "orb" });
});

it("keeps emoji and initials as text", () => {
  expect(assistantAvatarView(" 🦊 ")).toEqual({ kind: "text", text: "🦊" });
  expect(assistantAvatarView("AR")).toEqual({ kind: "text", text: "AR" });
});

it("stores every preset within the profile's 200-character avatar limit", () => {
  for (const preset of ASSISTANT_AVATAR_PRESETS)
    expect(assistantAvatarPresetValue(preset.id).length).toBeLessThanOrEqual(200);
});

it("draws a generated avatar by its Host id and falls back for an invalid id", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  expect(assistantAvatarView(`image:${id}`)).toEqual({ kind: "generated", id });
  expect(assistantAvatarView(assistantAvatarGeneratedValue(id))).toEqual({ kind: "generated", id });
  expect(assistantAvatarView("image:../secret")).toMatchObject({ kind: "image", id: "orb" });
  expect(assistantAvatarView("image:")).toMatchObject({ kind: "image", id: "orb" });
  expect(assistantAvatarGeneratedValue(id).length).toBeLessThanOrEqual(200);
});

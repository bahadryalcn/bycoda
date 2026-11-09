import { expect, it } from "vitest";
import {
  ASSISTANT_AVATAR_PRESETS,
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

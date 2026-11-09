/**
 * The assistant's avatar is one profile string (max 200 characters): `preset:<id>` for a bundled
 * portrait, any other text for an emoji or initials, or empty for the default portrait.
 */
export const ASSISTANT_AVATAR_PRESETS = [
  { id: "orb", label: "Orb" },
  { id: "robot", label: "Robot" },
  { id: "owl", label: "Owl" },
  { id: "fox", label: "Fox" },
  { id: "spark", label: "Spark" },
  { id: "wave", label: "Wave" },
  { id: "character", label: "Assistant" },
  { id: "cat", label: "Cat" },
] as const;

export type AssistantAvatarPresetId = (typeof ASSISTANT_AVATAR_PRESETS)[number]["id"];

export const DEFAULT_ASSISTANT_AVATAR: AssistantAvatarPresetId = "orb";
const PREFIX = "preset:";

export const assistantAvatarPresetValue = (id: AssistantAvatarPresetId) => `${PREFIX}${id}`;

export const assistantAvatarImageUrl = (id: AssistantAvatarPresetId) =>
  `/assistant/avatars/${id}.webp`;

export type AssistantAvatarView =
  | { kind: "image"; id: AssistantAvatarPresetId; src: string }
  | { kind: "text"; text: string };

/**
 * What to draw for a stored avatar value. Empty and unknown presets (an avatar chosen in a newer
 * build) fall back to the default portrait, so the header never shows a raw `preset:` string.
 */
export function assistantAvatarView(value: string | undefined | null): AssistantAvatarView {
  const text = value?.trim() ?? "";
  if (text && !text.startsWith(PREFIX)) return { kind: "text", text };
  const requested = text.slice(PREFIX.length);
  const preset =
    ASSISTANT_AVATAR_PRESETS.find((item) => item.id === requested)?.id ?? DEFAULT_ASSISTANT_AVATAR;
  return { kind: "image", id: preset, src: assistantAvatarImageUrl(preset) };
}

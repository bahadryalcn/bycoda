import type { SnapchatPublishOptions, SocialAccount } from "../../../src/features/social/model/social";
import { exact, finite, str } from "../core/social-helpers";

function fields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Snapchat publishing metadata.");
  return value as Record<string, unknown>;
}

export function parseSnapchatPublishOptions(
  account: SocialAccount,
  value: unknown,
): SnapchatPublishOptions {
  if (account.platform !== "snapchat" || account.accountType !== "public_profile")
    throw new Error("Snapchat publishing metadata requires a Public Profile.");
  const input = fields(value);
  const { target } = input;
  if (target !== "spotlight" && target !== "story" && target !== "saved_story")
    throw new Error("Choose a Snapchat publishing format.");
  const browser = account.connection === "browser";
  const dimensions = ["durationSeconds", "width", "height"];
  const result: SnapchatPublishOptions = {
    target,
    durationSeconds: finite(input.durationSeconds, "Snapchat duration", 0, 300),
    width: finite(input.width, "Snapchat width"),
    height: finite(input.height, "Snapchat height"),
  };
  if (target === "spotlight") {
    exact(input, ["target", ...dimensions, "locale", "linkStickerText", "linkStickerPlacement"]);
    if (!browser || input.locale !== undefined) {
      const locale = str(input.locale, "Spotlight locale", 5);
      if (!/^[a-z]{2}_[A-Z]{2}$/.test(locale)) throw new Error("Use a Spotlight locale such as tr_TR.");
      result.locale = locale;
    }
  } else if (target === "story") {
    exact(input, ["target", ...dimensions, "storyTtl", "linkStickerText", "linkStickerPlacement", "captionCenterY"]);
    const { storyTtl, captionCenterY } = input;
    if (browser && [storyTtl, captionCenterY].some((item) => item !== undefined))
      throw new Error("These Snapchat Story options require the Public Profile API.");
    if (storyTtl !== undefined) {
      if (storyTtl !== "ONE_DAY" && storyTtl !== "TWO_DAYS" && storyTtl !== "THREE_DAYS" && storyTtl !== "ONE_WEEK")
        throw new Error("Invalid Snapchat Story duration.");
      result.storyTtl = storyTtl;
    }
    if (captionCenterY !== undefined) result.captionCenterY = finite(captionCenterY, "caption placement", 0, 1);
  } else {
    exact(input, ["target", ...dimensions, "savedStorySources"]);
    if (browser) throw new Error("Saved Stories require the Snapchat Public Profile API.");
    if (input.savedStorySources !== undefined) {
      if (!Array.isArray(input.savedStorySources) || input.savedStorySources.length > 20)
        throw new Error("Invalid Saved Story sources.");
      result.savedStorySources = input.savedStorySources.map((source: unknown) => {
        const entry = fields(source);
        exact(entry, ["kind", "id"]);
        if (entry.kind !== "snap" && entry.kind !== "spotlight")
          throw new Error("Choose a Snap or Spotlight source.");
        return { kind: entry.kind, id: str(entry.id, "Saved Story source ID", 200) };
      });
    }
  }
  const { linkStickerText, linkStickerPlacement } = input;
  if (browser && (linkStickerText !== undefined || linkStickerPlacement !== undefined))
    throw new Error("Snapchat link stickers require the Public Profile API.");
  if (linkStickerText !== undefined) result.linkStickerText = str(linkStickerText, "link sticker", 40);
  if (linkStickerPlacement !== undefined) {
    const placement = fields(linkStickerPlacement);
    exact(placement, ["centerX", "centerY"]);
    result.linkStickerPlacement = {
      centerX: finite(placement.centerX, "link sticker horizontal placement", 0, 1),
      centerY: finite(placement.centerY, "link sticker vertical placement", 0, 1),
    };
  }
  return result;
}

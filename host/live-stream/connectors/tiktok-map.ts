import type { LiveEvent, LiveViewer } from "../../../src/features/live-stream/model/liveEvents";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";

// The connector's decoded messages changed shape between protocol versions (comment vs content,
// giftDetails vs flat fields, avatarThumb vs profilePicture), so every read below accepts each known
// form and treats the message as untrusted input.

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw =>
  value && typeof value === "object" ? (value as Raw) : {};
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value
    ? value
    : typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : undefined;
const asNumber = (value: unknown): number | undefined => {
  const n =
    typeof value === "string" ? Number(value) : typeof value === "bigint" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
const firstUrl = (image: unknown): string | undefined => {
  const record = asRecord(image);
  for (const key of ["urls", "urlList", "url"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      const url = list.find((item) => typeof item === "string" && item.startsWith("https://"));
      if (url) return url as string;
    }
  }
  return undefined;
};

export function mapViewer(raw: unknown): LiveViewer | undefined {
  const user = asRecord(raw);
  const id = asString(user.userId) ?? asString(user.id) ?? asString(user.uniqueId);
  if (!id) return undefined;
  const handle = asString(user.uniqueId) ?? asString(user.displayId) ?? id;
  return {
    id,
    handle,
    name: truncateGraphemes(asString(user.nickname) ?? handle, 60),
    avatarUrl:
      firstUrl(user.profilePicture) ?? firstUrl(user.avatarThumb) ?? firstUrl(user.avatarMedium),
  };
}
function messageId(
  data: Raw,
  kind: string,
  viewer: LiveViewer | undefined,
  fallbackAt: number,
): string {
  const id =
    asString(asRecord(data.common).msgId) ??
    asString(asRecord(data.event).msgId) ??
    asString(data.msgId);
  return id
    ? `${kind}:${id}`
    : `${kind}:${viewer?.id ?? "room"}:${fallbackAt}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Translates one connector event into a normalized live event, or undefined when it should be ignored. */
export function mapTikTokEvent(kind: string, payload: unknown, now: number): LiveEvent | undefined {
  const data = asRecord(payload);
  const viewer = mapViewer(data.user);
  const base = { id: messageId(data, kind, viewer, now), at: now };
  switch (kind) {
    case "chat": {
      const text = asString(data.comment) ?? asString(data.content);
      return viewer && text
        ? { ...base, kind: "comment", viewer, text: truncateGraphemes(text, 300) }
        : undefined;
    }
    case "gift": {
      if (!viewer) return undefined;
      const details = asRecord(data.giftDetails);
      const extended = asRecord(data.extendedGiftInfo);
      const gift = asRecord(data.gift);
      const giftType =
        asNumber(gift.type) ??
        asNumber(details.giftType) ??
        asNumber(data.giftType) ??
        asNumber(extended.type);
      const repeatEnd = data.repeatEnd === true || asNumber(data.repeatEnd) === 1;
      // A streakable gift (type 1) fires on every step of the streak; count it once, when it ends.
      if (giftType === 1 && !repeatEnd) return undefined;
      const giftId = asNumber(data.giftId) ?? asNumber(gift.id) ?? 0;
      return {
        ...base,
        kind: "gift",
        viewer,
        giftId,
        giftName: truncateGraphemes(
          asString(gift.name) ??
            asString(details.giftName) ??
            asString(extended.name) ??
            asString(data.giftName) ??
            `#${giftId}`,
          60,
        ),
        diamonds: Math.min(
          1_000_000,
          asNumber(gift.diamondCount) ??
            asNumber(details.diamondCount) ??
            asNumber(extended.diamond_count) ??
            asNumber(data.diamondCount) ??
            0,
        ),
        count: Math.min(10_000, Math.max(1, asNumber(data.repeatCount) ?? 1)),
      };
    }
    case "like":
      return viewer
        ? {
            ...base,
            kind: "like",
            viewer,
            count: Math.min(
              100_000,
              Math.max(1, asNumber(data.count) ?? asNumber(data.likeCount) ?? 1),
            ),
          }
        : undefined;
    case "member":
      return viewer ? { ...base, kind: "join", viewer } : undefined;
    case "follow":
      return viewer ? { ...base, kind: "follow", viewer } : undefined;
    case "share":
      return viewer ? { ...base, kind: "share", viewer } : undefined;
    case "roomUser": {
      const count = asNumber(data.viewerCount) ?? asNumber(data.totalUser) ?? asNumber(data.total);
      return count === undefined ? undefined : { ...base, kind: "viewers", count };
    }
    case "streamEnd":
      return { ...base, kind: "stream-end" };
    default:
      return undefined;
  }
}

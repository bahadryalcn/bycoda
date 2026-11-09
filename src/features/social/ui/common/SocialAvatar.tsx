import { useState } from "react";
import { PlatformIcon, type SocialChannel } from "./PlatformIcon";
import "./common.css";

export type SocialAvatarSize = "sm" | "md" | "lg";

/** Up to two initials from a display name or handle; "?" when there is none. */
export function avatarInitials(name: string): string {
  const words = name
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  const letters =
    words.length === 1 ? [...words[0]].slice(0, 1) : [words[0], words[words.length - 1]];
  return letters
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

/**
 * A person: their picture when it loads, otherwise initials on a neutral disc. `platform` adds
 * the platform mark at the lower corner. Decorative: the name is always written beside it.
 */
export function SocialAvatar({
  name,
  avatarUrl,
  platform,
  size = "md",
}: {
  name: string;
  avatarUrl?: string;
  platform?: SocialChannel;
  /** sm 24px (rows), md 32px (lists), lg 40px (headers and panels). */
  size?: SocialAvatarSize;
}) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;
  return (
    <span className="social-avatar" data-size={size} aria-hidden>
      {showImage ? (
        <img
          className="social-avatar-image"
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        <span className="social-avatar-initials">{avatarInitials(name)}</span>
      )}
      {platform ? (
        <span className="social-avatar-platform">
          <PlatformIcon platform={platform} className="social-avatar-platform-glyph" />
        </span>
      ) : null}
    </span>
  );
}

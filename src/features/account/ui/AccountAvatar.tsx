import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useState, type ReactNode } from "react";
import { UserRound } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import styles from "./AccountAvatar.module.css";

export type AccountAvatarUser = {
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

/** First letter of the name (or e-mail) for the avatar fallback. */
export function accountInitial(user: AccountAvatarUser): string {
  return (user.displayName || user.email || "").trim().charAt(0).toUpperCase();
}

/**
 * Decorative account picture: the photo, else the initial on the accent circle, else a neutral
 * guest glyph. The enclosing control carries the accessible name; `badge` is a status mark
 * (the sidebar passes the assistant presence dot). `size="lg"` is the account page header.
 */
export function AccountAvatar({
  user,
  badge,
  size = "sm",
}: {
  user: AccountAvatarUser | null;
  badge?: ReactNode;
  size?: "sm" | "lg";
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const initial = user ? accountInitial(user) : "";
  const photo = user?.avatarUrl && broken !== user.avatarUrl ? user.avatarUrl : null;
  return (
    <span
      {...surfaceAttributes(
        {
          radius: "circle",
          variant: user ? undefined : "fill-subtle",
          tone: user ? "accent" : undefined,
          toneFill: user ? "solid" : undefined,
        },
        styles.root,
      )}
      data-signed-in={Boolean(user)}
      data-size={size}
      data-account-avatar
      aria-hidden="true"
    >
      <span {...surfaceAttributes({ radius: "circle" }, styles.face)}>
        {photo ? (
          <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(photo)} />
        ) : initial ? (
          <Text
            as="span"
            size={size === "lg" ? "title" : "caption"}
            tone={user ? "accent-on-solid" : "secondary"}
            weight="medium"
            leading="none"
          >
            {initial}
          </Text>
        ) : (
          <UserRound
            className="icon-sm"
            tone={user ? "accent-on-solid" : "secondary"}
            aria-hidden
          />
        )}
      </span>
      {badge ? (
        <span {...surfaceAttributes({ variant: "panel", radius: "circle" }, styles.badge)}>
          {badge}
        </span>
      ) : null}
    </span>
  );
}

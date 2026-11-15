import type { ReactNode } from "react";
import { UserRound } from "../../../shared/ui/icons";
import { Avatar, type AvatarSize } from "../../../shared/ui/identity/Avatar";
import { graphemes } from "../../../shared/lib/text/truncate";

export type AccountAvatarUser = {
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

/** First whole grapheme of the name (or e-mail) for the avatar fallback. */
export function accountInitial(user: AccountAvatarUser): string {
  return graphemes((user.displayName || user.email || "").trim())[0]?.toUpperCase() ?? "";
}

/**
 * Decorative account picture: the photo, else the initial on the accent circle, else a neutral
 * guest glyph. The enclosing control carries the accessible name; `badge` is a status mark
 * (the sidebar passes the assistant presence dot). `size="lg"` is the account page header.
 */
export function AccountAvatar({
  user,
  badge,
  size = "md",
}: {
  user: AccountAvatarUser | null;
  badge?: ReactNode;
  size?: AvatarSize;
}) {
  const initial = user ? accountInitial(user) : "";
  return (
    <Avatar
      data-account-avatar
      size={size}
      src={user?.avatarUrl}
      tone={user ? "accent" : "neutral"}
      badge={badge}
      fallback={
        initial || (
          <UserRound
            className="icon-sm"
            tone={user ? "accent-on-solid" : "secondary"}
            aria-hidden
          />
        )
      }
    />
  );
}

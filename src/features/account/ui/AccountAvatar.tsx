import { useState, type ReactNode } from "react";
import { UserRound } from "../../../shared/ui/icons";
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
 * (the sidebar passes the assistant presence dot).
 */
export function AccountAvatar({
  user,
  badge,
}: {
  user: AccountAvatarUser | null;
  badge?: ReactNode;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const initial = user ? accountInitial(user) : "";
  const photo = user?.avatarUrl && broken !== user.avatarUrl ? user.avatarUrl : null;
  return (
    <span
      className={styles.root}
      data-signed-in={Boolean(user)}
      data-account-avatar
      aria-hidden="true"
    >
      <span className={styles.face}>
        {photo ? (
          <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(photo)} />
        ) : initial ? (
          initial
        ) : (
          <UserRound className="icon-sm" aria-hidden />
        )}
      </span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </span>
  );
}

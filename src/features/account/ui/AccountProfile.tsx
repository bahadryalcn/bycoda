import type { User } from "@bycoda/account-contracts";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useProfileUpdate } from "../hooks/useAccountData";
import styles from "./account.module.css";

function Avatar({ user }: { user: User }) {
  const [broken, setBroken] = useState(false);
  const initial = (user.displayName || user.email).trim().charAt(0).toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true">
      {user.avatarUrl && !broken ? (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

/** Name, avatar and email of the signed-in account; the display name is edited in place. */
export function AccountProfile({
  user,
  stale,
  verifiedAt,
  onSignOut,
}: {
  user: User;
  stale: boolean;
  verifiedAt: number;
  onSignOut: () => Promise<void>;
}) {
  useLocale();
  const update = useProfileUpdate();
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await onSignOut();
    } catch (error) {
      setSignOutError(errorText(error));
      setSigningOut(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="account-profile">
      <SectionLabel labelId="account-profile">{t("Profile")}</SectionLabel>
      <div className={styles.profile}>
        <Avatar user={user} />
        <div className={styles.identity}>
          <InlineEdit
            label={t("Display name")}
            value={user.displayName}
            validate={(next) => (next.trim() ? null : t("Enter a name."))}
            onSave={(next) => update.mutateAsync({ displayName: next.trim() })}
          />
          <span className={styles.email}>{user.email}</span>
        </div>
        <Button
          variant="secondary"
          loading={signingOut}
          onClick={() => signOut().catch(() => undefined)}
        >
          {t("Sign out")}
        </Button>
      </div>
      {stale ? (
        <InlineMessage tone="neutral">
          {t("Showing account details saved {p0}. They refresh when you are online.", {
            p0: formatRelativeTime(verifiedAt),
          })}
        </InlineMessage>
      ) : null}
      {signOutError ? <InlineError>{signOutError}</InlineError> : null}
    </section>
  );
}

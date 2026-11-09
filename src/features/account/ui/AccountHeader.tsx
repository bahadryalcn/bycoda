import type { AccountContext } from "@bycoda/account-contracts";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { AccountAvatar } from "./AccountAvatar";
import { memberSince, planLabel } from "./AccountProfile";
import styles from "./account.module.css";

/** Who is signed in, above every account tab: picture, name, e-mail, plan, and sign out. */
export function AccountHeader({
  context,
  stale,
  verifiedAt,
  onSignOut,
}: {
  context: AccountContext;
  stale: boolean;
  verifiedAt: number;
  onSignOut: () => Promise<void>;
}) {
  useLocale();
  const { user, entitlements } = context;
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    setError("");
    try {
      await onSignOut();
    } catch (failure) {
      setError(errorText(failure));
      setSigningOut(false);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.identityCard}>
        <AccountAvatar user={user} size="lg" />
        <div className={styles.identity}>
          <span className={styles.name}>{user.displayName || user.email}</span>
          <span className={styles.email}>
            <PrivateEmail email={user.email} />
          </span>
          <span className={styles.facts}>
            <Badge tone="accent">{planLabel(entitlements.planTier)}</Badge>
            <span>{t("Member since {p0}", { p0: memberSince(user) })}</span>
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
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
      {error ? <InlineError>{error}</InlineError> : null}
    </header>
  );
}

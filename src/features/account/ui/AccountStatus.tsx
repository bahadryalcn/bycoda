import type { User } from "@bycoda/account-contracts";
import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { deleteAccountUrl } from "../model/accountPortal";
import styles from "./account.module.css";

export const isDeactivated = (user: Pick<User, "status">) => user.status === "deactivated";

/** Deactivate (keeps all data, signs every device out), reactivate, or delete on the web. */
export function AccountStatus({
  user,
  onDeactivate,
  onReactivate,
}: {
  user: User;
  onDeactivate: (reason?: string) => Promise<void>;
  onReactivate: () => Promise<void>;
}) {
  useLocale();
  const { confirm, dialog } = useConfirm();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const deleteUrl = deleteAccountUrl();
  const [error, setError] = useState("");
  const deactivated = isDeactivated(user);
  const deletion = user.deletion;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    const ok = await confirm({
      title: t("Deactivate your account?"),
      message: t(
        "Your data is kept. Every device is signed out and notifications stop until you reactivate.",
      ),
      confirmLabel: t("Deactivate"),
    });
    if (ok) await run(() => onDeactivate(reason.trim() || undefined));
  };

  return (
    <section className={styles.section} aria-labelledby="account-status">
      <SectionLabel labelId="account-status">{t("Account status")}</SectionLabel>
      {deletion ? (
        <InlineMessage tone="warning">
          {t("Deletion is scheduled for {p0}. You can undo it on your account page.", {
            p0: formatRelativeTime(Date.parse(deletion.purgeAfter)),
          })}
        </InlineMessage>
      ) : deactivated ? (
        <>
          <InlineMessage tone="warning">
            {t("Your account is deactivated. Devices are signed out and nothing syncs.")}
          </InlineMessage>
          <div className={styles.actions}>
            <Button variant="primary" loading={busy} onClick={() => run(onReactivate)}>
              {t("Reactivate account")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.lead}>
            {t(
              "Deactivating keeps your data, signs all your devices out and silences notifications. You can reactivate any time.",
            )}
          </p>
          <TextareaField
            label={t("Reason (optional)")}
            value={reason}
            maxLength={500}
            minRows={2}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={styles.actions}>
            <Button variant="secondary" loading={busy} onClick={() => deactivate()}>
              {t("Deactivate account…")}
            </Button>
          </div>
        </>
      )}
      {error ? <InlineError>{error}</InlineError> : null}
      {deleteUrl ? (
        <div className={styles.actions}>
          <Button
            variant="danger"
            onClick={() => openExternal(deleteUrl).catch((failure) => setError(errorText(failure)))}
          >
            {t("Delete account…")}
          </Button>
          <span className={styles.meta}>
            {t("Opens your account page. Deletion can be undone for 14 days.")}
          </span>
        </div>
      ) : null}
      {dialog}
    </section>
  );
}

import { DELETION_GRACE_DAYS, type User } from "@bycoda/account-contracts";
import { useState } from "react";
import { dateTimeFormat, getLocale, t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../shared/ui/InlineError";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Group, Row } from "../../settings/public/settingsControls";
import { useDeletion } from "../hooks/useAccountData";

export const isDeactivated = (user: Pick<User, "status">) => user.status === "deactivated";

const longDate = (value: string) =>
  dateTimeFormat(getLocale(), { dateStyle: "long" }).format(new Date(value));

/**
 * Deactivate (keeps all data, signs every device out) or reactivate, and schedule or undo the
 * deletion of the account. Deletion waits out the grace period on the server, so it can be undone.
 */
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
  const { schedule, cancel } = useDeletion();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deactivated = isDeactivated(user);
  const deletion = user.deletion;

  const run = async (action: () => Promise<unknown>) => {
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

  const scheduleDeletion = async () => {
    const ok = await confirm({
      title: t("Delete your bycoda account?"),
      message: t(
        "Your profile, devices, active time, notifications and support requests are deleted after {p0} days. Until then you can undo it here. Sessions, projects and files on your computers are not touched.",
        { p0: DELETION_GRACE_DAYS },
      ),
      confirmLabel: t("Delete account"),
      pendingLabel: t("Scheduling…"),
      tone: "danger",
    });
    if (ok) await run(() => schedule.mutateAsync(reason.trim() || undefined));
  };

  return (
    <>
      <Group
        title={t("Account status")}
        description={t("Pause your account without losing anything, or come back to it.")}
        feedback={error ? <InlineError>{error}</InlineError> : undefined}
      >
        {deactivated ? (
          <Row
            label={t("Deactivated")}
            description={t("Devices are signed out and nothing syncs until you reactivate.")}
          >
            <Button variant="primary" size="sm" loading={busy} onClick={() => run(onReactivate)}>
              {t("Reactivate account")}
            </Button>
          </Row>
        ) : (
          <>
            <Row
              label={t("Deactivate account")}
              description={t(
                "Keeps your data, signs all your devices out and silences notifications. You can reactivate any time.",
              )}
            >
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                disabled={Boolean(deletion)}
                onClick={() => deactivate().catch(() => undefined)}
              >
                {t("Deactivate…")}
              </Button>
            </Row>
            <Row label={t("Reason (optional)")} stacked>
              <TextareaField
                label={t("Reason (optional)")}
                hideLabel
                value={reason}
                maxLength={500}
                minRows={2}
                placeholder={t("Tell us why you are leaving. It helps us improve bycoda.")}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Row>
          </>
        )}
      </Group>
      <Group
        title={t("Delete account")}
        description={t("Removes everything bycoda stores about you after a grace period.")}
      >
        {deletion ? (
          <Row
            label={t("Deletion scheduled")}
            description={t("Your account will be deleted on {p0}.", {
              p0: longDate(deletion.purgeAfter),
            })}
          >
            <Button
              variant="primary"
              size="sm"
              loading={cancel.isPending}
              onClick={() => run(() => cancel.mutateAsync())}
            >
              {t("Keep my account")}
            </Button>
          </Row>
        ) : (
          <Row
            label={t("Delete account")}
            description={t("You have {p0} days to change your mind.", { p0: DELETION_GRACE_DAYS })}
          >
            <Button
              variant="danger"
              size="sm"
              loading={schedule.isPending}
              onClick={() => scheduleDeletion().catch(() => undefined)}
            >
              {t("Delete account…")}
            </Button>
          </Row>
        )}
      </Group>
      {dialog}
    </>
  );
}

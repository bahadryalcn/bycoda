import { DELETION_GRACE_DAYS, type User } from "@bycoda/account-contracts";
import { useRef, useState } from "react";
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
  // Typed inside the confirm dialogs; the dialog body is a snapshot, so the text lives in a ref.
  const reason = useRef("");
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

  const reasonField = (
    <TextareaField
      label={t("Reason (optional)")}
      maxLength={500}
      minRows={2}
      placeholder={t("Tell us why you are leaving. It helps us improve bycoda.")}
      onChange={(event) => {
        reason.current = event.currentTarget.value;
      }}
    />
  );

  const deactivate = async () => {
    reason.current = "";
    const ok = await confirm({
      body: reasonField,
      title: t("Deactivate your account?"),
      message: t(
        "Your data is kept. Every device is signed out and notifications stop until you reactivate.",
      ),
      confirmLabel: t("Deactivate"),
    });
    if (ok) await run(() => onDeactivate(reason.current.trim() || undefined));
  };

  const scheduleDeletion = async () => {
    reason.current = "";
    const ok = await confirm({
      body: reasonField,
      title: t("Delete your bycoda account?"),
      message: t(
        "Your profile, devices, active time, notifications and support requests are deleted after {p0} days. Until then you can undo it here. Sessions, projects and files on your computers are not touched.",
        { p0: DELETION_GRACE_DAYS },
      ),
      confirmLabel: t("Delete account"),
      pendingLabel: t("Scheduling…"),
      tone: "danger",
    });
    if (ok) await run(() => schedule.mutateAsync(reason.current.trim() || undefined));
  };

  return (
    <>
      <Group title={null} feedback={error ? <InlineError>{error}</InlineError> : undefined}>
        {deactivated ? (
          <Row
            label={t("Deactivated")}
            descriptionVisible
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
          </>
        )}
      </Group>
      <Group title={null}>
        {deletion ? (
          <Row
            label={t("Deletion scheduled")}
            descriptionVisible
            description={t("Your account will be deleted on {p0}.", {
              p0: longDate(deletion.purgeAfter),
            })}
          >
            <Button
              variant="secondary"
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
            description={t(
              "Removes everything bycoda stores about you. You have {p0} days to change your mind.",
              { p0: DELETION_GRACE_DAYS },
            )}
          >
            <Button
              tone="danger"
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

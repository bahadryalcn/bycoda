import { useCallback, useState } from "react";
import { SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Row } from "./settingsControls";
import { Check, CircleDashed, AlertCircle } from "../../../shared/ui/icons";

/**
 * Remembers, for this page only, that Save and test accepted the entered credentials.
 * Reading the saved configuration never sets or keeps it: configured is not verified.
 */
export function useConnectionVerification() {
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const markVerified = useCallback(() => setVerifiedAt(Date.now()), []);
  const clearVerified = useCallback(() => setVerifiedAt(null), []);
  return { verifiedAt, markVerified, clearVerified };
}

/** Status reads inspect saved credentials; they do not test provider access. */
export function InboxConnectionStatus({
  checking,
  busy,
  configured,
  verifiedAt = null,
  error,
  onCheck,
}: {
  checking: boolean;
  busy: boolean;
  configured: boolean;
  /** When Save and test last accepted credentials in this session; null when unknown. */
  verifiedAt?: number | null;
  error: string | null;
  onCheck: () => void;
}) {
  useLocale();
  const verified = configured && verifiedAt !== null && !checking && !error;
  return (
    <Row
      label={t("Connection status")}
      description={t(
        "Checking reads the saved configuration and does not test access. Save and test verifies the credentials you enter; Verified applies to this visit only.",
      )}
      feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
    >
      <Badge
        tone={error ? "danger" : verified ? "success" : "neutral"}
        icon={
          error ? (
            <AlertCircle size={14} />
          ) : configured && !checking ? (
            <Check size={14} />
          ) : (
            <CircleDashed size={14} />
          )
        }
        role="status"
        aria-live="polite"
        className="inbox-connection-status"
        data-state={
          checking ? "checking" : error ? "error" : verified ? "verified" : configured ? "configured" : "idle"
        }
      >
        {checking
          ? t("Checking")
          : error
            ? t("Check failed")
            : verified
              ? t("Verified at {p0}", {
                  p0: new Date(verifiedAt ?? 0).toLocaleTimeString([], { timeStyle: "short" }),
                })
              : configured
                ? t("Configured")
                : t("Not configured")}
      </Badge>
      <Button className="shrink-0" loading={checking} disabled={busy} onClick={onCheck}>
        {error ? t("Retry") : t("Check saved configuration")}
      </Button>
    </Row>
  );
}

export function InboxConnectionError({ error }: { error: string | null }) {
  return error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null;
}

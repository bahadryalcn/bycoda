import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Row } from "./settingsControls";
import { Check, CircleDashed, AlertCircle } from "../../../shared/ui/icons";

/** Status reads inspect saved credentials; they do not test provider access. */
export function InboxConnectionStatus({
  checking,
  busy,
  configured,
  error,
  onCheck,
}: {
  checking: boolean;
  busy: boolean;
  configured: boolean;
  error: string | null;
  onCheck: () => void;
}) {
  useLocale();
  return (
    <Row
      label={t("Connection status")}
      description={t(
        "Checking reads the saved configuration. Save and test verifies access with the credentials you enter.",
      )}
    >
      <Badge
        tone={error ? "danger" : configured && !checking ? "success" : "neutral"}
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
        data-state={checking ? "checking" : error ? "error" : configured ? "configured" : "idle"}
      >
        {checking
          ? t("Checking")
          : error
            ? t("Check failed")
            : configured
              ? t("Configured")
              : t("Not configured")}
      </Badge>
      <SecondaryButton disabled={busy || checking} onClick={onCheck}>
        {error ? t("Retry") : t("Check saved configuration")}
      </SecondaryButton>
    </Row>
  );
}

export function InboxConnectionError({ error }: { error: string | null }) {
  return error ? (
    <Alert tone="danger" role="alert">
      {error}
    </Alert>
  ) : null;
}

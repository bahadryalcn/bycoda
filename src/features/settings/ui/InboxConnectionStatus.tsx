import { t, useLocale } from "../../../shared/i18n";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Row } from "./settingsControls";

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
      scope={t("This computer · Inbox account")}
      description={t(
        "Checking reads the saved configuration. Save and test verifies access with the credentials you enter.",
      )}
    >
      <span role="status" aria-live="polite" className="text-[12px] text-content/65">
        {checking
          ? t("Checking")
          : error
            ? t("Check failed")
            : configured
              ? t("Configured")
              : t("Not configured")}
      </span>
      <SecondaryButton disabled={busy || checking} onClick={onCheck}>
        {error ? t("Retry") : t("Check saved configuration")}
      </SecondaryButton>
    </Row>
  );
}

export function InboxConnectionError({ error }: { error: string | null }) {
  return error ? (
    <p
      role="alert"
      className="px-4 [padding-block:0.75rem] text-[12px] text-danger/90 whitespace-pre-wrap break-words"
    >
      {error}
    </p>
  ) : null;
}

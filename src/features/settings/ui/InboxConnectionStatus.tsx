import { Text } from "../../../shared/ui/Text";
import { useCallback, useState } from "react";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Modal } from "../../../shared/ui/Modal";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Row } from "../../../shared/ui/settings";
import { MoreHorizontal, Check, CircleDashed, AlertCircle } from "../../../shared/ui/icons";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";

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
  if (!verified && !error) return null;
  return (
    <Row
      label={t("Connection status")}
      info={t(
        "Checking reads the saved configuration and does not test access. Save and test verifies the credentials you enter; Verified applies to this visit only.",
      )}
      feedback={
        error ? (
          <SettingsFeedback
            state="error"
            extra={<ErrorDetails title={t("Connection check failed.")} detail={error} />}
          >
            {t("Connection check failed.")}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Tooltip
        label={
          verifiedAt
            ? t("Verified at {p0}", {
                p0: new Date(verifiedAt).toLocaleTimeString([], { timeStyle: "short" }),
              })
            : undefined
        }
      >
        <Badge
          size="sm"
          appearance="subtle"
          aria-busy={checking || undefined}
          tone={error ? "danger" : verified ? "success" : "neutral"}
          icon={
            checking ? (
              <Spinner size="sm" />
            ) : error ? (
              <AlertCircle className="icon-sm" />
            ) : configured && !checking ? (
              <Check className="icon-sm" />
            ) : (
              <CircleDashed className="icon-sm" />
            )
          }
          data-state={
            checking
              ? "checking"
              : error
                ? "error"
                : verified
                  ? "verified"
                  : configured
                    ? "configured"
                    : "idle"
          }
        >
          {error
            ? t("Check failed")
            : configured
              ? verified
                ? t("Verified")
                : t("Configured")
              : t("Not configured")}
        </Badge>
      </Tooltip>
      {error ? (
        <Button disabled={busy || checking} onClick={onCheck}>
          {t("Retry")}
        </Button>
      ) : null}
    </Row>
  );
}

/**
 * The Account row's content before the first status read finishes. Neither the connected summary
 * nor the credential form is known yet; showing either would swap layouts when the read lands.
 */
export function InboxAccountChecking() {
  return (
    <div className="inbox-account-fields" data-state="summary">
      <Skeleton inline width="12rem" />
    </div>
  );
}

export function InboxConnectionError({ error }: { error: string | null }) {
  if (!error) return null;
  const title = t("The inbox request did not complete.");
  return (
    <SettingsFeedback state="error" extra={<ErrorDetails title={title} detail={error} />}>
      {title}
    </SettingsFeedback>
  );
}

/** Account actions keep credential deletion behind an explicit confirmation. */
export function InboxAccountActions({
  disabled,
  loading,
  onDisconnect,
}: {
  disabled: boolean;
  loading: boolean;
  onDisconnect: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        iconOnly
        variant="ghost"
        label={t("Account actions")}
        disabled={disabled}
        loading={loading}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <MoreHorizontal className="icon-md" />
      </Button>
      {anchor ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Account actions")}
          items={[{ kind: "item", id: "disconnect", label: t("Disconnect"), danger: true }]}
          onClose={() => setAnchor(null)}
          onPick={() => {
            setAnchor(null);
            setConfirming(true);
          }}
        />
      ) : null}
      {confirming ? (
        <Modal
          title={t("Disconnect account?")}
          size="sm"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
              <Button
                tone="danger"
                onClick={() => {
                  setConfirming(false);
                  onDisconnect();
                }}
              >
                {t("Disconnect")}
              </Button>
            </>
          }
        >
          <Text as="p" size="secondary" tone="inherit">
            {t("Saved credentials will be removed from this computer.")}
          </Text>
        </Modal>
      ) : null}
    </>
  );
}

import { useCallback, useState } from "react";
import { SettingsFeedback } from "./settingsControls";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Modal } from "../../../shared/ui/Modal";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Row } from "./settingsControls";
import { Loader, MoreHorizontal, Check, CircleDashed, AlertCircle } from "../../../shared/ui/icons";

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
      info={t(
        "Checking reads the saved configuration and does not test access. Save and test verifies the credentials you enter; Verified applies to this visit only.",
      )}
      feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
    >
      <Badge
        minWidth="16ch"
        title={verifiedAt ? t("Verified at {p0}", { p0: new Date(verifiedAt).toLocaleTimeString([], { timeStyle: "short" }) }) : undefined}
        aria-busy={checking || undefined}
        tone={error ? "danger" : verified ? "success" : "neutral"}
        icon={
          checking ? (
            <Loader size={14} className="motion-safe:animate-spin" />
          ) : error ? (
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
        {error ? t("Check failed") : configured ? verified ? t("Verified") : t("Configured") : t("Not configured")}
      </Badge>
      <Button stableWidth className="shrink-0" loading={checking} disabled={busy} onClick={onCheck}>
        {error ? t("Retry") : t("Check saved configuration")}
      </Button>
    </Row>
  );
}

export function InboxConnectionError({ error }: { error: string | null }) {
  return error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null;
}

/** Account actions keep credential deletion behind an explicit confirmation. */
export function InboxAccountActions({ disabled, loading, onDisconnect }: {
  disabled: boolean; loading: boolean; onDisconnect: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  return <>
    <Button iconOnly variant="ghost" label={t("Account actions")} disabled={disabled} loading={loading}
      aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(event.currentTarget)}>
      <MoreHorizontal size={16} />
    </Button>
    {anchor ? <DropdownMenu anchor={anchor} label={t("Account actions")}
      items={[{ kind: "item", id: "disconnect", label: t("Disconnect"), danger: true }]}
      onClose={() => setAnchor(null)} onPick={() => { setAnchor(null); setConfirming(true); }} /> : null}
    {confirming ? <Modal title={t("Disconnect account?")} size="sm" onClose={() => setConfirming(false)}
      footer={<><Button onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
        <Button tone="danger" onClick={() => { setConfirming(false); onDisconnect(); }}>{t("Disconnect")}</Button></>}>
      <p className="p-4 text-ui-secondary">{t("Saved credentials will be removed from this computer.")}</p>
    </Modal> : null}
  </>;
}

import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { RefreshCw } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState, useSyncExternalStore } from "react";
import { OPEN_CONNECTIONS_EVENT, requestMachineEdit } from "../model/connections";
import { connectionOutcome, needsSignIn } from "../model/remoteConnection";
import type { RemoteFailure } from "../model/remoteFailure";
import { useRemoteConnection } from "../model/useRemoteConnection";
import { useRemoteConnectionFeedback } from "./RemoteConnectionFeedback";
import { LoadingText } from "../../../shared/ui/LoadingText";
import {
  loadRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../../settings/public/settings";

/** One compact, inline explanation of why a remote project's data could not be
 * loaded, with what the user can do about it. `stale` says older data is still
 * shown (dimmed) below it. */
export function RemoteLoadError({
  cwd,
  failure,
  stale = false,
  onRetry,
  compact = false,
  coordinated = true,
}: {
  cwd: string;
  failure: RemoteFailure;
  stale?: boolean;
  onRetry?: () => void;
  compact?: boolean;
  /** The workspace notice renders the single shared recovery control. */
  coordinated?: boolean;
}) {
  useLocale();
  const { machine, status, reconnecting, reconnect } = useRemoteConnection(cwd);
  const [reconnectError, setReconnectError] = useState("");
  const shared = useRemoteConnectionFeedback(coordinated ? cwd : undefined, failure);
  const autoReconnect = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  if (shared) {
    if (stale) return null;
    const outcome = connectionOutcome(failure.message).status;
    const retrying =
      reconnecting ||
      (autoReconnect &&
        (status === "connecting" ||
          status === "connected" ||
          status === "unreachable" ||
          status === "host-not-running") &&
        (outcome === "unreachable" || outcome === "host-not-running"));
    return retrying ? (
      <LoadingText>{t("Connecting…")}</LoadingText>
    ) : (
      <p role="status" className="text-ui-caption text-(--ui-text-muted)">
        {t("Not connected")}
      </p>
    );
  }
  const name = machine?.name ?? t("this machine");
  const title =
    failure.kind === "unreachable"
      ? t("Can’t reach {p0}", { p0: name })
      : failure.kind === "outdated"
        ? t("{p0} Host on {p1} needs an update", {
            p0: PRODUCT_IDENTITY.displayName,
            p1: name,
          })
        : t("Couldn’t load from the machine");
  const needsAuth = needsSignIn(status);
  const startReconnect = () => {
    setReconnectError("");
    void reconnect({ signIn: true }).then((result) => {
      if (!result.ok) setReconnectError(result.error);
    });
  };
  const openConnections = () => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
  const actions = (
    <>
      {failure.kind === "unreachable" && machine ? (
        <Button
          type="button"
          variant="primary"
          startIcon={<RefreshCw className="icon-sm" aria-hidden />}
          loading={reconnecting}
          reserveLabels={[t("Reconnecting…")]}
          onClick={startReconnect}
        >
          {reconnecting
            ? t("Reconnecting…")
            : needsAuth
              ? t("Sign in and reconnect")
              : t("Reconnect")}
        </Button>
      ) : null}
      {failure.kind === "unreachable" && machine?.ssh ? (
        <Button type="button" variant="secondary" onClick={() => requestMachineEdit(machine.id)}>
          {t("Edit address…")}
        </Button>
      ) : null}
      {failure.kind === "unreachable" ||
      failure.kind === "outdated" ||
      failure.kind === "identity" ? (
        <Button type="button" variant="secondary" onClick={openConnections}>
          {t("Connection settings")}
        </Button>
      ) : null}
      {failure.kind === "other" && onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t("Retry")}
        </Button>
      ) : null}
    </>
  );
  const reconnectFailed = reconnectError && reconnectError !== failure.message;
  return (
    <Alert role="alert" tone="warning" title={title} action={actions}>
      {compact ? (
        <details>
          <summary className="w-fit cursor-pointer select-none hover:text-content">
            {t("Details")}
          </summary>
          <p className="mt-1 break-words">{failure.message}</p>
        </details>
      ) : (
        <p className="break-words">{failure.message}</p>
      )}
      {reconnectFailed ? (
        <p className="mt-1 break-words">
          {t("Reconnecting failed: ")}
          {reconnectError}
        </p>
      ) : null}
      {stale ? <p className="mt-1">{t("Showing what was last loaded.")}</p> : null}
    </Alert>
  );
}

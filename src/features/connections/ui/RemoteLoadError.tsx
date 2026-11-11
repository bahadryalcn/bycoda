import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { RefreshCw } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState } from "react";
import { OPEN_CONNECTIONS_EVENT, requestMachineEdit } from "../model/connections";
import { needsSignIn } from "../model/remoteConnection";
import { SUPERSEDED_CONNECTION } from "../model/remoteLifecycle";
import type { RemoteFailure } from "../model/remoteFailure";
import { useRemoteConnection } from "../model/useRemoteConnection";
import { useRemoteConnectionFeedback } from "./RemoteConnectionFeedback";
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
  onDismiss,
}: {
  cwd: string;
  failure: RemoteFailure;
  stale?: boolean;
  onRetry?: () => void;
  compact?: boolean;
  /** The workspace notice renders the single shared recovery control. */
  coordinated?: boolean;
  onDismiss?: () => void;
}) {
  useLocale();
  const { machine, status, reconnecting, reconnect } = useRemoteConnection(cwd);
  const [reconnectError, setReconnectError] = useState("");
  const shared = useRemoteConnectionFeedback(coordinated ? cwd : undefined, failure);
  if (shared) return null;
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
      // Cancel or an address edit superseded this attempt: its outcome is not a failure.
      if (!result.ok && result.error !== SUPERSEDED_CONNECTION) setReconnectError(result.error);
    });
  };
  const openConnections = () => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
  /** `after` closes the details popover before another surface opens. */
  const secondaryActions = (after?: () => void) => (
    <>
      {failure.kind === "unreachable" && machine?.ssh ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            after?.();
            requestMachineEdit(machine.id);
          }}
        >
          {t("Edit address…")}
        </Button>
      ) : null}
      {failure.kind === "unreachable" ||
      failure.kind === "outdated" ||
      failure.kind === "identity" ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            after?.();
            openConnections();
          }}
        >
          {t("Connection settings")}
        </Button>
      ) : null}
    </>
  );
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
      {!compact ? secondaryActions() : null}
      {failure.kind === "other" && onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t("Retry")}
        </Button>
      ) : null}
    </>
  );
  const reconnectFailed = reconnectError && reconnectError !== failure.message;
  if (compact) {
    // One stable row: the raw transport text stays behind Details, never in the bar.
    return (
      <Alert tone="warning" inline onDismiss={onDismiss} dismissLabel={`${t("Dismiss")}: ${title}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-remote-feedback-row>
          <strong className="min-w-0">{title}</strong>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
          {failure.message ? (
            <ErrorDetails title={title} detail={failure.message} actions={secondaryActions} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">{secondaryActions()}</div>
          )}
        </div>
        {reconnectFailed ? (
          <p className="mt-1 flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate">
              {t("Reconnecting failed: ")}
              {reconnectError}
            </span>
            <ErrorDetails
              className="shrink-0"
              title={t("Reconnecting failed: ")}
              detail={reconnectError}
            />
          </p>
        ) : null}
        {stale ? <p className="mt-1">{t("Showing what was last loaded.")}</p> : null}
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={title} action={actions} onDismiss={onDismiss}>
      <p className="break-words">{failure.message}</p>
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

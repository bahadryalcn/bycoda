import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState } from "react";
import { Loader } from "../../../shared/ui/icons";
import { OPEN_CONNECTIONS_EVENT, requestMachineEdit } from "../model/connections";
import { needsSignIn } from "../model/remoteConnection";
import type { RemoteFailure } from "../model/remoteFailure";
import { useRemoteConnection } from "../model/useRemoteConnection";

/** One compact, inline explanation of why a remote project's data could not be
 * loaded, with what the user can do about it. `stale` says older data is still
 * shown (dimmed) below it. */
export function RemoteLoadError({
  cwd,
  failure,
  stale = false,
  onRetry,
  compact = false,
}: {
  cwd: string;
  failure: RemoteFailure;
  stale?: boolean;
  onRetry?: () => void;
  compact?: boolean;
}) {
  useLocale();
  const { machine, status, reconnecting, reconnect } = useRemoteConnection(cwd);
  const [reconnectError, setReconnectError] = useState("");
  const name = machine?.name ?? t("this machine");
  const title =
    failure.kind === "unreachable"
      ? t("Can’t reach {p0}", { p0: name })
      : failure.kind === "outdated"
        ? t("{p0} Host on {p1} needs an update", { p0: PRODUCT_IDENTITY.displayName, p1: name })
        : t("Couldn’t load from the machine");
  const needsAuth = needsSignIn(status);
  const startReconnect = () => {
    setReconnectError("");
    void reconnect({ signIn: true }).then((result) => {
      if (!result.ok) setReconnectError(result.error);
    });
  };
  const openConnections = () => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
  return (
    <Alert role="alert" tone="warning">
      <p className="font-medium text-content">{title}</p>
      {compact ? (
        <details className="text-(--ui-text-muted)">
          <summary className="cursor-pointer text-ui-micro hover:text-content">
            {t("Details")}
          </summary>
          <p className="mt-1 break-words">{failure.message}</p>
        </details>
      ) : (
        <p className="break-words text-(--ui-text-muted)">{failure.message}</p>
      )}
      {reconnectError && reconnectError !== failure.message ? (
        <p className="break-words text-(--ui-text-muted)">
          {t("Reconnecting failed: ")}
          {reconnectError}
        </p>
      ) : null}
      {stale ? (
        <p className="text-(--ui-text-muted)">{t("Showing what was last loaded.")}</p>
      ) : null}
      <div className="mt-0.5 flex flex-wrap gap-1.5">
        {failure.kind === "unreachable" && machine ? (
          <Button
            type="button"

            disabled={reconnecting}
            onClick={startReconnect}
            variant="primary"
          >
            {reconnecting ? (
              <Loader className="icon-xs motion-safe:animate-spin" aria-hidden="true" />
            ) : null}
            {reconnecting
              ? t("Reconnecting…")
              : needsAuth
                ? t("Sign in and reconnect")
                : t("Reconnect")}
          </Button>
        ) : null}
        {failure.kind === "unreachable" && machine?.ssh ? (
          <Button type="button" onClick={() => requestMachineEdit(machine.id)} variant="secondary">
            {t("Edit address…")}
          </Button>
        ) : null}
        {failure.kind === "unreachable" ||
        failure.kind === "outdated" ||
        failure.kind === "identity" ? (
          <Button type="button" onClick={openConnections} variant="secondary">
            {t("Connection settings")}
          </Button>
        ) : null}
        {failure.kind === "other" && onRetry ? (
          <Button type="button" onClick={onRetry} variant="secondary">
            {t("Retry")}
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

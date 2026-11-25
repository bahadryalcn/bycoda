import { Alert } from "../../../shared/ui/Alert";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { NoticeButton, NoticeLink, type NoticeAction } from "../../../shared/ui/Notice";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
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
 * loaded, with what the user can do about it. Older data that is still shown
 * dimmed below it needs no sentence of its own. */
export function RemoteLoadError({
  cwd,
  failure,
  onRetry,
  compact = false,
  coordinated = true,
  onDismiss,
  recovering = false,
}: {
  cwd: string;
  failure: RemoteFailure;
  /** Accepted for callers that pass it; the dimmed data already says so. */
  stale?: boolean;
  onRetry?: () => void;
  compact?: boolean;
  /** The machine's session notice renders the single shared recovery control. */
  coordinated?: boolean;
  onDismiss?: () => void;
  /** Session machine notice while automatic recovery handles a short outage. */
  recovering?: boolean;
}) {
  useLocale();
  const { machine, status, reconnecting, reconnect } = useRemoteConnection(cwd);
  const [reconnectError, setReconnectError] = useState("");
  const shared = useRemoteConnectionFeedback(coordinated ? cwd : undefined, failure);
  if (shared) return null;
  if (recovering)
    return (
      <InlineMessage tone="info">
        {machine?.name ?? t("this machine")} · {t("Reconnecting…")}
      </InlineMessage>
    );
  const name = machine?.name ?? t("this machine");
  const title =
    failure.kind === "unreachable"
      ? t("Can’t reach {p0}", { p0: name })
      : failure.kind === "outdated"
        ? t("{p0} Host on {p1} needs an update", {
            p0: PRODUCT_IDENTITY.displayName,
            p1: name,
          })
        : failure.kind === "identity"
          ? t("{p0}’s identity changed", { p0: name })
          : failure.kind === "temporary"
            ? t("{p0} is busy right now", { p0: name })
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
  const secondaryActions = (after?: () => void): NoticeAction[] => [
    ...(failure.kind === "unreachable" && machine?.ssh
      ? [
          {
            label: t("Edit address…"),
            onClick: () => {
              after?.();
              requestMachineEdit(machine.id);
            },
          },
        ]
      : []),
    ...(failure.kind === "unreachable" || failure.kind === "outdated"
      ? [
          {
            label: t("Connection settings"),
            onClick: () => {
              after?.();
              openConnections();
            },
          },
        ]
      : []),
  ];
  const primary: NoticeAction | undefined =
    failure.kind === "unreachable" && machine
      ? {
          label: reconnecting
            ? t("Reconnecting…")
            : needsAuth
              ? t("Sign in and reconnect")
              : t("Reconnect"),
          onClick: startReconnect,
          pending: reconnecting,
        }
      : failure.kind === "identity"
        ? // Reconnecting cannot clear a changed identity: only the owner re-pairs the machine.
          { label: t("Review in Connections"), onClick: openConnections }
        : failure.kind === "other" && onRetry
          ? { label: t("Retry"), onClick: onRetry }
          : undefined;
  const reconnectFailed = reconnectError && reconnectError !== failure.message;
  if (compact) {
    // One stable row: the raw transport text stays behind Details, never in the bar.
    const dismiss: NoticeAction | undefined = onDismiss
      ? { label: t("Dismiss"), onClick: onDismiss }
      : undefined;
    const [first, second] = [primary, dismiss].filter((item) => item !== undefined);
    return (
      <InlineMessage
        tone="warning"
        data-remote-feedback-row
        action={first}
        secondaryAction={second}
        extra={
          failure.message ? (
            <ErrorDetails
              title={title}
              detail={failure.message}
              actions={(close) => secondaryActions(close).map(renderButton)}
            />
          ) : (
            <>
              {secondaryActions().map((item) => (
                <NoticeLink key={item.label} action={item} />
              ))}
            </>
          )
        }
      >
        <strong>{title}</strong>
        {reconnectFailed ? (
          <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
            {t("Reconnecting failed")}
            <ErrorDetails
              className="shrink-0"
              title={t("Reconnecting failed")}
              detail={reconnectError}
            />
          </span>
        ) : null}
      </InlineMessage>
    );
  }
  // Up to three follow-ups: two structured slots plus the third as a small button in `extra`.
  const [first, second, third] = [primary, ...secondaryActions()].filter(
    (item) => item !== undefined,
  );
  return (
    <Alert
      tone="warning"
      title={title}
      action={first}
      secondaryAction={second}
      extra={
        <>
          {failure.message ? <ErrorDetails title={title} detail={failure.message} /> : null}
          {third ? <NoticeButton action={third} /> : null}
        </>
      }
      onDismiss={onDismiss}
    >
      {reconnectFailed ? (
        <InlineMessage
          tone="warning"
          extra={<ErrorDetails title={t("Reconnecting failed")} detail={reconnectError} />}
        >
          {t("Reconnecting failed")}
        </InlineMessage>
      ) : null}
    </Alert>
  );
}

function renderButton(item: NoticeAction) {
  return <NoticeButton key={item.label} action={item} />;
}

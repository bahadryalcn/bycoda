import { useState } from "react";
import { redactDiagnosticText } from "@bycoda/account-contracts";
import { Text } from "../../../shared/ui/Text";
import { Toast } from "../../../shared/ui/ToastRegion";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { useDelayedVisible } from "../../../shared/hooks/useDelayedVisible";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Check, RefreshCw, Server } from "../../../shared/ui/icons";
import type { RemoteDataState } from "../model/remoteDataState";
import { sanitizeConnectionError } from "../model/connectionReason";
import {
  classifyRemoteError,
  describeRemoteError,
  isConnectionFailure,
  isTransientTransportError,
} from "../model/remoteFailure";
import { useGracedFailure } from "../model/transientFailure";
import { useRemoteConnectionFeedback } from "./RemoteConnectionFeedback";

/** Retained content stays visible; this strip explains whether it was verified. */
export function RemoteDataStatus({
  state,
  cwd,
  onRefresh,
  label,
  disabled = false,
  connectionIssueHandled = false,
  presentation = "auto",
  machineName,
  machineLabel,
  autoRetry = true,
}: {
  state: RemoteDataState;
  /** The data's owning remote project, for the workspace connection notice. */
  cwd?: string;
  onRefresh?: () => void;
  label?: string;
  disabled?: boolean;
  /** The shared connection notice already explains why this data cannot refresh. */
  connectionIssueHandled?: boolean;
  /** Place routine health in an existing toolbar; keep actionable warnings in the body. */
  presentation?: "auto" | "indicator" | "notice";
  /** Keep remote identity in a project heading, with freshness in its tooltip. */
  machineName?: string;
  /** The machine this data belongs to, named in the floating notice and its details. */
  machineLabel?: string;
  /** Paired toolbar and notice displays share one read owner. */
  autoRetry?: boolean;
}) {
  useLocale();
  // A first load that ends quickly never shows its indicator; a background refresh only spins
  // inside the refresh button.
  const loadingShown = useDelayedVisible(state.phase === "loading");
  // The notice the owner closed; a different phase, error or verification time shows again.
  const [dismissed, setDismissed] = useState("");
  const noticeKey = JSON.stringify([state.phase, state.error ?? "", state.updatedAt ?? 0]);
  const failure = state.error ? classifyRemoteError(state.error) : undefined;
  const sharedConnectionIssue = useRemoteConnectionFeedback(cwd, failure);
  // A busy machine is retried in the background; its failure is not an error yet.
  const { pending, visibleError } = useGracedFailure({
    error: state.error,
    retry: disabled || !autoRetry ? undefined : onRefresh,
    loading: state.phase === "loading" || state.phase === "refreshing",
    scope: cwd,
  });
  // A machine-level notice cannot explain a failed data/service operation.
  if (
    !machineName &&
    ((connectionIssueHandled && !failure) ||
      (failure &&
        isConnectionFailure(failure) &&
        (connectionIssueHandled || sharedConnectionIssue)))
  )
    return null;
  const dataLabel = label ?? t("conversation");
  // The classified, localized reason; the raw transport text stays behind Details.
  const replacedError = !!state.error && isTransientTransportError(state.error);
  const errorView = state.error ? describeRemoteError(state.error) : undefined;
  const shownError = visibleError;
  const busy = pending || state.phase === "loading" || state.phase === "refreshing";
  const needsAttention = !pending && (state.phase === "error" || state.phase === "stale");
  const message =
    machineName &&
    (connectionIssueHandled || sharedConnectionIssue) &&
    !failure &&
    (state.phase === "ready" || state.phase === "empty")
      ? state.updatedAt
        ? t("Showing last loaded data. Updates have not been verified.")
        : t("Couldn’t refresh {p0}. Data has not been verified.", { p0: dataLabel })
      : pending
        ? t("The machine is busy. Retrying…")
        : state.phase === "loading"
          ? t("Loading {p0}…", { p0: dataLabel })
          : state.phase === "refreshing"
            ? t("Refreshing {p0}… Showing last loaded data.", { p0: dataLabel })
            : state.phase === "error"
              ? state.updatedAt
                ? t("Couldn’t refresh {p0}. Showing last loaded data.", { p0: dataLabel })
                : t("Couldn’t refresh {p0}. Data has not been verified.", { p0: dataLabel })
              : state.phase === "stale"
                ? presentation === "notice"
                  ? t("Showing last loaded {p0}. Updates have not been verified.", {
                      p0: dataLabel,
                    })
                  : t("Showing last loaded data. Updates have not been verified.")
                : state.phase === "empty"
                  ? t("No {p0}.", { p0: dataLabel })
                  : t("Up to date");
  const time = state.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : undefined;
  if (state.phase === "loading" && !loadingShown && !machineName) return null;
  if (presentation === "notice" && !needsAttention) return null;
  if (presentation === "indicator" && needsAttention && !machineName) return null;
  if (!needsAttention || (presentation === "indicator" && machineName)) {
    const detail = `${machineName ? `${machineName} · ` : ""}${message}${time ? ` · ${t("Last verified {p0}", { p0: new Date(state.updatedAt!).toLocaleString(getLocale()) })}` : ""}`;
    const spinning =
      pending ||
      (state.phase === "loading" && loadingShown) ||
      (state.phase === "refreshing" && onRefresh !== undefined);
    const icon = spinning ? (
      <Spinner />
    ) : machineName ? (
      <Server aria-hidden className="icon-sm" />
    ) : (
      <Check aria-hidden className="icon-sm" />
    );
    return (
      <Text
        data-remote-data-state={state.phase}
        size="inherit"
        tone="muted"
        className="inline-flex shrink-0 items-center"
        aria-busy={busy}
      >
        {(!machineName || (!connectionIssueHandled && !sharedConnectionIssue)) &&
        (state.phase !== "loading" || loadingShown) ? (
          <span role="status" className="sr-only">
            {detail}
          </span>
        ) : null}
        {onRefresh ? (
          <Button
            variant="ghost"
            iconOnly
            data-tauri-drag-region="false"
            label={t("Refresh {p0}", { p0: dataLabel })}
            tooltip={detail}
            onClick={onRefresh}
            disabled={disabled || busy}
          >
            {icon}
          </Button>
        ) : (
          <Tooltip label={detail}>
            <span aria-label={detail} role="img">
              {icon}
            </span>
          </Tooltip>
        )}
      </Text>
    );
  }
  const tone = state.phase === "error" ? "danger" : "info";
  const retryLabel =
    state.phase === "error"
      ? t("Retry loading {p0}", { p0: dataLabel })
      : t("Refresh {p0}", { p0: dataLabel });
  // A floating notice joins the shared alert stack (errors at top center) and can be closed;
  // the same state comes back only once it changes.
  if (presentation === "notice") {
    if (dismissed === noticeKey) return null;
    // Which machine and which data, when it was last verified and why it failed: technical
    // lines behind Details, so cards of different data or times stay distinguishable.
    const noticeDetails = noticeDetailLines({
      machine: machineLabel ?? machineName,
      data: dataLabel,
      verifiedAt: state.updatedAt,
      reason: errorView
        ? sanitizeConnectionError(redactDiagnosticText(errorView.details))
        : undefined,
    });
    return (
      <Toast
        tone={tone}
        title={machineLabel ?? machineName ?? dataLabel}
        message={
          <span data-remote-data-state={state.phase} aria-busy={busy}>
            {message}
            {shownError && fitsOneLine(shownError) ? (
              <Text as="p" size="inherit" tone="muted" className="mt-1 break-words">
                {shownError}
              </Text>
            ) : null}
          </span>
        }
        historyMessage={`${message}\n${noticeDetails}`}
        durationMs={null}
        extra={<ErrorDetails title={message} detail={noticeDetails} />}
        action={
          onRefresh
            ? {
                label: state.phase === "error" ? t("Retry") : t("Refresh"),
                ariaLabel: retryLabel,
                onClick: onRefresh,
                pending: busy,
                disabled: disabled || busy,
              }
            : undefined
        }
        onDismiss={() => setDismissed(noticeKey)}
      />
    );
  }
  return (
    <Alert
      data-remote-data-state={state.phase}
      aria-busy={busy}
      tone={tone}
      icon={busy ? <Spinner /> : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span>{message}</span>
          {time ? (
            <Tooltip
              label={t("Last verified {p0}", {
                p0: new Date(state.updatedAt!).toLocaleString(getLocale()),
              })}
            >
              <Text size="inherit" tone="muted" className="ml-1">
                · {time}
              </Text>
            </Tooltip>
          ) : null}
          {shownError ? (
            <>
              {fitsOneLine(shownError) ? (
                <Text as="p" size="inherit" tone="muted" className="mt-1 break-words">
                  {shownError}
                </Text>
              ) : (
                <p className="mt-1">
                  <ErrorDetails title={message} detail={shownError} />
                </p>
              )}
              {replacedError && fitsOneLine(shownError) ? (
                <p className="mt-1">
                  <ErrorDetails title={message} detail={errorView?.details ?? shownError} />
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {onRefresh ? (
          <Button
            type="button"
            onClick={onRefresh}
            disabled={disabled || busy}
            aria-label={retryLabel}
            variant="ghost"
            iconOnly
            loading={busy}
            label={retryLabel}
          >
            <RefreshCw aria-hidden className="icon-sm" />
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

/** The identity, last verification and reason of a data notice, one line each. */
export function noticeDetailLines(input: {
  machine?: string;
  data: string;
  verifiedAt?: number;
  reason?: string;
}): string {
  return [
    input.machine ? `machine: ${input.machine}` : "",
    `data: ${input.data}`,
    input.verifiedAt ? `last verified: ${isoTimestamp(input.verifiedAt) ?? ""}` : "",
    input.reason ? `reason: ${input.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

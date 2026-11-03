import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Check, RefreshCw } from "../../../shared/ui/icons";
import type { RemoteDataState } from "../model/remoteDataState";
import { classifyRemoteError, isConnectionFailure } from "../model/remoteFailure";
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
}) {
  useLocale();
  const failure = state.error ? classifyRemoteError(state.error) : undefined;
  const sharedConnectionIssue = useRemoteConnectionFeedback(cwd, failure);
  // A machine-level notice cannot explain a failed data/service operation.
  if (
    (connectionIssueHandled && !failure) ||
    (failure && isConnectionFailure(failure) && (connectionIssueHandled || sharedConnectionIssue))
  )
    return null;
  const dataLabel = label ?? t("conversation");
  const busy = state.phase === "loading" || state.phase === "refreshing";
  const needsAttention = state.phase === "error" || state.phase === "stale";
  const message =
    state.phase === "loading"
      ? t("Loading {p0}…", { p0: dataLabel })
      : state.phase === "refreshing"
        ? t("Refreshing {p0}… Showing last loaded data.", { p0: dataLabel })
        : state.phase === "error"
          ? state.updatedAt
            ? t("Couldn’t refresh {p0}. Showing last loaded data.", { p0: dataLabel })
            : t("Couldn’t refresh {p0}. Data has not been verified.", { p0: dataLabel })
          : state.phase === "stale"
            ? t("Showing last loaded data. Updates have not been verified.")
            : state.phase === "empty"
              ? t("No {p0}.", { p0: dataLabel })
              : t("Up to date");
  const time = state.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : undefined;
  if (presentation === "notice" && !needsAttention) return null;
  if (presentation === "indicator" && needsAttention) return null;
  if (!needsAttention) {
    const detail = `${message}${time ? ` · ${t("Last verified {p0}", { p0: new Date(state.updatedAt!).toLocaleString(getLocale()) })}` : ""}`;
    const icon = busy ? <Spinner /> : <Check aria-hidden className="icon-sm" />;
    return (
      <span
        data-remote-data-state={state.phase}
        className="inline-flex shrink-0 items-center text-(--ui-text-muted)"
        aria-busy={busy}
      >
        <span role="status" className="sr-only">
          {detail}
        </span>
        {onRefresh ? (
          <Button
            variant="ghost"
            iconOnly
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
      </span>
    );
  }
  return (
    <Alert
      data-remote-data-state={state.phase}
      aria-live="polite"
      aria-busy={busy}
      role={state.phase === "error" ? "alert" : "group"}
      tone={state.phase === "error" ? "danger" : "info"}
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
              <span className="ml-1 text-(--ui-text-muted)">· {time}</span>
            </Tooltip>
          ) : null}
          {state.error ? (
            <p className="mt-1 break-words text-(--ui-text-muted)">{state.error}</p>
          ) : null}
        </div>
        {onRefresh ? (
          <Button
            type="button"
            onClick={onRefresh}
            disabled={disabled || busy}
            aria-label={
              state.phase === "error"
                ? t("Retry loading {p0}", { p0: dataLabel })
                : t("Refresh {p0}", { p0: dataLabel })
            }
            variant="ghost"
            iconOnly
            loading={busy}
            label={
              state.phase === "error"
                ? t("Retry loading {p0}", { p0: dataLabel })
                : t("Refresh {p0}", { p0: dataLabel })
            }
          >
            <RefreshCw aria-hidden className="icon-sm" />
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

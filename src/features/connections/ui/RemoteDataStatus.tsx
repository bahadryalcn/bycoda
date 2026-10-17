import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { Loader, RefreshCw } from "../../../shared/ui/icons";
import type { RemoteDataState } from "../model/remoteDataState";

/** Retained content stays visible; this strip explains whether it was verified. */
export function RemoteDataStatus({
  state,
  onRefresh,
  label,
  disabled = false,
  connectionIssueHandled = false,
}: {
  state: RemoteDataState;
  onRefresh?: () => void;
  label?: string;
  disabled?: boolean;
  /** The shared connection notice already explains why this data cannot refresh. */
  connectionIssueHandled?: boolean;
}) {
  useLocale();
  if (connectionIssueHandled) return null;
  const dataLabel = label ?? t("conversation");
  const busy = state.phase === "loading" || state.phase === "refreshing";
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
  return (
    <Alert
      data-remote-data-state={state.phase}
      aria-live="polite"
      aria-busy={busy}
      role={state.phase === "error" ? "alert" : "group"}
      tone={state.phase === "error" || state.phase === "stale" ? "warning" : "info"}
      icon={busy ? <Loader aria-hidden className="size-3.5 animate-spin" /> : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span>{message}</span>
          {time ? (
            <span
              className="ml-1 text-(--ui-text-muted)"
              title={t("Last verified {p0}", {
                p0: new Date(state.updatedAt!).toLocaleString(getLocale()),
              })}
            >
              · {time}
            </span>
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
            variant="secondary"
          >
            <RefreshCw aria-hidden className={`size-3 ${busy ? "animate-spin" : ""}`} />
            {state.phase === "error" ? t("Retry") : t("Refresh")}
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

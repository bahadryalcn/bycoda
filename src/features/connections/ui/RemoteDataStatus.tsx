import { t, useLocale, getLocale } from "../../../shared/i18n";
import { CheckCircle, CircleAlert, Loader, RefreshCw } from "../../../shared/ui/icons";
import type { RemoteDataState } from "../model/remoteDataState";

/** Retained content stays visible; this strip explains whether it was verified. */
export function RemoteDataStatus({
  state,
  onRefresh,
  label = "conversation",
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
  const busy = state.phase === "loading" || state.phase === "refreshing";
  const message =
    state.phase === "loading"
      ? `Loading ${label}…`
      : state.phase === "refreshing"
        ? `Refreshing ${label}… Showing last loaded data.`
        : state.phase === "error"
          ? `Couldn’t refresh ${label}. ${state.updatedAt ? "Showing last loaded data." : "Data has not been verified."}`
          : state.phase === "stale"
            ? "Showing last loaded data. Updates have not been verified."
            : state.phase === "empty"
              ? `No ${label}.`
              : "Up to date";
  const time = state.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : undefined;
  return (
    <div
      data-remote-data-state={state.phase}
      aria-live="polite"
      aria-busy={busy}
      role={state.phase === "error" ? "alert" : undefined}
      className="flex shrink-0 items-start gap-2 border-b border-stroke px-3 py-2 text-[12px] text-content/65"
    >
      {busy ? (
        <Loader aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin" />
      ) : state.phase === "error" || state.phase === "stale" ? (
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
      ) : (
        <CheckCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-content/50" />
      )}
      <div className="min-w-0 flex-1">
        <span>{message}</span>
        {time ? (
          <span
            className="ml-1 text-content/40"
            title={t("Last verified {p0}", {
              p0: new Date(state.updatedAt!).toLocaleString(getLocale()),
            })}
          >
            · {time}
          </span>
        ) : null}
        {state.error ? <p className="mt-1 break-words text-content/60">{state.error}</p> : null}
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || busy}
          aria-label={
            state.phase === "error"
              ? t("Retry loading {p0}", { p0: label })
              : t("Refresh {p0}", { p0: label })
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-content/75 hover:bg-content/8 disabled:opacity-40"
        >
          <RefreshCw aria-hidden className={`size-3 ${busy ? "animate-spin" : ""}`} />
          {state.phase === "error" ? t("Retry") : t("Refresh")}
        </button>
      ) : null}
    </div>
  );
}

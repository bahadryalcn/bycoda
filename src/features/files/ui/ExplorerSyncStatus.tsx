import { InlineAction } from "../../../shared/ui/ActionHost";
import { Spinner } from "../../../shared/ui/Spinner";
import { LiveText } from "../../../shared/ui/LiveText";
import { formatDate } from "../../../shared/i18n";
import { t, useLocale } from "../../../shared/i18n/technical";
import { CircleAlert, RefreshCw } from "../../../shared/ui/icons";
import { type RemoteDataState } from "../../connections";

/** Root freshness at the end of the project row: icon, time, refresh. */
export function ExplorerSyncStatus({
  state,
  onRefresh,
}: {
  state: RemoteDataState;
  onRefresh: () => void;
}) {
  useLocale();
  const busy = state.phase === "loading" || state.phase === "refreshing";
  const warn = state.phase === "error" || state.phase === "stale";
  const time = state.updatedAt
    ? formatDate(state.updatedAt, { hour: "2-digit", minute: "2-digit" })
    : undefined;
  const title = [
    state.updatedAt
      ? t("Last verified {p0}", {
          p0: formatDate(state.updatedAt, {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
          }),
        })
      : undefined,
    state.error,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      data-remote-data-state={state.phase}
      aria-busy={busy}
      title={title || undefined}
      className="flex shrink-0 items-center gap-1 pr-1.5 text-ui-micro leading-none text-[var(--ui-text-muted)]"
    >
      {state.phase === "error" && (
        <LiveText className="sr-only" mode="assertive" text={state.error ?? ""} />
      )}
      {warn ? (
        <span className="inline-flex items-center gap-1">
          <CircleAlert aria-hidden className="icon-xs shrink-0 text-(--ui-tone-warning-fg)" />
          {time ? (
            <span className="hidden tabular-nums @min-[200px]/explorer-root:inline">{time}</span>
          ) : null}
        </span>
      ) : null}
      <InlineAction
        reveal="always"
        label={
          state.phase === "error"
            ? t("Retry loading {p0}", { p0: "files" })
            : t("Refresh {p0}", { p0: "files" })
        }
        motion="none"
        type="button"
        onClick={onRefresh}
        loading={busy}
      >
        {busy ? <Spinner size="sm" /> : <RefreshCw aria-hidden className="icon-sm" />}
      </InlineAction>
    </div>
  );
}

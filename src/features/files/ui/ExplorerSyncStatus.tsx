import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Spinner } from "../../../shared/ui/Spinner";
import { LiveText } from "../../../shared/ui/LiveText";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { formatDate } from "../../../shared/i18n";
import { t, useLocale } from "../../../shared/i18n/technical";
import { CircleAlert, RefreshCw } from "../../../shared/ui/icons";
import { type RemoteDataState } from "../../connections";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";

/** Root freshness at the end of the project row: icon, time, error, refresh. */
export function ExplorerSyncStatus({
  state,
  onRefresh,
}: {
  state: RemoteDataState;
  onRefresh: () => void;
}) {
  useLocale();
  const busy = state.phase === "loading" || state.phase === "refreshing";
  const shownCentrally = useConnectionErrorShownCentrally(state.error);
  const warn = (state.phase === "error" || state.phase === "stale") && !shownCentrally;
  // The failure is visible text in the row, so keyboard and screen-reader users reach it too;
  // a long or multi-line error keeps its full text behind Details.
  const shownError = warn ? state.error : undefined;
  const verified = state.updatedAt
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
    : undefined;
  return (
    <Tooltip label={verified} asChild>
      <Text
        data-remote-data-state={state.phase}
        aria-busy={busy}
        as="div"
        size="micro"
        tone="muted"
        leading="none"
        className="flex shrink-0 items-center gap-1 pr-1.5"
      >
        {state.phase === "error" && !shownCentrally && (
          <LiveText className="sr-only" mode="assertive" text={state.error ?? ""} />
        )}
        {warn ? <CircleAlert aria-hidden tone="warning" className="icon-xs shrink-0" /> : null}
        {shownError ? (
          <Text size="inherit" tone="inherit" truncate className="min-w-0 max-w-40">
            {errorHeadline(shownError)}
          </Text>
        ) : null}
        {shownError && !fitsOneLine(shownError) ? (
          <ErrorDetails
            className="shrink-0"
            title={shownError}
            detail={state.error ?? shownError}
          />
        ) : null}
        <InlineAction
          reveal="always"
          label={
            state.phase === "error" && !shownCentrally
              ? t("Retry loading files")
              : t("Refresh files")
          }
          onClick={onRefresh}
          loading={busy}
        >
          {busy ? <Spinner size="sm" /> : <RefreshCw aria-hidden className="icon-sm" />}
        </InlineAction>
      </Text>
    </Tooltip>
  );
}

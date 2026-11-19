import type { UseQueryResult } from "@tanstack/react-query";
import { useFormat, useT } from "../../../shared/i18n";
import type {
  LiveStreamReport,
  LiveStreamStatus,
} from "../../../shared/model/host-contracts/live-stream";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import { LiveSection } from "./LiveSection";

const eventLabel = {
  comment: "Comment",
  gift: "Gift",
  like: "Like",
  join: "Viewer joined",
  follow: "Follow",
  share: "Share",
  viewers: "Viewers",
  "stream-end": "Live stream ended",
} as const;

export function LiveStreamActivity({
  status,
  report,
}: {
  status: LiveStreamStatus;
  report: UseQueryResult<LiveStreamReport | null, Error>;
}) {
  const t = useT();
  const { formatDate, formatNumber } = useFormat();
  const latestEvents = status.events.slice(-12).reverse();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <LiveSection title={t("Live events")}>
        {latestEvents.length === 0 ? (
          <EmptyState size="inline" context="list" title={t("No live events yet")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {latestEvents.map((event) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2" key={event.id}>
                <Text size="caption" weight="medium">
                  {event.name
                    ? t("{p0} · {p1}", { p0: event.name, p1: t(eventLabel[event.kind]) })
                    : t(eventLabel[event.kind])}
                </Text>
                <Text size="caption" tone="secondary">
                  {formatDate(event.at, { timeStyle: "short" })}
                </Text>
                {event.text || event.count !== undefined ? (
                  <Text size="caption" tone="secondary" className="break-words">
                    {event.text ?? formatNumber(event.count ?? 0)}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </LiveSection>
      <LiveSection title={t("Session report")}>
        {report.error ? (
          <InlineError
            details={report.error.message}
            retry={{
              onRetry: () => {
                void report.refetch().catch(() => undefined);
              },
              pending: report.isFetching,
            }}
          >
            {t("Could not load the session report")}
          </InlineError>
        ) : null}
        {report.data ? (
          <LiveStreamReportDetails report={report.data} />
        ) : report.isPending ? (
          <LoadingText />
        ) : !report.isError ? (
          <EmptyState size="inline" context="list" title={t("No session report yet")} />
        ) : null}
      </LiveSection>
    </div>
  );
}

function LiveStreamReportDetails({ report }: { report: LiveStreamReport }) {
  const t = useT();
  const { formatDate, formatNumber } = useFormat();
  return (
    <>
      <Text size="caption" tone="secondary">
        {report.platform === "demo" ? t("Demo session") : `@${report.channel}`}
      </Text>
      <DescriptionList size="sm">
        <DescriptionItem term={t("Started")}>
          {formatDate(report.startedAt, { dateStyle: "medium", timeStyle: "short" })}
        </DescriptionItem>
        {report.endedAt ? (
          <DescriptionItem term={t("Ended")}>
            {formatDate(report.endedAt, { dateStyle: "medium", timeStyle: "short" })}
          </DescriptionItem>
        ) : null}
        <DescriptionItem term={t("Comments")}>
          {formatNumber(report.totals.comments)}
        </DescriptionItem>
        <DescriptionItem term={t("Gifts")}>{formatNumber(report.totals.gifts)}</DescriptionItem>
        <DescriptionItem term={t("Diamonds")}>
          {formatNumber(report.totals.diamonds)}
        </DescriptionItem>
      </DescriptionList>
      {report.topGifters.length > 0 ? (
        <>
          <SectionLabel as="h4">{t("Top gifters")}</SectionLabel>
          <DescriptionList size="sm">
            {report.topGifters.map((gifter) => (
              <DescriptionItem key={gifter.id} term={gifter.name} truncate>
                {t("{p0} diamonds", { p0: formatNumber(gifter.diamonds) })}
              </DescriptionItem>
            ))}
          </DescriptionList>
        </>
      ) : null}
    </>
  );
}

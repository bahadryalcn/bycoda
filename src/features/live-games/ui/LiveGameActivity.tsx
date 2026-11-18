import type { UseQueryResult } from "@tanstack/react-query";
import { useFormat, useT } from "../../../shared/i18n";
import type { LiveGamesReport, LiveGamesStatus } from "../../../shared/model/host-contracts/live-games";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Divider } from "../../../shared/ui/Divider";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";

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

export function LiveGameActivity({
  status,
  report,
}: {
  status: LiveGamesStatus;
  report: UseQueryResult<LiveGamesReport | null, Error>;
}) {
  const t = useT();
  const { formatDate, formatNumber } = useFormat();
  const latestEvents = status.events.slice(-12).reverse();
  const leader = status.snapshot.dancers.find((dancer) => dancer.role === "leader");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-2" aria-label={t("Live events")}>
        <SectionLabel>{t("Live events")}</SectionLabel>
        {leader ? (
          <DescriptionList size="sm">
            <DescriptionItem term={t("Dance leader")}>{leader.name}</DescriptionItem>
          </DescriptionList>
        ) : null}
        {latestEvents.length === 0 ? (
          <EmptyState size="inline" context="list" title={t("No live events yet")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {latestEvents.map((event) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2" key={event.id}>
                <Text size="caption" weight="medium">
                  {event.name ? t("{p0} · {p1}", { p0: event.name, p1: t(eventLabel[event.kind]) }) : t(eventLabel[event.kind])}
                </Text>
                <Text size="caption" tone="secondary">{formatDate(event.at, { timeStyle: "short" })}</Text>
                {event.text || event.count !== undefined ? (
                  <Text size="caption" tone="secondary" className="break-words">
                    {event.text ?? formatNumber(event.count ?? 0)}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Divider />
      <section className="flex flex-col gap-2" aria-label={t("Session report")}>
        <SectionLabel>{t("Session report")}</SectionLabel>
        {report.error ? (
          <InlineError details={report.error.message} retry={{
            onRetry: () => { void report.refetch().catch(() => undefined); },
            pending: report.isFetching,
          }}>{t("Could not load the session report")}</InlineError>
        ) : null}
        {report.data ? (
          <LiveGameReportDetails report={report.data} />
        ) : report.isPending ? (
          <LoadingText />
        ) : !report.isError ? (
          <EmptyState size="inline" context="list" title={t("No session report yet")} />
        ) : null}
      </section>
    </div>
  );
}

function LiveGameReportDetails({ report }: { report: LiveGamesReport }) {
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
        <DescriptionItem term={t("Dance joins")}>{formatNumber(report.totals.joins)}</DescriptionItem>
        <DescriptionItem term={t("Gifts")}>{formatNumber(report.totals.gifts)}</DescriptionItem>
        <DescriptionItem term={t("Diamonds")}>{formatNumber(report.totals.diamonds)}</DescriptionItem>
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

import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { formatDuration } from "../../../shared/i18n/format";
import { t, useLocale } from "../../../shared/i18n";
import { Surface } from "../../../shared/ui/Surface";
import type { CrewRunView } from "../model/crewClient";
import { crewRunElapsedMs, crewRunSummary, crewRunUsage } from "../model/crewUsage";
import { CrewFaces } from "./CrewFaces";
import { crewUsageText } from "./CrewWorkTimeline";

/** A finished work at a glance: what was accepted, who did it, how long it took and what is left. */
export function CrewWorkSummary({ run }: { run: CrewRunView }) {
  useLocale();
  if (run.status !== "finished") return null;
  const summary = crewRunSummary(run);
  const usage = crewUsageText(crewRunUsage(run).total);
  const doers = run.definition.agents.filter((agent) => summary.memberIds.includes(agent.id));
  return (
    <Surface
      variant="outline"
      padding="md"
      as="section"
      aria-label={t("Work summary")}
      className="mt-3 flex flex-col gap-2"
    >
      <Text as="div" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {doers.length ? <CrewFaces members={doers} max={5} /> : null}
        <span className="tabular-nums">
          {t("Took {p0}", { p0: formatDuration(crewRunElapsedMs(run, run.updatedAt)) })}
        </span>
        {usage ? <span className="tabular-nums">{usage}</span> : null}
      </Text>
      {summary.done.length ? (
        <div>
          <Text as="p" weight="medium">
            {t("Accepted ({p0})", { p0: summary.done.length })}
          </Text>
          <ul className="mt-1 list-disc ps-4">
            {summary.done.map((item) => (
              <Text
                as="li"
                size="secondary"
                tone="inherit"
                key={item.taskId}
                className="break-words [overflow-wrap:anywhere]"
              >
                {item.title}
              </Text>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState size="inline" description={t("No task was accepted.")} />
      )}
      {summary.open.length ? (
        <div>
          <Text as="p" weight="medium">
            {t("Left open ({p0})", { p0: summary.open.length })}
          </Text>
          <ul className="mt-1 list-disc ps-4">
            {summary.open.map((item) => (
              <Text
                as="li"
                size="secondary"
                tone="inherit"
                key={item.taskId}
                className="break-words [overflow-wrap:anywhere]"
              >
                {item.status === "blocked"
                  ? t("Blocked: {p0}", { p0: item.title })
                  : t("Not accepted: {p0}", { p0: item.title })}
              </Text>
            ))}
          </ul>
        </div>
      ) : null}
    </Surface>
  );
}

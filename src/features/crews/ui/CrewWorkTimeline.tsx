import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { formatDuration, formatUsageTokens } from "../../../shared/i18n/format";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Timestamp } from "../../../shared/ui/Timestamp";
import type { CrewRunView } from "../model/crewClient";
import { crewRunTimeline, type CrewTimelineEvent } from "../model/crewTimeline";
import { crewRunUsage, type CrewUsage } from "../model/crewUsage";
import { teamTraits } from "../model/memberAvatars";
import { MemberAvatar } from "./MemberAvatar";

const TEXT_LIMIT = 140;

/** One line of history; the subject is the task title or message text. */
export function crewTimelineText(event: CrewTimelineEvent): string {
  const p0 = truncateGraphemes((event.text ?? "").replace(/\s+/g, " ").trim(), TEXT_LIMIT);
  switch (event.kind) {
    case "created":
      return t("Work started");
    case "assigned":
      return t("Assigned: {p0}", { p0 });
    case "started":
      return t("Started: {p0}", { p0 });
    case "review":
      return t("Awaiting acceptance: {p0}", { p0 });
    case "review-failed":
      return t("Changes requested: {p0}", { p0 });
    case "review-passed":
      return t("Review passed: {p0}", { p0 });
    case "accepted":
      return t("Accepted: {p0}", { p0 });
    case "blocked":
      return t("Blocked: {p0}", { p0 });
    case "request":
      return t("Request: {p0}", { p0 });
    case "resolved":
      return t("Resolved: {p0}", { p0 });
    case "paused":
      return t("Work paused");
    case "finished":
      return t("Work finished");
  }
}

/** Duration, tokens and cost on one line; unknown parts are left out. */
export function crewUsageText(usage: CrewUsage): string {
  const parts: string[] = [];
  if (usage.durationMs !== undefined) parts.push(formatDuration(usage.durationMs));
  if (usage.tokens !== undefined)
    parts.push(
      t(usage.tokensExact ? "{p0} tokens" : "At least {p0} tokens", {
        p0: formatUsageTokens(usage.tokens),
      }),
    );
  if (usage.costUsd !== undefined)
    parts.push(formatNumber(usage.costUsd, { style: "currency", currency: "USD" }));
  return parts.join(" · ");
}

/** What happened in this work, oldest first, and what each member spent. */
export function CrewWorkTimeline({ run }: { run: CrewRunView }) {
  useLocale();
  const events = crewRunTimeline(run);
  const looks = teamTraits(run.definition.agents);
  const names = new Map(run.definition.agents.map((agent) => [agent.id, agent.name]));
  const usage = crewRunUsage(run);
  const members = run.definition.agents.filter((agent) => usage.perMember[agent.id]);
  return (
    <Disclosure className="mt-4" size="sm" summary={t("Timeline")} count={events.length}>
      {members.length ? (
        <ul aria-label={t("Time and usage by member")} className="mt-2 flex flex-col">
          {members.map((agent) => {
            const line = crewUsageText(usage.perMember[agent.id]!);
            return (
              <li
                key={agent.id}
                className="flex min-h-(--ui-control-height-compact) min-w-0 items-center gap-2"
              >
                <MemberAvatar traits={looks.get(agent.id)!} size={20} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-ui-secondary font-medium">
                  {agent.name}
                </span>
                <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                  {line || t("No usage recorded")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ol aria-label={t("Timeline")} className="mt-2 flex flex-col gap-1.5">
        {events.map((event) => {
          const traits = event.memberId ? looks.get(event.memberId) : undefined;
          const who = event.memberId ? names.get(event.memberId) : undefined;
          return (
            <li key={event.id} className="flex min-w-0 items-start gap-2">
              {traits ? (
                <MemberAvatar traits={traits} size={20} label={who} className="shrink-0" />
              ) : (
                <span aria-hidden="true" className="size-5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 break-words text-ui-secondary [overflow-wrap:anywhere]">
                {crewTimelineText(event)}
              </span>
              <span className="shrink-0 text-ui-caption text-(--ui-text-muted)">
                {event.approximate ? "~" : null}
                <Timestamp value={event.at} />
              </span>
            </li>
          );
        })}
      </ol>
    </Disclosure>
  );
}

import { useState } from "react";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { formatDuration, formatUsageTokens } from "../../../shared/i18n/format";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { Button } from "../../../shared/ui/Button";
import { Timestamp } from "../../../shared/ui/Timestamp";
import type { CrewRunView } from "../model/crewClient";
import { crewRunTimeline, type CrewTimelineEvent } from "../model/crewTimeline";
import type { CrewUsage } from "../model/crewUsage";
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

const RECENT = 5;

/** What happened in this work, oldest first: the latest few events, the rest on request. */
export function CrewWorkTimeline({ run }: { run: CrewRunView }) {
  useLocale();
  const [all, setAll] = useState(false);
  const events = crewRunTimeline(run);
  const looks = teamTraits(run.definition.agents);
  const names = new Map(run.definition.agents.map((agent) => [agent.id, agent.name]));
  const shown = all ? events : events.slice(-RECENT);
  if (!events.length) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel as="h4">{t("Timeline")}</SectionLabel>
        {events.length > RECENT ? (
          <Button variant="link" size="sm" onClick={() => setAll((value) => !value)}>
            {all ? t("Show less") : t("Show all ({p0})", { p0: events.length })}
          </Button>
        ) : null}
      </div>
      <ol aria-label={t("Timeline")} className="mt-1.5 flex flex-col gap-1.5">
        {shown.map((event) => {
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
    </div>
  );
}

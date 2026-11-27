import { t, useLocale } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import type { CrewRunView } from "../model/crewClient";
import { crewRunTimeline, type CrewTimelineEvent } from "../model/crewTimeline";
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

/** What happened in this work, oldest first, one disclosure away from the current state. */
export function CrewWorkTimeline({ run }: { run: CrewRunView }) {
  useLocale();
  const events = crewRunTimeline(run);
  const looks = teamTraits(run.definition.agents);
  const names = new Map(run.definition.agents.map((agent) => [agent.id, agent.name]));
  if (!events.length) return null;
  return (
    <div className="mt-4">
      <Disclosure summary={t("History")} count={events.length}>
        <ol aria-label={t("History")} className="flex flex-col gap-1.5">
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
                <Text
                  size="secondary"
                  tone="inherit"
                  className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]"
                >
                  {crewTimelineText(event)}
                </Text>
                <Text tone="muted" className="shrink-0">
                  {event.approximate ? "~" : null}
                  <Timestamp value={event.at} />
                </Text>
              </li>
            );
          })}
        </ol>
      </Disclosure>
    </div>
  );
}

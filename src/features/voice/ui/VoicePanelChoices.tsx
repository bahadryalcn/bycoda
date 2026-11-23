import { useMemo } from "react";
import type { Session } from "../../sessions/model/session";
import { projectDisplayName } from "../../projects/model/projectNames";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { t } from "../../../shared/i18n";

const FOLLOW = "__follow-active__";

/** The session (and so the project) voice talks to; following the active one by default. */
export function VoiceSessionPicker({
  sessions,
  activeId,
  pinned,
  onPin,
}: {
  sessions: Session[];
  activeId?: string;
  pinned: string | null;
  onPin: (sessionId: string | null) => void;
}) {
  // Internal workers and temporary Inbox questions are not voice targets.
  const targets = useMemo(
    () => sessions.filter((session) => !session.orchestrationLeadId && !session.inboxAsk),
    [sessions],
  );
  const active = targets.find((session) => session.id === activeId);
  const options = useMemo(
    () => [
      {
        value: FOLLOW,
        label: t("Follow active session"),
        description: active ? active.title || t("Untitled session") : undefined,
      },
      ...targets.map((session) => {
        const project = projectDisplayName(session.cwd);
        return {
          value: session.id,
          label: session.title || t("Untitled session"),
          description: project,
          keywords: `${project} ${session.cwd} ${session.harness}`,
        };
      }),
    ],
    [targets, active?.title],
  );
  return (
    <SearchableSelect
      hideLabel
      label={t("Voice session")}
      variant="transparent"
      value={pinned ?? FOLLOW}
      options={options}
      searchPlaceholder={t("Search sessions or projects…")}
      emptyLabel={t("No matching sessions")}
      onChange={(value) => onPin(value === FOLLOW ? null : value)}
    />
  );
}

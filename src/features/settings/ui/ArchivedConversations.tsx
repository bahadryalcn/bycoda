import { useDeferredValue, useMemo, useState } from "react";
import { useT } from "../../../shared/i18n";
import { formatArchiveDate } from "../../../shared/i18n/format";
import { projectName } from "../../../shared/lib/paths";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Group, SettingsFeedback } from "../../../shared/ui/settings";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { looksLikeProject } from "../../projects/public/recents";
import type { SessionSummary } from "../../sessions";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { sessionDisplayTitle } from "../../sessions/public/session";
import { CollectionToolbar } from "./SettingsCollection";

export type ArchiveConversationProps = {
  cwd: string;
  sessions: SessionSummary[];
  /** Whether `sessions` is a complete answer. Anything but "ready" must not read as an empty archive. */
  sessionsStatus?: {
    state: "loading" | "unavailable" | "ready";
    error?: string;
    onRetry?: () => void;
  };
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (
    sessionId: string,
    archived: boolean,
  ) => void | boolean | Promise<void | boolean>;
  onDeleteSession: (sessionId: string) => void | boolean | Promise<void | boolean>;
};

type ActionState = {
  run: (key: string, action: () => void | boolean | Promise<void | boolean>) => Promise<void>;
  pending: Record<string, boolean>;
  errors: Record<string, string>;
};

export function ArchivedConversations({
  cwd,
  sessions,
  sessionsStatus,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  run,
  pending,
  errors,
}: ArchiveConversationProps & ActionState) {
  const t = useT();
  const [sessionQuery, setSessionQuery] = useState("");
  const archived = useMemo(
    () => sessions.filter((session) => session.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  // Titles are derived once per session list, not once per keystroke.
  const searchableSessions = useMemo(
    () =>
      archived.map((session) => {
        const title = sessionDisplayTitle(session.title, session.harness);
        return { session, title, haystack: title.toLocaleLowerCase() };
      }),
    [archived],
  );
  // The list follows the query at low priority so typing never waits on it.
  const deferredSessionQuery = useDeferredValue(sessionQuery);
  const matchingSessions = useMemo(() => {
    const query = deferredSessionQuery.trim().toLocaleLowerCase();
    return query
      ? searchableSessions.filter((entry) => entry.haystack.includes(query))
      : searchableSessions;
  }, [searchableSessions, deferredSessionQuery]);
  const sessionsReady = !sessionsStatus || sessionsStatus.state === "ready";
  return (
    <Group
      id="archived-conversations"
      title={
        looksLikeProject(cwd)
          ? t("Archived in {p0}", { p0: projectName(cwd) })
          : t("Archived conversations")
      }
    >
      {!looksLikeProject(cwd) ? (
        <SettingsFeedback state="empty" presentation="inset">
          {t("Open a project to see its archived conversations.")}
        </SettingsFeedback>
      ) : sessionsStatus?.state === "loading" && archived.length === 0 ? (
        <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
      ) : sessionsStatus?.state === "unavailable" && archived.length === 0 ? (
        <SettingsFeedback
          state="error"
          action={
            sessionsStatus.onRetry
              ? { label: t("Retry"), onClick: sessionsStatus.onRetry }
              : undefined
          }
        >
          {sessionsStatus.error ?? t("Archived conversations could not be loaded.")}
        </SettingsFeedback>
      ) : archived.length === 0 ? (
        <SettingsFeedback state="empty" presentation="inset">
          {t("No archived conversations in this project.")}
        </SettingsFeedback>
      ) : (
        <div className="settings-collection">
          <CollectionToolbar
            label={t("Search archived conversations")}
            query={sessionQuery}
            onQueryChange={setSessionQuery}
            count={t("Showing {p0} of {p1} archived conversations", {
              p0: matchingSessions.length,
              p1: archived.length,
            })}
          />
          {!sessionsReady ? (
            <div className="archive-settings-partial">
              <SettingsFeedback
                state="warning"
                action={
                  sessionsStatus?.onRetry
                    ? { label: t("Retry"), onClick: sessionsStatus.onRetry }
                    : undefined
                }
              >
                {t("This list may be incomplete.")} {sessionsStatus?.error}
              </SettingsFeedback>
            </div>
          ) : null}
          {matchingSessions.length === 0 ? (
            <EmptyState
              size="inline"
              kind="filtered"
              className="settings-collection-empty"
              descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
              description={t("No matching archived conversations.")}
              resetLabel={t("Clear search")}
              onReset={() => setSessionQuery("")}
            />
          ) : (
            // The archive only grows, so only the rows near the viewport mount. Search filters
            // `items` in place under one stateKey: scroll, focus and open confirmations survive it.
            <ContinuousList
              rowAppearance="settings"
              gutter="stable"
              className="archive-settings-list"
              label={t("Archived conversations")}
              items={matchingSessions}
              itemKey={(entry) => entry.session.id}
              stateKey={`archive-conversations:${cwd}`}
              estimateSize={44}
              windowThreshold={24}
              renderItem={({ session, title }) => (
                <ActionHost {...surfaceAttributes({ radius: "none" }, "settings-collection-row")}>
                  <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
                  <Button
                    className="min-w-0 flex-1"
                    align="start"
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onOpenSession(session.id)}
                  >
                    {title}
                  </Button>
                  <Text size="caption" tone="secondary" className="shrink-0 tabular-nums">
                    {formatArchiveDate(session.updatedAt)}
                  </Text>
                  <div className="settings-collection-actions">
                    <Button
                      className="shrink-0"
                      loading={!!pending[`unarchive:${session.id}`]}
                      disabled={!!pending[`delete:${session.id}`]}
                      onClick={() =>
                        void run(`unarchive:${session.id}`, () =>
                          onArchiveSession(session.id, false),
                        ).catch(() => {})
                      }
                    >
                      {t("Unarchive")}
                    </Button>
                    <ConfirmMorph
                      label={t("Delete")}
                      tone="danger"
                      confirmMode="press"
                      disabled={!!pending[`unarchive:${session.id}`]}
                      onConfirm={() =>
                        run(`delete:${session.id}`, () => onDeleteSession(session.id))
                      }
                    />
                  </div>
                  {errors[`unarchive:${session.id}`] ? (
                    <div className="settings-collection-feedback">
                      <SettingsFeedback state="error">
                        {errors[`unarchive:${session.id}`]}
                      </SettingsFeedback>
                    </div>
                  ) : null}
                </ActionHost>
              )}
            />
          )}
        </div>
      )}
    </Group>
  );
}

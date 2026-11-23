import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { t, useLocale } from "../../../shared/i18n";
import { formatArchiveDate as formatDate } from "../../../shared/i18n/format";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useContext, useDeferredValue, useMemo, useRef, useState } from "react";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";

import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";

import { RemoveProjectDialog } from "../../projects/public/RemoveProjectDialog";

import { prettyCwd, projectKey, projectName } from "../../../shared/lib/paths";
import { errorText } from "../../../shared/lib/errors";

import {
  loadRecents,
  looksLikeProject,
  readArchivedProjects,
  sameProjectPath,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../../projects/public/recents";

import { sessionDisplayTitle } from "../../sessions/public/session";

import type { SessionSummary } from "../../sessions";

import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";

import { Group, RevealedSetting, Segmented, SettingsFeedback } from "../../../shared/ui/settings";
import { CollectionToolbar } from "./SettingsCollection";
import "./ArchiveSettings.css";

export { formatDate };

/** The stored lists can change in another window; a focused window re-reads them too. */
function subscribeWindowStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
  };
}

function subscribeArchivedProjectsRead(onChange: () => void) {
  const unsubscribe = subscribeArchivedProjects(onChange);
  const stopWindow = subscribeWindowStorage(onChange);
  return () => {
    unsubscribe();
    stopWindow();
  };
}

/** Archived projects plus whether the stored list could be read at all. */
export function useArchivedProjectsRead(): {
  items: ArchivedProject[];
  unavailable: boolean;
  retry: () => void;
} {
  const [read, setRead] = useStoredPreferenceState(
    readArchivedProjects,
    subscribeArchivedProjectsRead,
  );
  const lock = useLockSnapshot();
  const retry = useCallback(() => setRead(readArchivedProjects()), [setRead]);
  // An archived project can still sit in a locked group.
  const items = useMemo(
    () => read.items.filter((item) => !isProjectLockedIn(lock, item.path)),
    [read, lock],
  );
  return { items, unavailable: read.state === "unavailable", retry };
}

export function useArchivedProjects(): ArchivedProject[] {
  return useArchivedProjectsRead().items;
}

export function archivedProjectLabel(path: string): string {
  return resolveTabGroupLabel(projectKey(path), loadTabGroupLabels(), projectName(path));
}

export function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  sessionsStatus,
}: {
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
  onRestoreProject?: (path: string) => void | Promise<void>;
  onDeleteProject?: (path: string) => void | Promise<void>;
}) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState({
    view:
      revealed === "archived-conversations" ? ("conversations" as const) : ("projects" as const),
    revealed,
  });
  if (selection.revealed !== revealed) {
    const view =
      revealed === "archived-conversations"
        ? "conversations"
        : revealed === "archived-projects"
          ? "projects"
          : selection.view;
    setSelection({ view, revealed });
  }
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const {
    items: archivedProjects,
    unavailable: archivedProjectsUnavailable,
    retry: retryArchivedProjects,
  } = useArchivedProjectsRead();
  // A project that left the archive closes its pending delete confirmation.
  if (deleting && !archivedProjects.some((project) => project.path === deleting.path)) {
    setDeleting(null);
  }
  const archived = useMemo(
    () => sessions.filter((session) => session.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  const matchingProjects = archivedProjects.filter((project) =>
    `${archivedProjectLabel(project.path)} ${project.path}`
      .toLocaleLowerCase()
      .includes(projectQuery.trim().toLocaleLowerCase()),
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
  const run = async (key: string, action: () => void | boolean | Promise<void | boolean>) => {
    // Restore/delete actions for the same target must not overlap either.
    const target = key.slice(key.indexOf(":") + 1);
    if ([...inFlight.current].some((active) => active.slice(active.indexOf(":") + 1) === target)) {
      throw new Error(t("The operation did not complete. You can try again."));
    }
    inFlight.current.add(key);
    setPending((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      if ((await action()) === false)
        throw new Error(t("The operation did not complete. You can try again."));
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: errorText(error) }));
      throw error;
    } finally {
      inFlight.current.delete(key);
      setPending((current) => ({ ...current, [key]: false }));
    }
  };

  const requireArchivedProject = (path: string) => {
    const current = readArchivedProjects();
    if (
      current.state !== "ready" ||
      !current.items.some((project) => sameProjectPath(project.path, path)) ||
      isProjectLockedIn(getGroupLockView().lock, path)
    ) {
      throw new Error(t("The operation did not complete. You can try again."));
    }
  };

  // The restore callback has no result, so confirm it from the stores it writes.
  const restoreProject = async (path: string) => {
    requireArchivedProject(path);
    await onRestoreProject?.(path);
    const archivedNow = readArchivedProjects();
    const stillArchived =
      archivedNow.state === "unavailable" ||
      archivedNow.items.some((item) => sameProjectPath(item.path, path));
    const onRail = loadRecents().some((item) => sameProjectPath(item.path, path));
    if (stillArchived || !onRail) {
      throw new Error(t("The project could not be restored. It may still be archived."));
    }
  };

  const sessionsReady = !sessionsStatus || sessionsStatus.state === "ready";
  return (
    <div className="archive-settings settings-topics">
      <Segmented
        label={t("Archive")}
        value={selection.view}
        options={[
          { value: "projects", label: t("Projects") },
          { value: "conversations", label: t("Conversations") },
        ]}
        onChange={(view) => setSelection({ view, revealed })}
      />
      <div hidden={selection.view !== "projects"}>
        <Group id="archived-projects" title={null}>
          {archivedProjectsUnavailable ? (
            <SettingsFeedback
              state="error"
              action={{ label: t("Retry"), onClick: retryArchivedProjects }}
            >
              {t("Archived projects could not be read. Saved data was left unchanged.")}
            </SettingsFeedback>
          ) : archivedProjects.length === 0 ? (
            <SettingsFeedback state="empty" presentation="inset">
              {t("No archived projects.")}
            </SettingsFeedback>
          ) : (
            <div
              {...surfaceAttributes(
                { variant: "card", frame: "none", radius: "none" },
                "settings-collection",
              )}
            >
              <CollectionToolbar
                label={t("Search archived projects")}
                query={projectQuery}
                onQueryChange={setProjectQuery}
                count={t("Showing {p0} of {p1} archived projects", {
                  p0: matchingProjects.length,
                  p1: archivedProjects.length,
                })}
              />
              <ScrollArea
                gutter="stable"
                {...surfaceAttributes(
                  { separator: "block" },
                  "settings-collection-list archive-settings-list",
                )}
                role="region"
                aria-label={t("Archived projects")}
                tabIndex={0}
              >
                {matchingProjects.length === 0 ? (
                  <EmptyState
                    size="inline"
                    kind="filtered"
                    className="settings-collection-empty"
                    descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
                    description={t("No matching archived projects.")}
                    resetLabel={t("Clear search")}
                    onReset={() => setProjectQuery("")}
                  />
                ) : null}
                {matchingProjects.map((project) => (
                  <ActionHost
                    key={project.path}
                    {...surfaceAttributes(
                      { radius: "none", separator: "block" },
                      "settings-collection-row",
                    )}
                  >
                    <div className="settings-collection-main">
                      <Text
                        as="p"
                        size="secondary"
                        tone="primary"
                        weight="medium"
                        leading="normal"
                        truncate
                        className="settings-collection-title"
                      >
                        {archivedProjectLabel(project.path)}
                      </Text>
                      <Text as="p" leading="normal" className="settings-collection-meta">
                        {prettyCwd(project.path)}
                      </Text>
                    </div>
                    <div className="settings-collection-actions">
                      {onRestoreProject ? (
                        <Button
                          className="shrink-0"
                          loading={!!pending[`restore:${project.path}`]}
                          disabled={!!pending[`restore:${project.path}`]}
                          onClick={() =>
                            void run(`restore:${project.path}`, () =>
                              restoreProject(project.path),
                            ).catch(() => {})
                          }
                        >
                          {t("Restore")}
                        </Button>
                      ) : null}
                      {onDeleteProject ? (
                        <Button
                          className="shrink-0"
                          tone="danger"
                          disabled={!!pending[`restore:${project.path}`]}
                          onClick={() => setDeleting(project)}
                        >
                          {t("Delete")}
                        </Button>
                      ) : null}
                    </div>
                    {errors[`restore:${project.path}`] ? (
                      <div className="settings-collection-feedback">
                        <SettingsFeedback state="error">
                          {errors[`restore:${project.path}`]}
                        </SettingsFeedback>
                      </div>
                    ) : null}
                  </ActionHost>
                ))}
              </ScrollArea>
            </div>
          )}
        </Group>
      </div>

      <div hidden={selection.view !== "conversations"}>
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
            <div
              {...surfaceAttributes(
                { variant: "card", frame: "none", radius: "none" },
                "settings-collection",
              )}
            >
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
                  renderItem={({ session, title }) => (
                    <ActionHost
                      {...surfaceAttributes({ radius: "none" }, "settings-collection-row")}
                    >
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
                        {formatDate(session.updatedAt)}
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
      </div>

      {deleting && archivedProjects.some((project) => project.path === deleting.path) ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (!onDeleteProject) {
              throw new Error(t("The operation did not complete. You can try again."));
            }
            requireArchivedProject(deleting.path);
            await onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

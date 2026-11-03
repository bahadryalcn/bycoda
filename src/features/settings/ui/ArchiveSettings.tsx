import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { t, useLocale } from "../../../shared/i18n";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";

import { RemoveProjectDialog } from "../../projects/ui/RemoveProjectDialog";

import { prettyCwd, projectKey, projectName } from "../../../shared/lib/paths";

import {
  loadRecents,
  looksLikeProject,
  readArchivedProjects,
  sameProjectPath,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../../projects/model/recents";
import { sessionDisplayTitle } from "../../sessions/model/session";

import {
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
} from "../../sessions/model/sessionFilters";
import type { SessionSummary } from "../../sessions/data/sessionStore";

import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";

import { Group, Row, Toggle, SettingsFeedback } from "./settingsControls";
import { CollectionToolbar } from "./SettingsCollection";
import "./ArchiveSettings.css";

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
  const [filters, setFilters] = useStoredPreferenceState(
    loadSessionSidebarFilters,
    subscribeWindowStorage,
  );
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [filterError, setFilterError] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const {
    items: archivedProjects,
    unavailable: archivedProjectsUnavailable,
    retry: retryArchivedProjects,
  } = useArchivedProjectsRead();
  const availableProjects = useRef(archivedProjects);
  availableProjects.current = archivedProjects;
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
  const matchingSessions = archived.filter((session) =>
    sessionDisplayTitle(session.title, session.harness)
      .toLocaleLowerCase()
      .includes(sessionQuery.trim().toLocaleLowerCase()),
  );
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
      setErrors((current) => ({ ...current, [key]: String(error).replace(/^Error: /, "") }));
      throw error;
    } finally {
      inFlight.current.delete(key);
      setPending((current) => ({ ...current, [key]: false }));
    }
  };

  // The restore callback has no result, so confirm it from the stores it writes.
  const restoreProject = async (path: string) => {
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

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...loadSessionSidebarFilters(), showArchived };
    saveSessionSidebarFilters(next);
    const saved = loadSessionSidebarFilters();
    setFilters(saved);
    setFilterError(saved.showArchived !== showArchived);
  };

  const sessionsReady = !sessionsStatus || sessionsStatus.state === "ready";
  return (
    <div className="archive-settings settings-topics">
      <Group
        id="archived-projects"
        title={t("Archived projects")}
        scope={t(
          "Scope: archived projects in this app. Locked projects appear after unlocking their group.",
        )}
        description={`${t(
          "Archive a project from the rail to keep its chats without listing it in the sidebar.",
        )} ${t(
          "Restore returns a project to the sidebar. Delete removes its conversations and app entry after confirmation; its folder stays on disk.",
        )}`}
      >
        {!onRestoreProject || !onDeleteProject ? (
          <p className="archive-settings-note">
            {t("Some project actions are unavailable in this view. Open the project to manage it.")}
          </p>
        ) : null}
        {archivedProjectsUnavailable ? (
          <SettingsFeedback
            state="error"
            action={<Button onClick={retryArchivedProjects}>{t("Retry")}</Button>}
          >
            {t("Archived projects could not be read. Saved data was left unchanged.")}
          </SettingsFeedback>
        ) : archivedProjects.length === 0 ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("No archived projects.")}
          </SettingsFeedback>
        ) : (
          <div className="settings-collection">
            <CollectionToolbar
              label={t("Search archived projects")}
              query={projectQuery}
              onQueryChange={setProjectQuery}
              count={t("Showing {p0} of {p1} archived projects", {
                p0: matchingProjects.length,
                p1: archivedProjects.length,
              })}
            />
            <div
              className="settings-collection-list archive-settings-list"
              role="region"
              aria-label={t("Archived projects")}
              tabIndex={0}
            >
              {matchingProjects.length === 0 ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  className="settings-collection-empty"
                  description={t("No matching archived projects.")}
                  resetLabel={t("Clear search")}
                  onReset={() => setProjectQuery("")}
                />
              ) : null}
              {matchingProjects.map((project) => (
                <div key={project.path} className="settings-collection-row">
                  <div className="settings-collection-main">
                    <p className="settings-collection-title">
                      {archivedProjectLabel(project.path)}
                    </p>
                    <p className="settings-collection-meta">{prettyCwd(project.path)}</p>
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
                        variant="danger"
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
                </div>
              ))}
            </div>
          </div>
        )}
      </Group>

      <Group
        id="archived-conversations"
        scope={
          looksLikeProject(cwd)
            ? t("Scope: conversations in {p0}", { p0: prettyCwd(cwd) })
            : t("Select a project to manage archived conversations.")
        }
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
              sessionsStatus.onRetry ? (
                <Button onClick={sessionsStatus.onRetry}>{t("Retry")}</Button>
              ) : undefined
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
                    sessionsStatus?.onRetry ? (
                      <Button onClick={sessionsStatus.onRetry}>{t("Retry")}</Button>
                    ) : undefined
                  }
                >
                  {t("This list may be incomplete.")} {sessionsStatus?.error}
                </SettingsFeedback>
              </div>
            ) : null}
            <div
              className="settings-collection-list archive-settings-list"
              role="region"
              aria-label={t("Archived conversations")}
              tabIndex={0}
            >
              {matchingSessions.length === 0 ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  className="settings-collection-empty"
                  description={t("No matching archived conversations.")}
                  resetLabel={t("Clear search")}
                  onReset={() => setSessionQuery("")}
                />
              ) : null}
              {matchingSessions.map((session) => (
                <div key={session.id} className="settings-collection-row">
                  <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
                  <Button
                    className="min-w-0 flex-1"
                    align="start"
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onOpenSession(session.id)}
                  >
                    {sessionDisplayTitle(session.title, session.harness)}
                  </Button>
                  <span className="shrink-0 text-ui-caption text-(--ui-text-secondary) tabular-nums">
                    {formatDate(session.updatedAt)}
                  </span>
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
                </div>
              ))}
            </div>
          </div>
        )}
      </Group>

      <Group title={t("Sidebar")}>
        <Row
          id="show-archived"
          label={t("Archived conversations only")}
          dependency={t(
            "Show archived conversations instead of active conversations in the sidebar. This does not change the lists on this page.",
          )}
          feedback={
            filterError ? (
              <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
            ) : undefined
          }
        >
          <Toggle
            label={t("Show archived in the sidebar")}
            on={filters.showArchived}
            onChange={onShowArchived}
          />
        </Row>
      </Group>

      {deleting && archivedProjects.some((project) => project.path === deleting.path) ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (
              !onDeleteProject ||
              isProjectLockedIn(getGroupLockView().lock, deleting.path) ||
              !availableProjects.current.some((project) => project.path === deleting.path)
            ) {
              throw new Error(t("The operation did not complete. You can try again."));
            }
            await onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";

import { RemoveProjectDialog } from "../../projects/ui/RemoveProjectDialog";

import { prettyCwd, projectKey, projectName } from "../../../shared/lib/paths";

import {
  loadArchivedProjects,
  looksLikeProject,
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
import "./ArchiveSettings.css";

export function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = useState(loadArchivedProjects);
  const lock = useLockSnapshot();
  useEffect(() => {
    const refresh = () => setItems(loadArchivedProjects());
    const unsubscribe = subscribeArchivedProjects(refresh);
    window.addEventListener("storage", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", refresh);
    };
  }, []);
  // An archived project can still sit in a locked group.
  return useMemo(() => items.filter((item) => !isProjectLockedIn(lock, item.path)), [items, lock]);
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
}: {
  cwd: string;
  sessions: SessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string, archived: boolean) => void | boolean | Promise<void | boolean>;
  onDeleteSession: (sessionId: string) => void | boolean | Promise<void | boolean>;
  onRestoreProject?: (path: string) => void | Promise<void>;
  onDeleteProject?: (path: string) => void | Promise<void>;
}) {
  useLocale();
  const [filters, setFilters] = useState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [filterError, setFilterError] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const archivedProjects = useArchivedProjects();
  const availableProjects = useRef(archivedProjects);
  availableProjects.current = archivedProjects;
  useEffect(() => {
    if (deleting && !archivedProjects.some((project) => project.path === deleting.path)) {
      setDeleting(null);
    }
  }, [archivedProjects, deleting]);
  useEffect(() => {
    const refresh = () => setFilters(loadSessionSidebarFilters());
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const archived = useMemo(
    () => sessions.filter((session) => session.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );
  const matchingProjects = archivedProjects.filter((project) =>
    `${archivedProjectLabel(project.path)} ${project.path}`.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()),
  );
  const matchingSessions = archived.filter((session) =>
    sessionDisplayTitle(session.title, session.harness).toLocaleLowerCase().includes(sessionQuery.trim().toLocaleLowerCase()),
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
      if (await action() === false) throw new Error(t("The operation did not complete. You can try again."));
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: String(error).replace(/^Error: /, "") }));
      throw error;
    } finally {
      inFlight.current.delete(key);
      setPending((current) => ({ ...current, [key]: false }));
    }
  };

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...loadSessionSidebarFilters(), showArchived };
    saveSessionSidebarFilters(next);
    const saved = loadSessionSidebarFilters();
    setFilters(saved);
    setFilterError(saved.showArchived !== showArchived);
  };

  return (
    <div className="archive-settings settings-topics">
      <Group
        id="archived-projects"
        title={t("Archived projects")}
        layout="full"
        scope={t(
          "Scope: archived projects in this app. Locked projects appear after unlocking their group.",
        )}
        description={t(
          "Archive a project from the rail to keep its chats without listing it in the sidebar.",
        )}
        dependency={t(
          "Restore returns a project to the sidebar. Delete removes its conversations and app entry after confirmation; its folder stays on disk.",
        )}
      >
        <div className="archive-settings-search">
          <SearchInput appearance="field" aria-label={t("Search archived projects")} placeholder={t("Search archived projects")} value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} />
        </div>
        {!onRestoreProject || !onDeleteProject ? (
          <p className="px-4 py-3 text-ui-caption text-(--ui-text-secondary)">
            {t("Some project actions are unavailable in this view. Open the project to manage it.")}
          </p>
        ) : null}
        {archivedProjects.length === 0 ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("No archived projects.")}
          </SettingsFeedback>
        ) : (
          <div className="archive-settings-list" role="region" aria-label={t("Archived projects")} tabIndex={0}>
          {matchingProjects.length === 0 ? <SettingsFeedback state="empty" presentation="inset">{t("No matching archived projects.")}</SettingsFeedback> : null}
          {matchingProjects.map((project) => (
            <div
              key={project.path}
              className="flex flex-wrap items-center gap-3 border-b border-stroke px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-secondary">
                  {archivedProjectLabel(project.path)}
                </div>
                <div className="break-all text-ui-micro text-(--ui-text-muted)">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <Button className="shrink-0" loading={!!pending[`restore:${project.path}`]} disabled={!!pending[`restore:${project.path}`]} onClick={() => void run(`restore:${project.path}`, () => onRestoreProject(project.path)).catch(() => {})}>
                  {t("Restore")}
                </Button>
              ) : null}
              {onDeleteProject ? (
                <div className="ms-2 shrink-0 border-s border-stroke ps-3">
                  <Button
                    className="shrink-0"
                    variant="danger"
                    disabled={!!pending[`restore:${project.path}`]}
                    onClick={() => setDeleting(project)}
                  >
                    {t("Delete")}
                  </Button>
                </div>
              ) : null}
              {errors[`restore:${project.path}`] ? <SettingsFeedback state="error">{errors[`restore:${project.path}`]}</SettingsFeedback> : null}
            </div>
          ))}</div>
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
          <Row
            id="show-archived"
            label={t("Archived conversations only")}
            dependency={t("Show archived conversations instead of active conversations in the sidebar. This does not change the lists on this page.")}
            feedback={filterError ? <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback> : undefined}
          >
            <Toggle
              label={t("Show archived in the sidebar")}
              on={filters.showArchived}
              onChange={onShowArchived}
            />
          </Row>
        <div className="archive-settings-search">
          <SearchInput appearance="field" aria-label={t("Search archived conversations")} placeholder={t("Search archived conversations")} value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} />
        </div>
        {!looksLikeProject(cwd) ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("Open a project to see its archived conversations.")}
          </SettingsFeedback>
        ) : archived.length === 0 ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("No archived conversations in this project.")}
          </SettingsFeedback>
        ) : (
          <div className="archive-settings-list" role="region" aria-label={t("Archived conversations")} tabIndex={0}>
          {matchingSessions.length === 0 ? <SettingsFeedback state="empty" presentation="inset">{t("No matching archived conversations.")}</SettingsFeedback> : null}
          {matchingSessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3 border-b border-stroke px-4 py-2.5 last:border-b-0"
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
                {sessionDisplayTitle(session.title, session.harness)}
              </Button>
              <span className="shrink-0 text-ui-micro text-(--ui-text-muted) tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <Button className="shrink-0" loading={!!pending[`unarchive:${session.id}`]} disabled={!!pending[`delete:${session.id}`]} onClick={() => void run(`unarchive:${session.id}`, () => onArchiveSession(session.id, false)).catch(() => {})}>
                {t("Unarchive")}
              </Button>
              <div className="ms-2 shrink-0 border-s border-stroke ps-3">
                <ConfirmMorph
                  label={t("Delete")}
                  tone="danger"
                  confirmMode="press"
                  disabled={!!pending[`unarchive:${session.id}`]}
                  onConfirm={() => run(`delete:${session.id}`, () => onDeleteSession(session.id))}
                />
              </div>
              {errors[`unarchive:${session.id}`] ? <SettingsFeedback state="error">{errors[`unarchive:${session.id}`]}</SettingsFeedback> : null}
            </div>
          ))}</div>
        )}
      </Group>

      {deleting && archivedProjects.some((project) => project.path === deleting.path) ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (!onDeleteProject || isProjectLockedIn(getGroupLockView().lock, deleting.path) || !availableProjects.current.some((project) => project.path === deleting.path)) {
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

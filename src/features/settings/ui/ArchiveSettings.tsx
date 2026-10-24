import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useMemo, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";

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

import { AdvancedSettings, Group, Row, Toggle, SettingsFeedback } from "./settingsControls";

export function useArchivedProjects(): ArchivedProject[] {
  const [items, setItems] = useState(loadArchivedProjects);
  const lock = useLockSnapshot();
  useEffect(() => subscribeArchivedProjects(() => setItems(loadArchivedProjects())), []);
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
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void | Promise<void>;
}) {
  useLocale();
  const [filters, setFilters] = useState(loadSessionSidebarFilters);
  const [deleting, setDeleting] = useState<ArchivedProject | null>(null);
  const archivedProjects = useArchivedProjects();
  const archived = useMemo(
    () => sessions.filter((session) => session.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const onShowArchived = (showArchived: boolean) => {
    const next = { ...filters, showArchived };
    saveSessionSidebarFilters(next);
    setFilters(next);
  };

  return (
    <>
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
          archivedProjects.map((project) => (
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
                <Button className="shrink-0" onClick={() => onRestoreProject(project.path)}>
                  {t("Restore")}
                </Button>
              ) : null}
              {onDeleteProject ? (
                <div className="ms-2 shrink-0 border-s border-stroke ps-3">
                  <Button
                    className="shrink-0"
                    variant="danger"
                    onClick={() => setDeleting(project)}
                  >
                    {t("Delete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))
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
        <AdvancedSettings
          defaultOpen={false}
          title={t("Advanced: sidebar archive visibility")}
          settingIds={["show-archived"]}
        >
          <Row
            id="show-archived"
            label={t("Show archived in the sidebar")}
            description={t("Keep archived conversations listed alongside the active ones.")}
          >
            <Toggle
              label={t("Show archived in the sidebar")}
              on={filters.showArchived}
              onChange={onShowArchived}
            />
          </Row>
        </AdvancedSettings>
        {!looksLikeProject(cwd) ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("Open a project to see its archived conversations.")}
          </SettingsFeedback>
        ) : archived.length === 0 ? (
          <SettingsFeedback state="empty" presentation="inset">
            {t("No archived conversations in this project.")}
          </SettingsFeedback>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3 border-b border-stroke px-4 py-2.5 last:border-b-0"
            >
              <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
              <Button
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
              <Button className="shrink-0" onClick={() => onArchiveSession(session.id, false)}>
                {t("Unarchive")}
              </Button>
              <div className="ms-2 shrink-0 border-s border-stroke ps-3">
                <ConfirmMorph
                  label={t("Delete")}
                  tone="danger"
                  confirmMode="press"
                  onConfirm={() => onDeleteSession(session.id)}
                />
              </div>
            </div>
          ))
        )}
      </Group>

      {deleting ? (
        <RemoveProjectDialog
          name={archivedProjectLabel(deleting.path)}
          path={deleting.path}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await onDeleteProject?.(deleting.path);
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

export function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

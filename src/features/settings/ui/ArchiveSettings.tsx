import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useMemo, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

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

import { AdvancedSettings, Group, Row, Toggle } from "./settingsControls";

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
      >
        <p className="px-4 py-3 text-[12px] text-content/65">
          {t(
            "Restore returns a project to the sidebar. Delete removes its conversations and app entry after confirmation; its folder stays on disk.",
          )}
        </p>
        {!onRestoreProject || !onDeleteProject ? (
          <p className="px-4 py-3 text-[12px] text-content/65">
            {t("Some project actions are unavailable in this view. Open the project to manage it.")}
          </p>
        ) : null}
        {archivedProjects.length === 0 ? (
          <p className="px-4 py-3.5 text-[12px] text-content/45">{t("No archived projects.")}</p>
        ) : (
          archivedProjects.map((project) => (
            <div
              key={project.path}
              className="flex flex-wrap items-center gap-3 border-b border-content/5 px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{archivedProjectLabel(project.path)}</div>
                <div className="break-all text-[11px] text-content/40">
                  {prettyCwd(project.path)}
                </div>
              </div>
              {onRestoreProject ? (
                <SecondaryButton onClick={() => onRestoreProject(project.path)}>
                  {t("Restore")}
                </SecondaryButton>
              ) : null}
              {onDeleteProject ? (
                <SecondaryButton danger onClick={() => setDeleting(project)}>
                  {t("Delete")}
                </SecondaryButton>
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
          <p className="px-4 py-3.5 text-[12px] text-content/45">
            {t("Open a project to see its archived conversations.")}
          </p>
        ) : archived.length === 0 ? (
          <p className="px-4 py-3.5 text-[12px] text-content/45">
            {t("No archived conversations in this project.")}
          </p>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center gap-3 border-b border-content/5 px-4 py-2.5 last:border-b-0"
            >
              <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
              <button
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-content"
              >
                {sessionDisplayTitle(session.title, session.harness)}
              </button>
              <span className="shrink-0 text-[11px] text-content/35 tabular-nums">
                {formatDate(session.updatedAt)}
              </span>
              <SecondaryButton onClick={() => onArchiveSession(session.id, false)}>
                {t("Unarchive")}
              </SecondaryButton>
              <SecondaryButton danger onClick={() => onDeleteSession(session.id)}>
                {t("Delete")}
              </SecondaryButton>
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

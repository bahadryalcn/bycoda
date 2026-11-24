import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { ArchivedConversations, type ArchiveConversationProps } from "./ArchivedConversations";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useContext, useDeferredValue, useMemo, useRef, useState } from "react";
import { ContinuousList } from "../../../shared/ui/ContinuousList";

import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";

import { RemoveProjectDialog } from "../../projects/public/RemoveProjectDialog";

import { prettyCwd } from "../../../shared/lib/paths";
import { errorText } from "../../../shared/lib/errors";

import {
  loadRecents,
  readArchivedProjects,
  sameProjectPath,
  subscribeArchivedProjects,
  type ArchivedProject,
} from "../../projects/public/recents";

import { Group, RevealedSetting, Segmented, SettingsFeedback } from "../../../shared/ui/settings";
import { CollectionToolbar } from "./SettingsCollection";
import "./ArchiveSettings.css";

export { formatArchiveDate as formatDate } from "../../../shared/i18n/format";
export { projectDisplayName as archivedProjectLabel } from "../../projects/public/projectNames";

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

export function ArchivePage({
  cwd,
  sessions,
  onOpenSession,
  onArchiveSession,
  onDeleteSession,
  onRestoreProject,
  onDeleteProject,
  sessionsStatus,
}: ArchiveConversationProps & {
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
  const labels = useProjectLabels();
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
  const searchableProjects = useMemo(
    () =>
      archivedProjects.map((project) => {
        const label = projectDisplayNameFrom(project.path, labels);
        return { project, label, haystack: `${label} ${project.path}`.toLocaleLowerCase() };
      }),
    [archivedProjects, labels],
  );
  const query = useDeferredValue(projectQuery).trim().toLocaleLowerCase();
  const matchingProjects = useMemo(
    () =>
      query
        ? searchableProjects.filter((entry) => entry.haystack.includes(query))
        : searchableProjects,
    [searchableProjects, query],
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
              ) : (
                <ContinuousList
                  rowAppearance="settings"
                  gutter="stable"
                  className="archive-settings-list"
                  label={t("Archived projects")}
                  items={matchingProjects}
                  itemKey={({ project }) => project.path}
                  stateKey="archive-projects"
                  requiredKey={deleting?.path}
                  estimateSize={52}
                  renderItem={({ project, label }) => (
                    <ActionHost
                      {...surfaceAttributes({ radius: "none" }, "settings-collection-row")}
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
                          {label}
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
                  )}
                />
              )}
            </div>
          )}
        </Group>
      </div>

      <div hidden={selection.view !== "conversations"}>
        <ArchivedConversations
          cwd={cwd}
          sessions={sessions}
          sessionsStatus={sessionsStatus}
          onOpenSession={onOpenSession}
          onArchiveSession={onArchiveSession}
          onDeleteSession={onDeleteSession}
          run={run}
          pending={pending}
          errors={errors}
        />
      </div>

      {deleting && archivedProjects.some((project) => project.path === deleting.path) ? (
        <RemoveProjectDialog
          name={projectDisplayNameFrom(deleting.path, labels)}
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

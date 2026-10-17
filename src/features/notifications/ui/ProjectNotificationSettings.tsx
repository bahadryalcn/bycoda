import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Folder } from "../../../shared/ui/icons";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import { NotificationMuteControl } from "./NotificationMuteControl";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import "./ProjectNotificationSettings.css";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useProjectNotificationPreferences } from "../hooks/useProjectNotificationPreferences";
import { useNotificationProjects } from "../hooks/useNotificationProjects";
import {
  NOTIFICATION_CATEGORIES,
  isProjectMuted,
  loadNotificationPreferences,
  updateNotificationPreferences,
  type NotificationCategory,
} from "../model/notificationPreferences";
import { pathKey, projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import type { RecentProject } from "../../projects/model/recents";

type Props = {
  cwd: string;
  recents?: RecentProject[];
  notificationProjectPath?: string | null;
  notificationSettingsRequest?: number;
  highlighted?: boolean;
};

export function ProjectNotificationSettings({
  cwd,
  recents = [],
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
  highlighted = false,
}: Props) {
  useLocale();
  const notificationProjects = useNotificationProjects([
    cwd,
    notificationProjectPath ?? "",
    ...recents.map((project) => project.path),
  ]);
  const projects = [...notificationProjects.projects].sort((a, b) => a.name.localeCompare(b.name));
  const preferences = useProjectNotificationPreferences();
  const groupLogos = useTabGroupLogos();
  const groupColors = loadTabGroupColors();
  const groupCustomColors = loadTabGroupCustomColors();
  const groupMascots = loadTabGroupMascots();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter((project) =>
    [project.name, project.detail, ...project.paths].some((value) =>
      value.toLocaleLowerCase().includes(search),
    ),
  );
  const selectedIds = selected.filter((id) => projects.some((project) => project.id === id));
  const targetCard = useRef<HTMLFieldSetElement>(null);
  const focusedRequest = useRef<{ path: string; request: number } | null>(null);
  const targetId = notificationProjectPath
    ? projects.find((project) =>
        project.paths.some((path) => pathKey(path) === pathKey(notificationProjectPath)),
      )?.id
    : undefined;
  useEffect(() => {
    setQuery("");
  }, [notificationProjectPath, notificationSettingsRequest]);
  useEffect(() => {
    if (!notificationProjectPath) {
      focusedRequest.current = null;
      return;
    }
    if (
      (focusedRequest.current?.path === notificationProjectPath &&
        focusedRequest.current.request === notificationSettingsRequest) ||
      !targetCard.current
    )
      return;
    setExpanded(targetId ?? null);
    targetCard.current.scrollIntoView?.({ block: "nearest" });
    targetCard.current.focus({ preventScroll: true });
    focusedRequest.current = {
      path: notificationProjectPath,
      request: notificationSettingsRequest,
    };
  }, [notificationProjectPath, notificationSettingsRequest, targetId, query]);

  function setCategory(projectId: string, category: NotificationCategory, enabled: boolean) {
    try {
      const disabled = loadNotificationPreferences()[projectId]?.disabled ?? [];
      updateNotificationPreferences([projectId], {
        disabled: enabled ? disabled.filter((id) => id !== category) : [...disabled, category],
      });
      setError(null);
    } catch {
      setError(t("Could not save notification preferences. Please try again."));
    }
  }

  return (
    <section
      id="settings-project-notifications"
      aria-label={t("Project notifications")}
      className="project-notification-settings @container/notifications"
    >
      <div className="flex flex-wrap items-end gap-4 pb-2.5">
        <div className="min-w-[min(100%,240px)] flex-1">
          <h2 className="text-[13px] font-medium text-content">{t("Project notifications")}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {t(
              "These choices apply only to each project. Sounds and desktop banners also follow the application preferences above. Mute pauses project alerts without changing categories; unread items stay marked in Inbox.",
            )}
          </p>
        </div>
        {projects.length ? (
          <div className="shrink-0 pb-0.5">
            <SecondaryButton
              type="button"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelected([]);
              }}
            >
              {selecting ? t("Done") : t("Select projects")}
            </SecondaryButton>
          </div>
        ) : null}
      </div>
      <div className="project-notification-collection" data-highlighted={highlighted || undefined}>
        {error ? (
          <p role="alert" className="px-4 py-3.5 text-[12px] text-danger">
            {error}
          </p>
        ) : null}
        {projects.length === 0 ? (
          <p role="status" className="px-4 py-3.5 text-[12px] leading-relaxed text-content/45">
            {t("Open a project or connect an Inbox provider to configure its notifications.")}
          </p>
        ) : null}
        {projects.length ? (
          <>
            <div className="project-notification-toolbar">
              <TextField
                label={t("Search projects")}
                hideLabel
                placeholder={t("Search projects")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span role="status" className="project-notification-count">
                {visibleProjects.length} / {projects.length}
              </span>
            </div>
            {selecting ? (
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-content/55 hover:text-content/80">
                  <ProjectSelection
                    label={t("Select all projects")}
                    checked={selectedIds.length === projects.length}
                    mixed={selectedIds.length > 0 && selectedIds.length < projects.length}
                    onChange={(checked) =>
                      setSelected(checked ? projects.map((project) => project.id) : [])
                    }
                  />
                  {selectedIds.length
                    ? t("{p0} selected", { p0: selectedIds.length })
                    : t("Select all projects")}
                </label>
                {selectedIds.length ? (
                  <div role="group" aria-label={t("Mute selected projects")}>
                    <NotificationMuteControl projectIds={selectedIds} />
                  </div>
                ) : null}
              </div>
            ) : null}
            <div
              className="project-notification-list"
              role="region"
              aria-label={t("Project notifications")}
              tabIndex={0}
            >
              {visibleProjects.length === 0 ? (
                <p role="status" className="project-notification-empty">
                  {t("No projects found")}
                </p>
              ) : null}
              {visibleProjects.map((project) => {
                const path =
                  project.paths.find(
                    (path) => pathKey(path) === pathKey(notificationProjectPath || cwd),
                  ) ?? project.paths[0];
                const key = path ? projectKey(path) : null;
                const seed = path ? projectName(path) : project.name;
                const logoPath = key ? resolveTabGroupLogo(key, groupLogos) : null;
                const categories = NOTIFICATION_CATEGORIES.filter((category) => {
                  if (project.kind === "linear" || project.kind === "jira")
                    return category.id === "issues";
                  if (project.kind === "local")
                    return !["pullRequests", "issues"].includes(category.id);
                  return true;
                });
                const enabledCount = categories.filter(
                  (category) => !preferences[project.id]?.disabled.includes(category.id),
                ).length;
                const muted = isProjectMuted(preferences[project.id] ?? { disabled: [] });
                const isExpanded = expanded === project.id;
                const panelId = `notification-categories-${encodeURIComponent(project.id)}`;
                const muteHintId = `${panelId}-mute-hint`;
                return (
                  <fieldset
                    key={project.id}
                    ref={project.id === targetId ? targetCard : undefined}
                    tabIndex={-1}
                    className="project-notification-item"
                  >
                    <legend className="sr-only">{project.name}</legend>
                    <div className="project-notification-item-heading">
                      <div className="flex min-w-[min(100%,200px)] flex-1 items-center gap-3">
                        {selecting ? (
                          <ProjectSelection
                            label={t("Select {p0}", { p0: project.name })}
                            checked={selectedIds.includes(project.id)}
                            onChange={(checked) =>
                              setSelected((current) =>
                                checked
                                  ? [...current, project.id]
                                  : current.filter((id) => id !== project.id),
                              )
                            }
                          />
                        ) : null}
                        <Button
                          variant="item"
                          motion="none"
                          type="button"
                          aria-label={t("Notification categories for {p0}", { p0: project.name })}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                          onClick={() => setExpanded(isExpanded ? null : project.id)}
                          className="project-notification-trigger"
                        >
                          <span className="grid size-4 shrink-0 place-items-center">
                            {logoPath ? (
                              <ProjectLogoIcon
                                path={logoPath}
                                className="size-4 rounded-sm"
                                imageClassName="size-4"
                              />
                            ) : key ? (
                              <ProjectMascot
                                project={seed}
                                color={resolveTabGroupColor(
                                  key,
                                  groupColors,
                                  groupCustomColors,
                                  seed,
                                )}
                                name={resolveTabGroupMascot(key, groupMascots)}
                                className="size-3"
                              />
                            ) : (
                              <Folder className="size-4 text-content/40" aria-hidden="true" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className="project-notification-name"
                              title={`${project.name} (${project.detail})`}
                            >
                              {project.name}
                            </p>
                            <p className="project-notification-summary">
                              {project.kind === "local" ? t("Local project · ") : ""}
                              {muted
                                ? t("All notifications paused")
                                : enabledCount === categories.length
                                  ? t("All categories enabled")
                                  : t("{p0} of {p1} enabled", {
                                      p0: enabledCount,
                                      p1: categories.length,
                                    })}
                            </p>
                          </div>
                          <ChevronRight
                            className={`size-3.5 shrink-0 text-content/40 ${isExpanded ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                      <div className="ml-auto max-w-full">
                        <NotificationMuteControl projectIds={[project.id]} />
                      </div>
                    </div>
                    <div
                      id={panelId}
                      hidden={!isExpanded}
                      className="project-notification-categories"
                    >
                      <div
                        className={
                          selecting ? "@[400px]/notifications:pl-14" : "@[400px]/notifications:pl-7"
                        }
                      >
                        {muted ? (
                          <p
                            id={muteHintId}
                            role="status"
                            className="pt-3.5 text-[12px] leading-relaxed text-content/45"
                          >
                            {t(
                              "Your category choices apply when notifications resume. You can edit them while muted.",
                            )}
                          </p>
                        ) : null}
                        {categories.map((category) => (
                          <label
                            key={category.id}
                            className="flex min-h-11 cursor-pointer items-center justify-between gap-6 py-3 text-[13px] text-content"
                          >
                            <span>{t(category.label)}</span>
                            <Switch
                              aria-label={t("{p0} for {p1}", {
                                p0: t(category.label),
                                p1: project.name,
                              })}
                              aria-describedby={muted ? muteHintId : undefined}
                              checked={!preferences[project.id]?.disabled.includes(category.id)}
                              onCheckedChange={(checked) =>
                                setCategory(project.id, category.id, checked)
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ProjectSelection({
  label,
  checked,
  mixed = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  useLocale();
  return (
    <Checkbox
      aria-label={label}
      checked={checked}
      indeterminate={mixed}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

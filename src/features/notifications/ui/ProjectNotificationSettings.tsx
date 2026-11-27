import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { useLocale, useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Folder } from "../../../shared/ui/icons";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import { NotificationMuteControl } from "./NotificationMuteControl";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { useRemoteMachines } from "../../connections/model/connections";
import { machineLabel } from "../../connections/model/machineIdentity";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Heading } from "../../../shared/ui/Heading";
import { Segmented, SettingsFeedback } from "../../../shared/ui/settings";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";
import "./ProjectNotificationSettings.css";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  useNotificationPreferencesView,
  useProjectNotificationPreferencesStatus,
} from "../hooks/useProjectNotificationPreferences";
import { useNotificationProjects } from "../hooks/useNotificationProjects";
import {
  NOTIFICATION_CATEGORIES,
  notificationCategoryLabel,
  loadNotificationPreferences,
  updateNotificationPreferences,
  type NotificationCategory,
} from "../model/notificationPreferences";
import { pathKey, projectKey, projectName } from "../../../shared/lib/paths";
import {
  useTabGroupColors,
  useTabGroupCustomColors,
  useTabGroupMascots,
  resolveTabGroupColor,
  useResolvedTabGroupLogos,
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

type CategoryError = { projectId: string; category: NotificationCategory; enabled: boolean };

function saveCategory(
  projectId: string,
  category: NotificationCategory,
  enabled: boolean,
  setError: (
    update: CategoryError | null | ((current: CategoryError | null) => CategoryError | null),
  ) => void,
) {
  try {
    const disabled = loadNotificationPreferences()[projectId]?.disabled ?? [];
    updateNotificationPreferences([projectId], {
      disabled: enabled ? disabled.filter((id) => id !== category) : [...disabled, category],
    });
    setError((current) =>
      current?.projectId === projectId && current.category === category ? null : current,
    );
  } catch {
    setError({ projectId, category, enabled });
  }
}

export function ProjectNotificationSettings({
  cwd,
  recents = [],
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
  highlighted = false,
}: Props) {
  const t = useT();
  const notificationProjects = useNotificationProjects([
    cwd,
    notificationProjectPath ?? "",
    ...recents.map((project) => project.path),
  ]);
  const { machines } = useRemoteMachines(
    notificationProjects.projects.some((project) => project.detail.startsWith("remote://")),
  );
  const projects = notificationProjects.projects
    .map((project) => {
      const remote = /^remote:\/\/([^/]+)\/(.*)$/.exec(project.detail);
      const machine = remote ? machines.find((entry) => entry.id === remote[1]) : undefined;
      return {
        ...project,
        detail: remote
          ? `${machine ? machineLabel(machines, machine) : t("Remote host")} / ${remote[2]}`
          : project.detail,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const { preferences, muted: mutedIds } = useNotificationPreferencesView();
  const { status: preferencesStatus, retry: retryPreferencesRead } =
    useProjectNotificationPreferencesStatus();
  const preferencesUnavailable = preferencesStatus === "unavailable";
  const groupLogos = useTabGroupLogos();
  const groupColors = useTabGroupColors();
  const groupCustomColors = useTabGroupCustomColors();
  const groupMascots = useTabGroupMascots();
  const [error, setError] = useState<CategoryError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "muted" | "customized">("all");
  // A new notification request starts from an unfiltered list.
  const [seenRequest, setSeenRequest] = useState({
    path: notificationProjectPath,
    request: notificationSettingsRequest,
  });
  if (
    seenRequest.path !== notificationProjectPath ||
    seenRequest.request !== notificationSettingsRequest
  ) {
    setSeenRequest({ path: notificationProjectPath, request: notificationSettingsRequest });
    setQuery("");
    setScope("all");
  }
  const search = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter(
    (project) =>
      [project.name, project.detail, ...project.paths].some((value) =>
        value.toLocaleLowerCase().includes(search),
      ) &&
      (scope === "all" ||
        (scope === "muted"
          ? mutedIds.has(project.id)
          : (preferences[project.id]?.disabled.length ?? 0) > 0 || mutedIds.has(project.id))),
  );
  const projectPathOf = (project: (typeof projects)[number]) =>
    project.paths.find((path) => pathKey(path) === pathKey(notificationProjectPath || cwd)) ??
    project.paths[0];
  const resolvedLogos = useResolvedTabGroupLogos(
    visibleProjects.flatMap((project) => {
      const path = projectPathOf(project);
      return path ? [projectKey(path)] : [];
    }),
    groupLogos,
  );
  // Selection is kept across filters. Select-all and bulk actions only act on the rows on screen;
  // selected rows hidden by the current search or scope are kept but not touched.
  const isFiltered = search !== "" || scope !== "all";
  const selectAllLabel = isFiltered ? t("Select all shown") : t("Select all known projects");
  const visibleIds = visibleProjects.map((project) => project.id);
  const visibleIdSet = new Set(visibleIds);
  const selectedIds = selected.filter((id) => projects.some((project) => project.id === id));
  const selectedVisibleIds = selectedIds.filter((id) => visibleIdSet.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
  const targetCard = useRef<HTMLFieldSetElement>(null);
  const focusedRequest = useRef<{ path: string; request: number } | null>(null);
  const targetId = notificationProjectPath
    ? projects.find((project) =>
        project.paths.some((path) => pathKey(path) === pathKey(notificationProjectPath)),
      )?.id
    : undefined;
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
    saveCategory(projectId, category, enabled, setError);
  }

  return (
    <section
      id="settings-project-notifications"
      aria-label={t("Project notifications")}
      className="project-notification-settings @container/notifications"
    >
      <div className="settings-collection-header">
        <Heading size="item" level={2}>
          {t("Project notifications")}
        </Heading>
      </div>
      <div
        {...surfaceAttributes(
          {
            variant: highlighted ? "selected" : "card",
            frame: "card",
            radius: "card",
          },
          "project-notification-collection settings-collection",
        )}
        data-highlighted={highlighted || undefined}
      >
        {preferencesUnavailable ? (
          <SettingsFeedback
            state="warning"
            action={{ label: t("Retry"), onClick: () => retryPreferencesRead() }}
          >
            {t(
              "Saved project notification choices could not be read. The values shown are the last known ones and changes are paused until they can be read.",
            )}
          </SettingsFeedback>
        ) : null}
        {projects.length === 0 ? (
          <EmptyState
            size="inline"
            kind="empty"
            description={t(
              "Open a project or connect an Inbox provider to configure its notifications.",
            )}
          />
        ) : null}
        {projects.length ? (
          <>
            <CollectionToolbar
              className="project-notification-toolbar"
              label={t("Search projects")}
              query={query}
              onQueryChange={setQuery}
              count={
                search || scope !== "all"
                  ? t("Showing {p0} of {p1} known projects", {
                      p0: visibleProjects.length,
                      p1: projects.length,
                    })
                  : undefined
              }
            >
              <InfoPopover label={t("About project notifications")}>
                {t(
                  "Choose categories per project. Sounds and desktop alerts follow the application settings above. Mute pauses alerts without changing categories; unread items stay in Inbox.",
                )}
              </InfoPopover>
              <Segmented
                label={t("Show projects")}
                value={scope}
                options={[
                  { value: "all", label: t("All") },
                  { value: "customized", label: t("Customized") },
                  { value: "muted", label: t("Muted") },
                ]}
                onChange={setScope}
              />
              {projects.length ? (
                <Button
                  variant="secondary"
                  className="shrink-0"
                  type="button"
                  aria-pressed={selecting}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelected([]);
                  }}
                >
                  {selecting ? t("Done") : t("Select projects")}
                </Button>
              ) : null}
            </CollectionToolbar>
            {selecting ? (
              <ActionHost
                {...surfaceAttributes(
                  { radius: "none", separator: "block" },
                  "settings-collection-row",
                )}
              >
                <ProjectSelection
                  className="flex cursor-pointer items-center gap-2.5"
                  interactionTone="neutral"
                  label={selectAllLabel}
                  text={
                    selectedVisibleIds.length
                      ? t("{p0} selected", { p0: selectedVisibleIds.length })
                      : selectAllLabel
                  }
                  checked={allVisibleSelected}
                  mixed={selectedVisibleIds.length > 0 && !allVisibleSelected}
                  onChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...new Set([...current, ...visibleIds])]
                        : current.filter((id) => !visibleIdSet.has(id)),
                    )
                  }
                />
                {selectedVisibleIds.length ? (
                  <div
                    className="settings-collection-actions"
                    role="group"
                    aria-label={t("Mute selected projects")}
                  >
                    <NotificationMuteControl projectIds={selectedVisibleIds} />
                  </div>
                ) : null}
              </ActionHost>
            ) : null}
            <ScrollArea
              gutter="stable"
              {...surfaceAttributes(
                { separator: "block" },
                "project-notification-list settings-collection-list",
              )}
              role="region"
              aria-label={t("Projects")}
              tabIndex={0}
            >
              {visibleProjects.length === 0 ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  description={t("No projects found")}
                  resetLabel={t("Clear search")}
                  onReset={() => {
                    setQuery("");
                    setScope("all");
                  }}
                />
              ) : null}
              {visibleProjects.map((project, index) => {
                const path = projectPathOf(project);
                const key = path ? projectKey(path) : null;
                const seed = path ? projectName(path) : project.name;
                const logoPath = key ? (resolvedLogos[key] ?? null) : null;
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
                const muted = mutedIds.has(project.id);
                const isExpanded = expanded === project.id;
                const panelId = `notification-categories-${encodeURIComponent(project.id)}`;
                return (
                  <FieldGroup
                    key={project.id}
                    ref={project.id === targetId ? targetCard : undefined}
                    tabIndex={-1}
                    {...surfaceAttributes(
                      { radius: index === 0 ? "control" : "none", separator: "block" },
                      "project-notification-item",
                    )}
                    legend={`${project.name} (${project.detail})`}
                    hideLegend
                    data-nested-project={/^\s*\u21b3/.test(project.name) ? "" : undefined}
                  >
                    <ActionHost
                      {...surfaceAttributes(
                        { radius: "none", separator: "block" },
                        "project-notification-item-heading settings-collection-row",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {selecting ? (
                          <ProjectSelection
                            label={t("Select {p0}", { p0: `${project.name} (${project.detail})` })}
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
                          aria-label={t("Notification categories for {p0}", {
                            p0: `${project.name} (${project.detail})`,
                          })}
                          expanded={isExpanded}
                          aria-controls={isExpanded ? panelId : undefined}
                          onClick={() => setExpanded(isExpanded ? null : project.id)}
                          className="project-notification-trigger"
                        >
                          <span className="grid icon-md shrink-0 place-items-center">
                            {logoPath ? (
                              <ProjectLogoIcon
                                path={logoPath}
                                className="icon-md rounded-sm"
                                imageClassName="icon-md"
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
                                className="icon-xs"
                              />
                            ) : (
                              <Folder className="icon-md" tone="secondary" aria-hidden="true" />
                            )}
                          </span>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Text
                              as="p"
                              size="secondary"
                              tone="primary"
                              weight="medium"
                              leading="inherit"
                              truncate
                              className="project-notification-name min-w-0 flex-1"
                            >
                              {project.name.replace(/^\s*\u21b3\s*/, "")}
                            </Text>
                            <Text
                              as="p"
                              size="caption"
                              tone="secondary"
                              leading="normal"
                              className="project-notification-summary shrink-0"
                            >
                              {muted
                                ? t("Muted")
                                : enabledCount === categories.length
                                  ? t("All")
                                  : t("{p0} categories", { p0: enabledCount })}
                            </Text>
                          </div>
                        </Button>
                      </div>
                      <div className="settings-collection-actions">
                        <NotificationMuteControl projectIds={[project.id]} compact />
                      </div>
                    </ActionHost>
                    {error?.projectId === project.id ? (
                      <div className="project-notification-error">
                        <SettingsFeedback
                          state="error"
                          action={{
                            label: t("Retry"),
                            onClick: () => setCategory(project.id, error.category, error.enabled),
                          }}
                        >
                          {t("Could not save notification preferences. Please try again.")}
                          <span className="block">
                            {project.name} · {notificationCategoryLabel(t, error.category)}
                          </span>
                        </SettingsFeedback>
                      </div>
                    ) : null}
                    {isExpanded ? (
                      <div
                        id={panelId}
                        {...surfaceAttributes(
                          { radius: "control", variant: "page" },
                          "project-notification-categories",
                        )}
                      >
                        <Text
                          as="p"
                          size="caption"
                          tone="secondary"
                          leading="normal"
                          className="project-notification-summary"
                        >
                          <MiddleTruncate>{project.detail}</MiddleTruncate>
                        </Text>
                        <div className="project-notification-category-grid">
                          {categories.map((category) => (
                            <Switch
                              key={category.id}
                              className="project-notification-category"
                              labelText={{ size: "secondary", tone: "primary", leading: "inherit" }}
                              label={notificationCategoryLabel(t, category.id)}
                              labelPosition="start"
                              checked={!preferences[project.id]?.disabled.includes(category.id)}
                              disabled={preferencesUnavailable}
                              onCheckedChange={(checked) =>
                                setCategory(project.id, category.id, checked)
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </FieldGroup>
                );
              })}
            </ScrollArea>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ProjectSelection({
  label,
  text,
  className,
  interactionTone,
  checked,
  mixed = false,
  onChange,
}: {
  label: string;
  /** Visible text beside the box; omit for a bare box named by `label`. */
  text?: string;
  className?: string;
  interactionTone?: "neutral";
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  useLocale();
  return (
    <Checkbox
      aria-label={label}
      label={text}
      size="caption"
      tone="secondary"
      className={className}
      interactionTone={interactionTone}
      checked={checked}
      indeterminate={mixed}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

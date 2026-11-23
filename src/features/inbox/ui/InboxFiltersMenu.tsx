import { Text } from "../../../shared/ui/Text";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import type { CodeHostScope } from "../model/codeHostScopes";
import { t, useLocale } from "../../../shared/i18n";
import { CircleDot, GitPullRequest } from "../../../shared/ui/icons";
import { type ReactNode } from "react";
import type { InboxItem, InboxKind } from "../model/githubTasks";
import {
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  isTrackerSource,
  jiraFilterOptions,
  type InboxFilters,
  type InboxSource,
  type InboxTimeFilter,
  type LinearProjectOption,
} from "../model/inboxFilters";
import { knownJiraFilterIssues, type JiraProject } from "../model/jira";
import type { LinearTeam } from "../model/linear";
import { Popover } from "../../../shared/ui/Popover";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import {
  hiddenAfterRepositorySelection,
  repositorySelectionHidden,
} from "../model/inboxRepositoryFilters";

const INBOX_FILTER_MENU_WIDTH = 280;

type ProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
  aliases?: readonly string[];
};

type Props = {
  items?: readonly InboxItem[];
  codeHostProjects?: CodeHostScope[];
  hiddenCodeHostProjects?: string[];
  codeHostError?: string | null;
  /** The project list is partial: the Host kept what it loaded and says why it stopped. */
  codeHostIncomplete?: string | null;
  onCodeHostProjectsChange?: (ids: string[]) => void;
  projects: ProjectOption[];
  linearProjects: LinearProjectOption[];
  linearTeams: LinearTeam[];
  hiddenLinearTeamIds: string[];
  jiraProjects: JiraProject[];
  hiddenJiraProjectIds: string[];
  source: InboxSource;
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  /** Shared with Settings → Inbox → Linear; narrows the fetch, not just the list. */
  onLinearTeamsChange: (ids: string[]) => void;
  /** Shared with Settings → Inbox → Jira; narrows the fetch, not just the list. */
  onJiraProjectsChange: (ids: string[]) => void;
  onClose: () => void;
} & ({ anchor: HTMLElement; x?: never; y?: never } | { anchor?: never; x: number; y: number });

const TIME_OPTIONS: { id: InboxTimeFilter; label: string }[] = [
  {
    id: "all",
    get label() {
      return t("All time");
    },
  },
  {
    id: "today",
    get label() {
      return t("Today");
    },
  },
  {
    id: "7d",
    get label() {
      return t("Last 7 days");
    },
  },
  {
    id: "30d",
    get label() {
      return t("Last 30 days");
    },
  },
];

const KIND_OPTIONS: {
  id: InboxKind;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "issue",
    get label() {
      return t("Issues");
    },
    icon: <CircleDot className="icon-sm shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "pr",
    get label() {
      return t("Pull requests");
    },
    icon: <GitPullRequest className="icon-sm shrink-0" strokeWidth={1.75} />,
  },
];

export function InboxFiltersMenu({
  items = [],
  codeHostProjects = [],
  hiddenCodeHostProjects = [],
  codeHostError,
  codeHostIncomplete,
  onCodeHostProjectsChange,
  anchor,
  x,
  y,
  projects,
  linearProjects,
  linearTeams,
  hiddenLinearTeamIds,
  jiraProjects,
  hiddenJiraProjectIds,
  source,
  filters,
  onChange,
  onLinearTeamsChange,
  onJiraProjectsChange,
  onClose,
}: Props) {
  useLocale();

  const hiddenKinds = new Set(filters.hiddenKinds);
  const teamsActive = source === "linear" && hiddenLinearTeamIds.length > 0;

  const jiraProjectsActive = source === "jira" && hiddenJiraProjectIds.length > 0;
  const tracker = isTrackerSource(source);
  const codeHostProjectsActive =
    (source === "gitlab" || source === "azuredevops") && hiddenCodeHostProjects.length > 0;

  const toggleAssigned = () => {
    onChange({ ...filters, assignedToMe: !filters.assignedToMe });
  };

  const toggleKind = (kind: InboxKind) => {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange({ ...filters, hiddenKinds: [...next] });
  };

  const setTime = (time: InboxTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof InboxFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  return (
    <Popover
      anchor={anchor ?? { x, y }}
      align={anchor ? "end" : "start"}
      gap={anchor ? 4 : 0}
      width={source === "jira" ? 344 : INBOX_FILTER_MENU_WIDTH}
      maxHeight={480}
      flow="scroll"
      solid={source === "jira"}
      ignore={anchor ? "[data-filter-trigger]" : undefined}
      onDismiss={onClose}
      kind="dialog"
      aria-label={t("Filter inbox")}
      onContextMenu={(event) => event.preventDefault()}
      className="p-3"
    >
      <div
        className={`flex items-center justify-between gap-2 ${source === "jira" ? "mb-3" : "mbs-2"}`}
      >
        <Text size={source === "jira" ? "body" : "caption"} tone="secondary" weight="medium">
          {t("Filter inbox")}
        </Text>
        {hasActiveInboxFilters(filters, source, hiddenLinearTeamIds, hiddenJiraProjectIds) ||
        codeHostProjectsActive ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(DEFAULT_INBOX_FILTERS);
              if (teamsActive) onLinearTeamsChange([]);
              if (jiraProjectsActive) onJiraProjectsChange([]);
              if (codeHostProjectsActive) onCodeHostProjectsChange?.([]);
            }}
          >
            {t("Clear filters")}
          </Button>
        ) : null}
      </div>
      {source === "jira" ? (
        <JiraFilterFields
          items={items}
          filters={filters}
          onChange={onChange}
          projects={jiraProjects}
          hiddenProjectIds={hiddenJiraProjectIds}
          onProjectsChange={onJiraProjectsChange}
        />
      ) : (
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterItem
              label={
                source === "gitlab" || source === "azuredevops"
                  ? t("Needs attention")
                  : t("Assigned to me")
              }
              checked={filters.assignedToMe}
              onClick={toggleAssigned}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <SectionLabel variant="menu">{t("Status")}</SectionLabel>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <FilterItem
                label={t("Open")}
                checked={filters.status.open}
                onClick={() => toggleStatus("open")}
              />
              <FilterItem
                label={t("Closed")}
                checked={filters.status.closed}
                onClick={() => toggleStatus("closed")}
              />
              {!tracker ? (
                <FilterItem
                  label={t("Draft")}
                  checked={filters.status.draft}
                  onClick={() => toggleStatus("draft")}
                />
              ) : null}
              {!tracker ? (
                <FilterItem
                  label={t("Merged")}
                  checked={filters.status.merged}
                  onClick={() => toggleStatus("merged")}
                />
              ) : null}
            </div>
          </div>
          <Select
            label={t("Time")}
            value={filters.time}
            options={TIME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            onValueChange={(value) => setTime(value as InboxTimeFilter)}
          />

          {!tracker && source !== "github" ? (
            <div className="grid min-w-0 gap-1.5">
              <SectionLabel variant="menu">{t("Type")}</SectionLabel>
              {KIND_OPTIONS.map((option) => (
                <FilterItem
                  key={option.id}
                  label={
                    source === "gitlab" && option.id === "pr" ? t("Merge requests") : option.label
                  }
                  checked={!hiddenKinds.has(option.id)}
                  icon={option.icon}
                  onClick={() => toggleKind(option.id)}
                />
              ))}
            </div>
          ) : null}

          {source === "linear" && linearTeams.length > 0 ? (
            <div className="grid min-w-0 gap-1.5">
              <SectionLabel variant="menu">{t("Teams")}</SectionLabel>
              <SearchableSelect
                hideLabel
                side="right"
                multiple
                label={t("Teams")}
                options={linearTeams.map((item) => ({
                  value: item.id,
                  label: item.name || item.key,
                  keywords: item.id,
                }))}
                value={linearTeams
                  .filter((item) => !hiddenLinearTeamIds.includes(item.id))
                  .map((item) => item.id)}
                onChange={(values) => {
                  const keys = linearTeams.map((item) => item.id);
                  const next = hiddenAfterSelection(keys, values, hiddenLinearTeamIds);
                  onLinearTeamsChange(next);
                }}
              />
            </div>
          ) : null}

          {source === "linear" && linearProjects.length > 0 ? (
            <div className="grid min-w-0 gap-1.5">
              <SearchableSelect
                multiple
                label={t("Projects")}
                options={linearProjects.map((item) => ({
                  value: item.id,
                  label: item.name,
                  keywords: item.id,
                }))}
                value={linearProjects
                  .filter((item) => !filters.hiddenLinearProjects.includes(item.id))
                  .map((item) => item.id)}
                onChange={(values) => {
                  const keys = linearProjects.map((item) => item.id);
                  const next = hiddenAfterSelection(keys, values, filters.hiddenLinearProjects);
                  onChange({ ...filters, hiddenLinearProjects: next });
                }}
              />
            </div>
          ) : null}

          {source === "gitlab" || source === "azuredevops" ? (
            <div className="grid min-w-0 gap-1.5">
              {codeHostError ? <Alert tone="danger">{codeHostError}</Alert> : null}
              {codeHostIncomplete ? <Alert tone="warning">{codeHostIncomplete}</Alert> : null}
              {codeHostProjects.length ? (
                <SectionLabel variant="menu">{t("Projects")}</SectionLabel>
              ) : null}
              <SearchableSelect
                hideLabel
                side="right"
                multiple
                label={t("Projects")}
                options={codeHostProjects.map((item) => ({
                  value: item.id,
                  label: item.name,
                  keywords: item.id,
                }))}
                value={codeHostProjects
                  .filter((item) => !hiddenCodeHostProjects.includes(item.id))
                  .map((item) => item.id)}
                onChange={(values) => {
                  const keys = codeHostProjects.map((item) => item.id);
                  const next = hiddenAfterSelection(keys, values, hiddenCodeHostProjects);
                  onCodeHostProjectsChange?.(next);
                }}
              />
            </div>
          ) : null}

          {!tracker &&
          !((source === "gitlab" || source === "azuredevops") && filters.assignedToMe) &&
          projects.length > 0 ? (
            <div className="grid min-w-0 gap-1.5">
              <SectionLabel variant="menu">
                {source === "github" ? t("Local repositories") : t("Projects")}
              </SectionLabel>
              <SearchableSelect
                hideLabel
                side="right"
                multiple
                label={source === "github" ? t("Local repositories") : t("Projects")}
                options={projects.map((item) => ({
                  value: item.path,
                  label: item.name,
                  keywords: [item.path, ...(item.aliases ?? [])].join(" "),
                }))}
                value={projects
                  .filter((item) => !repositorySelectionHidden(item, filters.hiddenProjects))
                  .map((item) => item.path)}
                onChange={(values) => {
                  const next = hiddenAfterRepositorySelection(
                    projects,
                    values,
                    filters.hiddenProjects,
                  );
                  onChange({ ...filters, hiddenProjects: next });
                }}
              />
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function JiraFilterFields({
  items,
  filters,
  onChange,
  projects,
  hiddenProjectIds,
  onProjectsChange,
}: {
  items: readonly InboxItem[];
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  projects: JiraProject[];
  hiddenProjectIds: string[];
  onProjectsChange: (ids: string[]) => void;
}) {
  const options = jiraFilterOptions([...knownJiraFilterIssues(), ...items], hiddenProjectIds);
  const selectedProjects = projects.filter((item) => !hiddenProjectIds.includes(item.id));
  const withSelected = (available: { value: string; label: string }[], selected: string[] = []) => [
    ...available,
    ...selected
      .filter((value) => !available.some((option) => option.value === value))
      .map((value) => ({ value, label: value })),
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-2">
        <SearchableSelect
          multiple
          label={t("Assignee")}
          placeholder={t("Anyone")}
          options={withSelected(options.assignees, filters.jiraAssignees)}
          value={filters.jiraAssignees ?? []}
          onChange={(jiraAssignees) => onChange({ ...filters, jiraAssignees })}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterItem
            label={t("Assigned to me")}
            checked={filters.assignedToMe}
            onClick={() => onChange({ ...filters, assignedToMe: !filters.assignedToMe })}
          />
          <FilterItem
            label={t("Unassigned")}
            checked={filters.jiraUnassigned === true}
            onClick={() => onChange({ ...filters, jiraUnassigned: !filters.jiraUnassigned })}
          />
        </div>
      </div>
      <div className="grid min-w-0 gap-2">
        <SearchableSelect
          multiple
          label={t("Workflow status")}
          placeholder={t("All statuses")}
          options={withSelected(options.statuses, filters.jiraStatuses)}
          value={filters.jiraStatuses ?? []}
          onChange={(jiraStatuses) => onChange({ ...filters, jiraStatuses })}
        />
        <SectionLabel variant="menu">{t("Status category")}</SectionLabel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterItem
            label={t("Open")}
            checked={filters.status.open}
            onClick={() =>
              onChange({ ...filters, status: { ...filters.status, open: !filters.status.open } })
            }
          />
          <FilterItem
            label={t("Closed")}
            checked={filters.status.closed}
            onClick={() =>
              onChange({
                ...filters,
                status: { ...filters.status, closed: !filters.status.closed },
              })
            }
          />
        </div>
      </div>
      <Select
        label={t("Updated")}
        value={filters.time}
        options={TIME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
        onValueChange={(time) => onChange({ ...filters, time: time as InboxTimeFilter })}
      />
      {projects.length ? (
        <SearchableSelect
          multiple
          label={t("Projects")}
          placeholder={t("No projects selected")}
          options={projects.map((item) => ({
            value: item.id,
            label: item.name || item.key,
            keywords: `${item.key} ${item.id}`,
          }))}
          value={selectedProjects.map((item) => item.id)}
          selectionLabels={{
            summary: (count) =>
              count === projects.length
                ? t("All projects")
                : selectedProjects.map((item) => item.name || item.key).join(", "),
          }}
          onChange={(values) =>
            onProjectsChange(
              hiddenAfterSelection(
                projects.map((item) => item.id),
                values,
                hiddenProjectIds,
              ),
            )
          }
        />
      ) : null}
    </div>
  );
}

function FilterItem({
  label,
  checked,
  icon,
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  useLocale();
  return (
    <Checkbox
      checked={checked}
      onChange={onClick}
      label={
        <>
          {icon}
          <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
            {label}
          </Text>
        </>
      }
      size="caption"
      tone="neutral"
      className="flex min-w-0 items-center gap-2"
    />
  );
}

function hiddenAfterSelection(
  keys: readonly string[],
  selected: readonly string[],
  previous: readonly string[],
) {
  return [
    ...previous.filter((key) => !keys.includes(key)),
    ...keys.filter((key) => !selected.includes(key)),
  ];
}

import { Checkbox } from "../../../shared/ui/Checkbox";
import { NativeSelect } from "../../../shared/ui/Select";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import type { CodeHostScope } from "../model/codeHostScopes";
import { t, useLocale } from "../../../shared/i18n";
import { CircleDot, GitPullRequest } from "../../../shared/ui/icons";
import { type ReactNode } from "react";
import type { InboxKind } from "../model/githubTasks";
import {
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  isTrackerSource,
  type InboxFilters,
  type InboxSource,
  type InboxTimeFilter,
  type LinearProjectOption,
} from "../model/inboxFilters";
import type { JiraProject } from "../model/jira";
import type { LinearTeam } from "../model/linear";
import { Popover } from "../../../shared/ui/Popover";

export const INBOX_FILTER_MENU_WIDTH = 228;

type ProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
};

type Props = {
  codeHostProjects?: CodeHostScope[];
  hiddenCodeHostProjects?: string[];
  codeHostError?: string | null;
  onCodeHostProjectsChange?: (ids: string[]) => void;
  x: number;
  y: number;
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
};

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
    icon: <CircleDot className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "pr",
    get label() {
      return t("Pull requests");
    },
    icon: <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
];

export function InboxFiltersMenu({
  codeHostProjects = [],
  hiddenCodeHostProjects = [],
  codeHostError,
  onCodeHostProjectsChange,
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
      anchor={{ x, y }}
      gap={0}
      width={INBOX_FILTER_MENU_WIDTH}
      maxHeight={480}
      onDismiss={onClose}
      role="dialog"
      aria-label={t("Filter inbox")}
      onContextMenu={(event) => event.preventDefault()}
      className="overflow-y-auto overscroll-none p-1"
    >
      <FilterItem
        label={
          source === "gitlab" || source === "azuredevops"
            ? t("Needs attention")
            : t("Assigned to me")
        }
        checked={filters.assignedToMe}
        onClick={toggleAssigned}
      />

      <SectionLabel>{t("Status")}</SectionLabel>
      <FilterItem
        label={t("Open")}
        checked={filters.status.open}
        onClick={() => toggleStatus("open")}
      />
      {!tracker ? (
        <FilterItem
          label={t("Draft")}
          checked={filters.status.draft}
          onClick={() => toggleStatus("draft")}
        />
      ) : null}
      <FilterItem
        label={t("Closed")}
        checked={filters.status.closed}
        onClick={() => toggleStatus("closed")}
      />
      {!tracker ? (
        <FilterItem
          label={t("Merged")}
          checked={filters.status.merged}
          onClick={() => toggleStatus("merged")}
        />
      ) : null}

      <SectionLabel>{t("Time")}</SectionLabel>
      <NativeSelect
        aria-label={t("Time")}
        value={filters.time}
        onChange={(event) => setTime(event.target.value as InboxTimeFilter)}
      >
        {TIME_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>

      {!tracker ? (
        <>
          <SectionLabel>{t("Type")}</SectionLabel>
          {KIND_OPTIONS.map((option) => (
            <FilterItem
              key={option.id}
              label={source === "gitlab" && option.id === "pr" ? t("Merge requests") : option.label}
              checked={!hiddenKinds.has(option.id)}
              icon={option.icon}
              onClick={() => toggleKind(option.id)}
            />
          ))}
        </>
      ) : null}

      {source === "linear" && linearTeams.length > 0 ? (
        <>
          <SectionLabel>{t("Teams")}</SectionLabel>
          <SearchableSelect
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
        </>
      ) : null}

      {source === "linear" && linearProjects.length > 0 ? (
        <>
          <SectionLabel>{t("Projects")}</SectionLabel>
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
        </>
      ) : null}

      {source === "jira" && jiraProjects.length > 0 ? (
        <>
          <SectionLabel>{t("Projects")}</SectionLabel>
          <SearchableSelect
            multiple
            label={t("Projects")}
            options={jiraProjects.map((item) => ({
              value: item.id,
              label: item.name || item.key,
              keywords: item.id,
            }))}
            value={jiraProjects
              .filter((item) => !hiddenJiraProjectIds.includes(item.id))
              .map((item) => item.id)}
            onChange={(values) => {
              const keys = jiraProjects.map((item) => item.id);
              const next = hiddenAfterSelection(keys, values, hiddenJiraProjectIds);
              onJiraProjectsChange(next);
            }}
          />
        </>
      ) : null}

      {source === "gitlab" || source === "azuredevops" ? (
        <>
          {codeHostError ? (
            <Alert tone="danger" role="alert">
              {codeHostError}
            </Alert>
          ) : null}
          {codeHostProjects.length ? <SectionLabel>{t("Projects")}</SectionLabel> : null}
          <SearchableSelect
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
        </>
      ) : null}

      {!tracker &&
      !((source === "gitlab" || source === "azuredevops") && filters.assignedToMe) &&
      projects.length > 0 ? (
        <>
          <SectionLabel>{t("Projects")}</SectionLabel>
          <SearchableSelect
            multiple
            label={t("Projects")}
            options={projects.map((item) => ({
              value: item.path,
              label: item.name,
              keywords: item.path,
            }))}
            value={projects
              .filter((item) => !filters.hiddenProjects.includes(item.path))
              .map((item) => item.path)}
            onChange={(values) => {
              const keys = projects.map((item) => item.path);
              const next = hiddenAfterSelection(keys, values, filters.hiddenProjects);
              onChange({ ...filters, hiddenProjects: next });
            }}
          />
        </>
      ) : null}

      {hasActiveInboxFilters(filters, source, hiddenLinearTeamIds, hiddenJiraProjectIds) ||
      codeHostProjectsActive ? (
        <>
          <div role="separator" className="my-1 h-px bg-(--ui-surface-raised)" />
          <Button
            variant="item"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(DEFAULT_INBOX_FILTERS);
              if (teamsActive) onLinearTeamsChange([]);
              if (jiraProjectsActive) onJiraProjectsChange([]);
              if (codeHostProjectsActive) onCodeHostProjectsChange?.([]);
            }}
            className="w-full text-left"
          >
            {t("Clear filters")}
          </Button>
        </>
      ) : null}
    </Popover>
  );
}

function SectionLabel({ children }: { children: string }) {
  useLocale();
  return (
    <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium text-(--ui-text-secondary)">
      {children}
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
    <label className="flex min-w-0 items-center gap-2 px-2 py-1 text-[12px] text-(--ui-tone-neutral-fg)">
      <Checkbox checked={checked} onChange={onClick} />
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
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

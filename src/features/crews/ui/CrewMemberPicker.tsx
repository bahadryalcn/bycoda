import { Text } from "../../../shared/ui/Text";
import { useMemo, useState } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { LiveText } from "../../../shared/ui/LiveText";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TabStrip } from "../../../shared/ui/Tabs";
import { X } from "../../../shared/ui/icons";
import type { CrewAgent, SavedCrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { useCrewModelPools } from "../model/crewModelPools";
import { libraryGroups } from "../model/crewRoster";
import { CrewMemberIdentity, CrewMemberMeta, visibleLibraryMembers } from "./CrewLibraryMemberMeta";
import { hiddenSelection } from "./CrewLibrarySearch";
import { CrewMemberForm } from "./CrewMemberForm";
import { rosterSearchable } from "./CrewMemberTable";

export type MemberPickerMode = "library" | "new";

/**
 * The crew editor's Add members page. Library profiles are picked several at a
 * time; a new member is described in place. The caller owns the add action.
 */
export function CrewMemberPicker({
  cwd,
  data,
  mode,
  onModeChange,
  selected,
  onSelectedChange,
  draft,
  onDraftChange,
  nameError,
  modelError,
}: {
  cwd: string;
  data: ProjectCrews;
  mode: MemberPickerMode;
  onModeChange: (mode: MemberPickerMode) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  draft: CrewAgent;
  onDraftChange: (patch: Partial<CrewAgent>) => void;
  nameError?: string;
  modelError?: string;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const hostPools = useCrewModelPools(data.machine.id, data.modelPoolsSupported === true);
  const poolNames = new Map(hostPools.pools.map((pool) => [pool.id, pool.name]));
  const groups = useMemo(() => libraryGroups(data.agents), [data.agents]);
  // Search matches what each row shows plus its instructions (CR-E06).
  const matches = visibleLibraryMembers(data.agents, data.catalog, query, group);
  // Picks survive query and group changes (CR-E07): name them and say what the filter hides.
  const picked = useMemo(() => {
    const byId = new Map(data.agents.map((agent) => [agent.id, agent]));
    return selected
      .flatMap((id) => byId.get(id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.agents, selected]);
  // Count only picks that still exist: a poll can remove a library profile.
  const hiddenCount = hiddenSelection(
    picked.map((agent) => agent.id),
    matches,
  ).length;
  const clearFilters = () => {
    setQuery("");
    setGroup("");
  };
  // Search and the group filter appear once the library is long, as in the roster.
  const long = rosterSearchable(data.agents.length, !!query.trim() || !!group);
  const toggle = (agent: SavedCrewAgent, on: boolean) =>
    onSelectedChange(on ? [...selected, agent.id] : selected.filter((id) => id !== agent.id));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TabStrip
        label={t("Add from")}
        value={mode}
        items={[
          {
            value: "library",
            label: t("Library ({p0})", { p0: data.agents.length }),
          },
          { value: "new", label: t("New member") },
        ]}
        onValueChange={(value) => onModeChange(value === "new" ? "new" : "library")}
      />
      {mode === "library" ? (
        data.agents.length === 0 ? (
          <EmptyState
            context="panel"
            kind="empty"
            title={t("Your member library is empty")}
            action={{ label: t("New member"), onClick: () => onModeChange("new") }}
          />
        ) : (
          <>
            {long ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SearchInput
                  appearance="field"
                  containerClassName="min-w-48 flex-1"
                  aria-label={t("Search name, role, model or group")}
                  placeholder={t("Search name, role, model or group")}
                  value={query}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                />
                {groups.length ? (
                  <SearchableSelect
                    hideLabel
                    label={t("Member group")}
                    value={group}
                    options={[
                      { value: "", label: t("All groups") },
                      ...groups.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={setGroup}
                  />
                ) : null}
              </div>
            ) : null}
            {/* Checked rows show the selection; only picks a filter hides need their own list. */}
            {hiddenCount > 0 ? (
              <div
                role="group"
                aria-label={t("Selected members")}
                {...surfaceAttributes(
                  { variant: "page" },
                  "flex min-w-0 flex-col gap-1.5 rounded-(--ui-radius-card) p-2",
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
                  <LiveText
                    text={t("{p0} selected, {p1} hidden by filter", {
                      p0: picked.length,
                      p1: hiddenCount,
                    })}
                  />
                  <span className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      {t("Clear filters")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onSelectedChange([])}>
                      {t("Clear selection")}
                    </Button>
                  </span>
                </div>
                <ul className="flex max-h-20 min-w-0 flex-wrap gap-1 overflow-y-auto">
                  {picked.map((agent) => (
                    <li key={agent.id} className="min-w-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t("Remove {p0}", { p0: agent.name })}
                        endIcon={<X className="icon-xs" />}
                        onClick={() => toggle(agent, false)}
                        className="max-w-48"
                      >
                        <Text size="inherit" tone="inherit" truncate>
                          {agent.name}
                        </Text>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {matches.length === 0 ? (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
                <EmptyState size="inline" kind="filtered" description={t("No matching members")} />
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  {t("Clear filters")}
                </Button>
              </div>
            ) : (
              <ul aria-label={t("Member library")} className="flex flex-col gap-0">
                {matches.map((agent) => {
                  const checked = selected.includes(agent.id);
                  return (
                    <ActionHost as="li" key={agent.id} selected={checked}>
                      <Checkbox
                        checked={checked}
                        onChange={(event) => toggle(agent, event.target.checked)}
                        label={
                          <>
                            <span className="min-w-0 flex-1">
                              <Text size="body" tone="inherit" weight="medium" className="block">
                                <CrewMemberIdentity agent={agent} />
                              </Text>
                              <CrewMemberMeta
                                agent={agent}
                                catalog={data.catalog}
                                shortScope
                                poolName={
                                  agent.modelChoice?.kind === "pool"
                                    ? poolNames.get(agent.modelChoice.poolId)
                                    : undefined
                                }
                              />
                            </span>
                            {agent.groups?.length ? (
                              <span className="min-w-0 max-w-48">
                                <BadgeList
                                  label={t("Groups")}
                                  items={agent.groups.map((name) => ({ id: name, label: name }))}
                                />
                              </span>
                            ) : null}
                          </>
                        }
                        className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-3"
                      />
                    </ActionHost>
                  );
                })}
              </ul>
            )}
          </>
        )
      ) : (
        <CrewMemberForm
          cwd={cwd}
          agent={draft}
          onChange={onDraftChange}
          groups={data.groupsSupported}
          identity={data.identitySupported}
          tools={data.toolsSupported}
          machineId={data.machine.id}
          projectId={data.project.id}
          modelPoolsSupported={data.modelPoolsSupported}
          nameError={nameError}
          modelError={modelError}
          autoFocus
        />
      )}
    </div>
  );
}

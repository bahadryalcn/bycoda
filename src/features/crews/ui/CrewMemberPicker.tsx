import { useMemo, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewAgent, CrewRole, SavedCrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { candidateLabel, libraryGroups } from "../model/crewRoster";
import { CrewMemberForm, roleLabel } from "./CrewMemberForm";

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
  role,
  nameError,
  libraryScope,
  onLibraryScopeChange,
  saveToLibrary,
  onSaveToLibraryChange,
}: {
  cwd: string;
  data: ProjectCrews;
  mode: MemberPickerMode;
  onModeChange: (mode: MemberPickerMode) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  draft: CrewAgent;
  onDraftChange: (patch: Partial<CrewAgent>) => void;
  /** The role every picked member takes when opened from a role slot. */
  role?: CrewRole;
  nameError?: string;
  libraryScope: "project" | "global";
  onLibraryScopeChange: (scope: "project" | "global") => void;
  saveToLibrary: boolean;
  onSaveToLibraryChange: (save: boolean) => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const groups = useMemo(() => libraryGroups(data.agents), [data.agents]);
  const matches = data.agents
    .filter((agent) => !group || agent.groups?.includes(group))
    .filter((agent) => {
      const q = query.trim().toLocaleLowerCase();
      return (
        !q ||
        `${agent.name} ${agent.instructions} ${(agent.groups ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (agent: SavedCrewAgent, on: boolean) =>
    onSelectedChange(on ? [...selected, agent.id] : selected.filter((id) => id !== agent.id));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SegmentedControl
        label={t("Add from")}
        value={mode}
        options={[
          {
            value: "library",
            label: t("Library ({p0})", { p0: data.agents.length }),
          },
          { value: "new", label: t("New member") },
        ]}
        onValueChange={(value) => onModeChange(value === "new" ? "new" : "library")}
      />
      {role ? (
        <p className="text-xs text-(--ui-text-secondary)">
          {t("Added members join as {p0}.", { p0: roleLabel(role) })}
        </p>
      ) : null}
      {mode === "library" ? (
        data.agents.length === 0 ? (
          <EmptyState
            title={t("Your member library is empty")}
            description={t(
              "Create a member once and reuse it in other crews and projects on this host.",
            )}
          />
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SearchInput
                appearance="field"
                containerClassName="min-w-48 flex-1"
                aria-label={t("Search members")}
                placeholder={t("Search members")}
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
              {groups.length ? (
                <SearchableSelect
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
            {matches.length === 0 ? (
              <p className="py-2 text-xs text-(--ui-text-secondary)">{t("No matching members.")}</p>
            ) : (
              <ul
                aria-label={t("Member library")}
                className="flex flex-col divide-y divide-(--ui-tone-neutral-border) overflow-hidden rounded-lg border border-(--ui-tone-neutral-border)"
              >
                {matches.map((agent) => {
                  const checked = selected.includes(agent.id);
                  return (
                    <li key={agent.id}>
                      <label className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-(--ui-surface-hover)">
                        <Checkbox
                          checked={checked}
                          onChange={(event) => toggle(agent, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{agent.name}</span>
                          <span className="block truncate text-xs text-(--ui-text-secondary)">
                            {[
                              roleLabel(agent.role),
                              candidateLabel(data.catalog, agent.candidates[0]),
                              agent.projectId ? t("This project") : t("All projects"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {agent.groups?.length ? (
                          <span className="flex max-w-[40%] flex-wrap justify-end gap-1">
                            {agent.groups.slice(0, 3).map((name) => (
                              <Badge key={name} size="sm">
                                {name}
                              </Badge>
                            ))}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )
      ) : (
        <>
          <CrewMemberForm
            cwd={cwd}
            catalog={data.catalog}
            agent={draft}
            onChange={onDraftChange}
            groups={data.groupsSupported && saveToLibrary}
            groupSuggestions={groups}
            nameError={nameError}
            autoFocus
          />
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-(--ui-tone-neutral-border) p-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={saveToLibrary}
                onChange={(event) => onSaveToLibraryChange(event.target.checked)}
              />
              {t("Also save to member library")}
            </label>
            {saveToLibrary ? (
              <SegmentedControl
                label={t("Library availability")}
                value={libraryScope}
                options={[
                  { value: "project", label: t("This project") },
                  { value: "global", label: t("All projects") },
                ]}
                onValueChange={(value) =>
                  onLibraryScopeChange(value === "global" ? "global" : "project")
                }
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

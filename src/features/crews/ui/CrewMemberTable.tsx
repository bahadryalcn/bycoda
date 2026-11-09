import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Select } from "../../../shared/ui/Select";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "../../../shared/ui/icons";
import type { CrewAgent, CrewRole } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import {
  candidateLabel,
  catalogModels,
  memberModelSummary,
  type CrewRosterIssues,
} from "../model/crewRoster";
import { matchesMemberQuery, memberSearchHaystack } from "./CrewLibrarySearch";
import { roleLabel } from "./CrewMemberForm";
import { CrewRoleIcon } from "./CrewRoleIcon";
import { MemberModelPicker } from "./MemberModelPicker";

const ROLES: CrewRole[] = ["coordinator", "specialist", "reviewer", "advisor"];

/** The roster filter earns its place only for a long roster. */
export function rosterSearchable(count: number, queryActive: boolean) {
  return count > 6 || queryActive;
}

export function issueText(issue: "missing" | "duplicate", role: CrewRole) {
  if (issue === "duplicate")
    return role === "coordinator"
      ? t("Keep exactly one coordinator.")
      : t("Keep exactly one reviewer.");
  return role === "coordinator"
    ? t("Add a coordinator.")
    : role === "reviewer"
      ? t("Add a reviewer.")
      : t("Add at least one specialist.");
}

export type CrewSection = { role: CrewRole; title: string; issue?: string };

export function crewSections(agents: CrewAgent[], issues: CrewRosterIssues): CrewSection[] {
  return [
    {
      role: "coordinator",
      title: t("Coordinator"),
      issue: issues.coordinator && issueText(issues.coordinator, "coordinator"),
    },
    {
      role: "specialist",
      title: t("Specialists"),
      issue: issues.specialist && issueText(issues.specialist, "specialist"),
    },
    {
      role: "reviewer",
      title: t("Reviewer"),
      issue: issues.reviewer && issueText(issues.reviewer, "reviewer"),
    },
    ...(agents.some((a) => a.role === "advisor")
      ? [{ role: "advisor" as const, title: t("Advisors") }]
      : []),
  ];
}

/** The one thing to fix before the draft can be saved. */
export function crewIssueSummary(
  sections: CrewSection[],
  issues: CrewRosterIssues,
  policyValid: boolean,
) {
  return (
    sections.find((s) => s.issue)?.issue ??
    (issues.name
      ? t("Name the crew.")
      : Object.keys(issues.members).length
        ? t("Every member needs a name and a model.")
        : issues.size === "large"
          ? t("A crew can have at most 20 members.")
          : !policyValid
            ? t("Check the working settings.")
            : "")
  );
}

/**
 * The roster: one compact row per member under its role. Selection, role and the pinned
 * model (with its effort) are edited in the row; the chevron opens the rest of the member
 * in place through `renderDetail`.
 */
export function CrewMemberTable({
  cwd,
  data,
  agents,
  issues,
  sections,
  selected,
  onSelectedChange,
  onChange,
  onRemove,
  expandedId,
  onExpandedChange,
  onAdd,
  onStarter,
  renderDetail,
  query,
  onQueryChange,
  unfinishedNote,
}: {
  cwd: string;
  data: ProjectCrews;
  agents: CrewAgent[];
  issues: CrewRosterIssues;
  sections: CrewSection[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onChange: (id: string, patch: Partial<CrewAgent>) => void;
  onRemove: (id: string) => void;
  expandedId: string | null;
  onExpandedChange: (id: string | null) => void;
  onAdd: (role?: CrewRole) => void;
  onStarter: () => void;
  renderDetail: (agent: CrewAgent) => ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  /** Shown while unfinished additions are kept for the Add members page. */
  unfinishedNote?: string;
}) {
  useLocale();
  const queryActive = query.trim().length > 0;
  const matches = (agent: CrewAgent) =>
    !queryActive ||
    matchesMemberQuery(
      memberSearchHaystack(agent, {
        role: roleLabel(agent.role),
        model: memberModelSummary(data.catalog, agent),
        candidates: agent.candidates.flatMap((candidate) => [
          candidateLabel(data.catalog, candidate),
          candidate.model,
          candidate.harness,
        ]),
      }),
      query,
    );
  const matchCount = agents.filter(matches).length;
  const toggle = (id: string, on: boolean) =>
    onSelectedChange(on ? [...selected, id] : selected.filter((item) => item !== id));

  if (agents.length === 0)
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-ui-body text-(--ui-text-secondary)">
          {t(
            "A crew needs a coordinator, at least one specialist and a reviewer. Pick members from your library or start with one of each.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" startIcon={<Plus />} onClick={() => onAdd()}>
            {t("Add members")}
          </Button>
          <Button
            variant="secondary"
            disabled={!catalogModels(data.catalog).length}
            onClick={onStarter}
          >
            {t("Use starter roster")}
          </Button>
        </div>
        {unfinishedNote ? (
          <p className="text-ui-caption text-(--ui-text-secondary)">{unfinishedNote}</p>
        ) : null}
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rosterSearchable(agents.length, queryActive) ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SearchInput
            appearance="field"
            containerClassName="min-w-48 max-w-80 flex-1"
            aria-label={t("Search members by name, role, model or group")}
            placeholder={t("Search members by name, role, model or group")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {queryActive ? (
            <span className="text-ui-caption tabular-nums text-(--ui-text-secondary)">
              {t("{p0} of {p1} members shown", { p0: matchCount, p1: agents.length })}
            </span>
          ) : null}
        </div>
      ) : null}
      {sections.map((section) => {
        const all = agents.filter((agent) => agent.role === section.role);
        const shown = all.filter(matches);
        return (
          <section
            key={section.role}
            aria-label={section.title}
            className="flex min-w-0 flex-col gap-1"
          >
            <div className="flex min-w-0 items-center gap-2">
              <h4 className="text-ui-body font-medium">{section.title}</h4>
              <span className="min-w-0 flex-1 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                {queryActive ? `${shown.length}/${all.length}` : all.length}
              </span>
              {all.length > 0 && (section.role === "specialist" || section.role === "advisor") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  startIcon={<Plus />}
                  onClick={() => onAdd(section.role)}
                >
                  {t("Add")}
                </Button>
              ) : null}
            </div>
            {section.issue ? (
              <p role="status" className="text-ui-caption text-danger">
                {section.issue}
              </p>
            ) : null}
            {shown.length ? (
              <ul className="flex min-w-0 flex-col gap-px">
                {shown.map((agent) => {
                  const problem = issues.members[agent.id];
                  const open = expandedId === agent.id;
                  const name = agent.name || t("Unnamed member");
                  return (
                    <li key={agent.id} className="min-w-0">
                      <ActionHost
                        className="grid! grid-cols-[auto_minmax(0,1fr)_7rem_9rem_auto] items-center gap-x-2"
                        data-member-row={agent.id}
                      >
                        <Checkbox
                          aria-label={t("Select {p0}", { p0: name })}
                          checked={selected.includes(agent.id)}
                          onChange={(event) => toggle(agent.id, event.target.checked)}
                        />
                        <Button
                          variant="item"
                          motion="none"
                          className="min-w-0"
                          aria-expanded={open}
                          startIcon={
                            <CrewRoleIcon
                              role={agent.role}
                              className="icon-xs shrink-0 text-(--ui-text-secondary)"
                            />
                          }
                          endIcon={open ? <ChevronDown /> : <ChevronRight />}
                          tooltip={open ? t("Collapse") : t("Expand")}
                          onClick={() => onExpandedChange(open ? null : agent.id)}
                        >
                          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
                            <span className="min-w-0 truncate text-ui-body font-medium">
                              {name}
                            </span>
                            {problem ? (
                              <span className="shrink-0 text-ui-caption text-danger">
                                {problem === "model" ? t("Choose a model") : t("Add a name")}
                              </span>
                            ) : agent.groups?.length ? (
                              <span className="min-w-0 flex-1 basis-0 truncate text-ui-caption text-(--ui-text-secondary)">
                                {agent.groups.join(", ")}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                        <Select
                          hideLabel
                          fieldVariant="compact"
                          label={t("Responsibility of {p0}", { p0: name })}
                          value={agent.role}
                          options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
                          onValueChange={(role) => onChange(agent.id, { role: role as CrewRole })}
                        />
                        {agent.selection === "fixed" ? (
                          <MemberModelPicker
                            cwd={cwd}
                            presentation="inline"
                            value={agent.candidates[0]}
                            onChange={(next) =>
                              onChange(agent.id, {
                                candidates: [
                                  next,
                                  ...agent.candidates.slice(1).filter((c) => c.id !== next.id),
                                ],
                              })
                            }
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onExpandedChange(agent.id)}
                          >
                            {memberModelSummary(data.catalog, agent)}
                          </Button>
                        )}
                        <InlineAction
                          reveal="always"
                          label={t("Remove {p0} from crew", { p0: agent.name || t("member") })}
                          onClick={() => onRemove(agent.id)}
                        >
                          <Trash2 aria-hidden />
                        </InlineAction>
                      </ActionHost>
                      {open ? renderDetail(agent) : null}
                    </li>
                  );
                })}
              </ul>
            ) : all.length ? (
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {t("No matching members.")}
              </p>
            ) : (
              <Button
                variant="secondary"
                className="self-start"
                startIcon={<Plus />}
                onClick={() => onAdd(section.role)}
              >
                {section.role === "coordinator"
                  ? t("Add coordinator")
                  : section.role === "reviewer"
                    ? t("Add reviewer")
                    : t("Add specialist")}
              </Button>
            )}
          </section>
        );
      })}
      {queryActive ? (
        <p role="status" className="sr-only">
          {t("{p0} of {p1} members shown", { p0: matchCount, p1: agents.length })}
        </p>
      ) : null}
      {issues.size === "large" ? (
        <p role="status" className="text-ui-caption text-danger">
          {t("A crew can have at most 20 members.")}
        </p>
      ) : null}
    </div>
  );
}

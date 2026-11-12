import { Text } from "../../../shared/ui/Text";
import { useMemo, type ReactNode } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ChevronDown, ChevronRight, GitBranch, Plus, Trash2 } from "../../../shared/ui/icons";
import type { CrewAgent, CrewRole } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import {
  candidateLabel,
  catalogModels,
  memberModelSummary,
  type CrewRosterIssues,
} from "../model/crewRoster";
import { memberLink } from "../model/crewLink";
import { useCrewModelPools } from "../model/crewModelPools";
import { matchesMemberQuery, memberSearchHaystack } from "./CrewLibrarySearch";
import { roleLabel } from "./CrewMemberForm";
import { teamTraits } from "../model/memberAvatars";
import { MemberAvatar } from "./MemberAvatar";
import { MemberModelPicker } from "./MemberModelPicker";

/** A customized member shows one muted glyph; a member that follows its library profile shows nothing. */
function MemberLinkMark({ link }: { link?: "linked" | "customized" }) {
  useLocale();
  if (link !== "customized") return null;
  return (
    <Tooltip label={t("Not following library profile")} asChild>
      <Text
        role="img"
        aria-label={t("Not following library profile")}
        size="inherit"
        className="inline-flex shrink-0"
      >
        <GitBranch className="icon-xs" aria-hidden />
      </Text>
    </Tooltip>
  );
}

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
 * The roster: one calm row per member under its role. Selection and the pinned model (with
 * its effort) are edited in the row, removal appears on hover or focus; the row opens the
 * rest of the member, including its role, in place through `renderDetail`.
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
  const looks = useMemo(() => teamTraits(agents), [agents]);
  const hostPools = useCrewModelPools(data.machine.id, data.modelPoolsSupported === true);
  const poolNames = useMemo(
    () => new Map(hostPools.pools.map((pool) => [pool.id, pool.name])),
    [hostPools.pools],
  );
  const toggle = (id: string, on: boolean) =>
    onSelectedChange(on ? [...selected, id] : selected.filter((item) => item !== id));

  if (agents.length === 0)
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <Text as="p" size="body">
          {t(
            "A crew needs a coordinator, at least one specialist and a reviewer. Pick members from your library or start with one of each.",
          )}
        </Text>
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
        {unfinishedNote ? <Text as="p">{unfinishedNote}</Text> : null}
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
            <Text className="tabular-nums">
              {t("{p0} of {p1} members shown", {
                p0: matchCount,
                p1: agents.length,
              })}
            </Text>
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
              <Heading size="item" level={4}>
                {section.title}
              </Heading>
              <Text className="min-w-0 flex-1 tabular-nums">
                {queryActive ? `${shown.length}/${all.length}` : all.length}
              </Text>
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
              <Text role="status" as="p" tone="danger">
                {section.issue}
              </Text>
            ) : null}
            {shown.length ? (
              <ul className="flex min-w-0 flex-col gap-0">
                {shown.map((agent) => {
                  const problem = issues.members[agent.id];
                  const open = expandedId === agent.id;
                  const name = agent.name || t("Unnamed member");
                  return (
                    <li key={agent.id} className="min-w-0">
                      <ActionHost
                        hoverReveal
                        className="grid! grid-cols-[auto_minmax(0,1fr)_minmax(8rem,14rem)_auto] items-center gap-x-2"
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
                            <span className="flex shrink-0 items-center gap-1.5">
                              {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                              <MemberAvatar
                                traits={looks.get(agent.id)!}
                                size={24}
                                className="shrink-0"
                              />
                            </span>
                          }
                          tooltip={open ? t("Collapse") : t("Expand")}
                          onClick={() => onExpandedChange(open ? null : agent.id)}
                        >
                          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
                            <Text
                              size="body"
                              tone="inherit"
                              weight="medium"
                              truncate
                              className="min-w-0"
                            >
                              {name}
                            </Text>
                            {data.identitySupported ? (
                              <MemberLinkMark link={memberLink(agent, data.agents)?.state} />
                            ) : null}
                            {agent.handle ? (
                              <Text className="shrink-0">@{agent.handle}</Text>
                            ) : null}
                            {problem ? (
                              <Text tone="danger" className="shrink-0">
                                {problem === "model" ? t("Choose a model") : t("Add a name")}
                              </Text>
                            ) : agent.groups?.length ? (
                              <Text truncate className="min-w-0 flex-1 basis-0">
                                {agent.groups.join(", ")}
                              </Text>
                            ) : null}
                          </span>
                        </Button>
                        <div className="flex min-w-0 justify-end">
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
                              className="min-w-0 justify-start"
                              endIcon={<ChevronDown aria-hidden />}
                              onClick={() => onExpandedChange(agent.id)}
                            >
                              <Text size="inherit" tone="inherit" truncate>
                                {(agent.pool && poolNames.get(agent.pool.id)) ||
                                  memberModelSummary(data.catalog, agent)}
                              </Text>
                            </Button>
                          )}
                        </div>
                        <InlineAction
                          label={t("Remove {p0} from crew", {
                            p0: agent.name || t("member"),
                          })}
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
              <Text as="p">{t("No matching members.")}</Text>
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
          {t("{p0} of {p1} members shown", {
            p0: matchCount,
            p1: agents.length,
          })}
        </p>
      ) : null}
      {issues.size === "large" ? (
        <Text role="status" as="p" tone="danger">
          {t("A crew can have at most 20 members.")}
        </Text>
      ) : null}
    </div>
  );
}

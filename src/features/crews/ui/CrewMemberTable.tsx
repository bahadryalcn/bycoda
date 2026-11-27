import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { useMemo, type ReactNode } from "react";
import { LiveText } from "../../../shared/ui/LiveText";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError } from "../../../shared/ui/InlineError";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { ChevronDown, GitBranch, Plus, Trash2 } from "../../../shared/ui/icons";
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
    <Text
      role="img"
      aria-label={t("Not following library profile")}
      size="inherit"
      className="inline-flex shrink-0"
    >
      <GitBranch className="icon-xs" aria-hidden />
    </Text>
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

/**
 * What blocks saving and has no line of its own: roster problems already show under their
 * section or on their row, so only the name and the limits are named here.
 */
export function crewIssueSummary(issues: CrewRosterIssues, policyValid: boolean) {
  return issues.name ? t("Name the crew.") : !policyValid ? t("Check the working settings.") : "";
}

/**
 * The roster: one calm row per member under its role. The pinned model (with its effort) is
 * edited in the row, removal appears on hover or focus; the row opens the rest of the member,
 * including its role, in place through `renderDetail`. Row checkboxes, for the bulk model bar,
 * and the search appear only once the roster is long (`rosterSearchable`).
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
  /** The empty roster's Add members button; the editor's header owns the other entry. */
  onAdd: () => void;
  onStarter: () => void;
  renderDetail: (agent: CrewAgent) => ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  /** Shown while unfinished additions are kept for the Add members page. */
  unfinishedNote?: string;
}) {
  useLocale();
  const queryActive = query.trim().length > 0;
  const long = rosterSearchable(agents.length, queryActive);
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" startIcon={<Plus />} onClick={onAdd}>
            {t("Add members")}
          </Button>
          <Button
            variant="secondary"
            disabled={!catalogModels(data.catalog).length}
            disabledReason={
              !catalogModels(data.catalog).length ? t("No models configured") : undefined
            }
            onClick={onStarter}
          >
            {t("Use starter roster")}
          </Button>
          <InfoPopover>
            {t(
              "A crew needs a coordinator, at least one specialist and a reviewer. Pick members from your library or start with one of each.",
            )}
          </InfoPopover>
        </div>
        {unfinishedNote ? <Text as="p">{unfinishedNote}</Text> : null}
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {long ? (
        <SearchInput
          appearance="field"
          containerClassName="min-w-48 max-w-80"
          aria-label={t("Search members by name, role, model or group")}
          placeholder={t("Search members by name, role, model or group")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
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
                {queryActive ? `${shown.length}/${all.length}` : all.length > 1 ? all.length : ""}
              </Text>
            </div>
            {section.issue ? <InlineError>{section.issue}</InlineError> : null}
            {shown.length ? (
              <ul className="flex min-w-0 flex-col gap-0">
                {shown.map((agent) => {
                  const problem = issues.members[agent.id];
                  const open = expandedId === agent.id;
                  const name = agent.name || t("Unnamed member");
                  const linkState = data.identitySupported
                    ? memberLink(agent, data.agents)?.state
                    : undefined;
                  const groups = !problem && agent.groups?.length ? agent.groups.join(", ") : "";
                  const hasMeta = linkState === "customized" || problem || groups;
                  return (
                    <li key={agent.id} className="@container/member-row min-w-0">
                      <ActionHost
                        hoverReveal
                        className={`grid! items-center gap-x-2 gap-y-2 @min-[28rem]/member-row:gap-y-0 ${
                          long
                            ? "grid-cols-[auto_minmax(0,1fr)_auto] @min-[28rem]/member-row:grid-cols-[auto_minmax(0,1fr)_minmax(8rem,14rem)_auto]"
                            : "grid-cols-[minmax(0,1fr)_auto] @min-[28rem]/member-row:grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)_auto]"
                        }`}
                        data-member-row={agent.id}
                      >
                        {long ? (
                          <Checkbox
                            aria-label={t("Select {p0}", { p0: name })}
                            checked={selected.includes(agent.id)}
                            onChange={(event) => toggle(agent.id, event.target.checked)}
                          />
                        ) : null}
                        <Button
                          variant="item"
                          motion="none"
                          className="min-w-0"
                          expanded={open}
                          chevron="start"
                          startIcon={
                            <span className="flex shrink-0 items-center gap-1.5">
                              <MemberAvatar
                                traits={looks.get(agent.id)!}
                                size={24}
                                className="shrink-0"
                              />
                            </span>
                          }
                          onClick={() => onExpandedChange(open ? null : agent.id)}
                        >
                          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
                            <OverflowTooltip label={name}>
                              <Text
                                size="body"
                                tone="inherit"
                                weight="medium"
                                truncate
                                className="min-w-0 flex-1"
                              >
                                {name}
                              </Text>
                            </OverflowTooltip>
                            {hasMeta ? (
                              <span className="flex max-w-[50%] shrink-0 items-baseline gap-2">
                                <MemberLinkMark link={linkState} />
                                {problem ? (
                                  <Text tone="danger" truncate className="min-w-0">
                                    {problem === "model" ? t("Choose a model") : t("Add a name")}
                                  </Text>
                                ) : groups ? (
                                  <Text truncate className="min-w-0">
                                    {groups}
                                  </Text>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                        <div
                          className={`${long ? "col-start-2" : "col-start-1"} col-span-2 row-start-2 flex min-w-0 justify-start @min-[28rem]/member-row:col-auto @min-[28rem]/member-row:row-auto @min-[28rem]/member-row:justify-end`}
                        >
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
                                {(agent.modelChoice?.kind === "pool" &&
                                  poolNames.get(agent.modelChoice.poolId)) ||
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
              <EmptyState size="inline" kind="filtered" description={t("No matching members")} />
            ) : null}
          </section>
        );
      })}
      {queryActive ? (
        <LiveText
          className="sr-only"
          text={t("{p0} of {p1} members shown", {
            p0: matchCount,
            p1: agents.length,
          })}
        />
      ) : null}
      {issues.size === "large" ? (
        <InlineError>{t("A crew can have at most 20 members.")}</InlineError>
      ) : null}
    </div>
  );
}

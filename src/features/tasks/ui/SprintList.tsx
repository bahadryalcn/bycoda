import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { useT } from "../../../shared/i18n";
import type { RemoteMachine } from "../../connections";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Surface } from "../../../shared/ui/Surface";
import { sprintProjectKey, type HostSprint } from "../model/hostSprints";
import { displayDate } from "../model/sprintDates";
import { SprintStatusBadge } from "./SprintStatusBadge";
import "./sprints.css";

const STATES = ["planned", "active", "completed", "archived"] as const;

/** The sprint rows with the status filter; the filter appears only when several states exist. */
export function SprintList({
  rows,
  accessible,
  onSelect,
  machines = [],
}: {
  rows: readonly (HostSprint & {
    catalogKey?: string;
    serverName?: string;
    unavailable?: boolean;
  })[];
  machines?: readonly RemoteMachine[];
  accessible: ReadonlySet<string>;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState("all");
  const present = STATES.filter((state) => rows.some((sprint) => sprint.state === state));
  const filtering = present.length > 1;
  // A state that no sprint has any more falls back to All.
  const stateFilter = present.some((state) => state === chosen) ? chosen : "all";
  const label = (state: string) =>
    state === "all"
      ? t("All")
      : t(
          {
            planned: "Planned",
            active: "Active",
            completed: "Completed",
            archived: "Archived",
          }[state as (typeof STATES)[number]],
        );
  // Server and machine names only tell rows apart when several machines are involved.
  const manyServers = machines.length > 1;
  const shown = rows.filter(
    (sprint) => !filtering || stateFilter === "all" || sprint.state === stateFilter,
  );
  return (
    <>
      {filtering ? (
        <SegmentedControl
          label={t("Sprint status")}
          value={stateFilter}
          onValueChange={setChosen}
          options={["all", ...present].map((value) => ({ value, label: label(value) }))}
        />
      ) : null}
      <Surface as="ul" variant="card" padding="none" dividers="pane" className="sprint-collection">
        {shown.map((sprint) => (
          <li className="sprint-row" key={sprint.catalogKey ?? sprint.id}>
            <div className="sprint-row-main">
              <Button
                variant="link"
                align="start"
                disabled={sprint.unavailable}
                disabledReason={sprint.unavailable ? t("Offline") : undefined}
                onClick={() => onSelect(sprint.catalogKey ?? sprint.id)}
              >
                {sprint.name}
              </Button>
              {sprint.serverName && (manyServers || sprint.unavailable) ? (
                <Text size="caption" tone="secondary">
                  {sprint.serverName}
                  {sprint.unavailable ? ` (${t("Offline")})` : ""}
                </Text>
              ) : null}
              {sprint.startsAt !== undefined || sprint.endsAt !== undefined ? (
                <Text tone="muted" size="caption" leading="inherit" className="sprint-row-dates">
                  {displayDate(sprint.startsAt, t("No start date"))} ·{" "}
                  {displayDate(sprint.endsAt, t("No end date"))}
                </Text>
              ) : null}
            </div>
            <BadgeList
              label={t("Projects")}
              size="xs"
              className="sprint-row-projects"
              items={sprint.projects
                .filter((project) => accessible.has(sprintProjectKey(project)))
                .map((project, index) => ({
                  id: `${index}:${project.name}`,
                  label: manyServers
                    ? `${project.name}${machines.find((machine) => machine.environmentId === project.environmentId) ? ` / ${machines.find((machine) => machine.environmentId === project.environmentId)!.name}` : ""}`
                    : project.name,
                }))}
            />
            <SprintStatusBadge state={sprint.state} />
          </li>
        ))}
      </Surface>
    </>
  );
}

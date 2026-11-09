import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
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
}: {
  rows: readonly HostSprint[];
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
      <ul className="sprint-collection">
        {shown.map((sprint) => (
          <li className="sprint-row" key={sprint.id}>
            <div className="sprint-row-main">
              <Button variant="link" align="start" onClick={() => onSelect(sprint.id)}>
                {sprint.name}
              </Button>
              {sprint.startsAt !== undefined || sprint.endsAt !== undefined ? (
                <span className="sprint-row-dates">
                  {displayDate(sprint.startsAt, t("No start date"))} ·{" "}
                  {displayDate(sprint.endsAt, t("No end date"))}
                </span>
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
                  label: project.name,
                }))}
            />
            <SprintStatusBadge state={sprint.state} />
          </li>
        ))}
      </ul>
    </>
  );
}

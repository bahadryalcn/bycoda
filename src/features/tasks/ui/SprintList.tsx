import { useState } from "react";
import { useT } from "../../../shared/i18n";
import type { RemoteMachine } from "../../connections";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Surface } from "../../../shared/ui/Surface";
import { sprintProjectKey, type HostSprint } from "../model/hostSprints";
import { sprintDateRange } from "./sprintDateRange";
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
        {shown.map((sprint) => {
          // Each project once, by name; the server is named once below, not per project.
          const names = [
            ...new Set(
              sprint.projects
                .filter((project) => accessible.has(sprintProjectKey(project)))
                .map((project) => project.name),
            ),
          ];
          const projectNames =
            names.length > 2 ? [t("{p0} projects", { p0: names.length })] : names;
          const server =
            sprint.serverName && (manyServers || sprint.unavailable)
              ? `${sprint.serverName}${sprint.unavailable ? ` (${t("Offline")})` : ""}`
              : "";
          return (
            <li key={sprint.catalogKey ?? sprint.id}>
              <CollectionRow
                title={sprint.name}
                secondary={[sprintDateRange(sprint, t), projectNames.join(", "), server]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={<SprintStatusBadge state={sprint.state} />}
                primary={{ disabled: sprint.unavailable }}
                onOpen={() => onSelect(sprint.catalogKey ?? sprint.id)}
              />
            </li>
          );
        })}
      </Surface>
    </>
  );
}

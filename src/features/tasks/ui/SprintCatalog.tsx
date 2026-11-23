import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { EmptyState } from "../../../shared/ui/EmptyState";
import type { SprintBoardController } from "../model/sprintClient";
import { sprintProjectKey, type SprintProjectRef } from "../model/hostSprints";
import { useSprintCatalog, sprintCatalogKey } from "../model/useSprintCatalog";
import { SprintList } from "./SprintList";

/** A shared list with original ownership retained for every subsequent action. */
export function SprintCatalog({
  board,
  projects,
  projectKey,
  environmentId,
  onSelect,
}: {
  board: SprintBoardController;
  projects: readonly SprintProjectRef[];
  projectKey?: string;
  environmentId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const catalog = useSprintCatalog(board.machines);
  const accessible = new Set(projects.map(sprintProjectKey));
  const sources = [...catalog.sources];
  if (board.coordinator && board.supported && !board.error) {
    const index = sources.findIndex(
      (source) => source.machine.environmentId === board.coordinatorEnvironmentId,
    );
    const current = {
      machine: board.coordinator,
      sprints: board.sprints,
      failed: false,
      error: null,
    };
    if (index < 0) sources.push(current);
    else sources[index] = current;
  }
  const rows = sources
    .sort((a, b) => a.machine.name.localeCompare(b.machine.name))
    .flatMap((source) =>
      source.sprints
        .filter((sprint) =>
          sprint.projects.some(
            (project) =>
              accessible.has(sprintProjectKey(project)) &&
              (!projectKey || sprintProjectKey(project) === projectKey) &&
              (!environmentId || project.environmentId === environmentId),
          ),
        )
        .map((sprint) => ({
          ...sprint,
          catalogKey: sprintCatalogKey(source.machine, sprint),
          serverName: source.machine.name,
          serverEnvironmentId: source.machine.environmentId,
          unavailable: source.failed,
        })),
    );
  const failures = sources.filter(
    (source) => source.failed && (!environmentId || source.machine.environmentId === environmentId),
  );
  return (
    <>
      {rows.length ? (
        <SprintList
          rows={rows}
          accessible={accessible}
          machines={board.machines}
          onSelect={(key) => {
            const selected = rows.find((row) => row.catalogKey === key);
            if (!selected || selected.unavailable) return;
            board.setCoordinatorEnvironmentId(selected.serverEnvironmentId);
            onSelect(selected.id);
          }}
        />
      ) : catalog.loading ? (
        <SurfaceLoading label={t("Loading sprints…")} />
      ) : !failures.length ? (
        <EmptyState
          size="inline"
          description={
            projectKey || environmentId ? t("No sprints match these filters.") : t("No sprints yet")
          }
        />
      ) : null}
      {failures.map((source) =>
        source.error ? (
          <InlineError key={source.machine.environmentId}>
            {source.machine.name}: {source.error}
          </InlineError>
        ) : null,
      )}
      {/* The planning server's own read error shows here unless its catalog read already failed. */}
      {board.error &&
      !failures.some(
        (source) => source.error && source.machine.environmentId === board.coordinatorEnvironmentId,
      ) ? (
        <InlineError>{board.error}</InlineError>
      ) : null}
    </>
  );
}

import { useState, type Dispatch, type SetStateAction } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LayoutGrid, ListBullet, Plus } from "../../../../shared/ui/icons";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import type { ProjectCrews, CrewRunView } from "../../model/crewClient";
import { activeCrewRuns } from "../../model/crewRoster";
import type { OpenCrewSession } from "../CrewDialogHost";
import { crewMenuDialog, type CrewDialog } from "../crewMenuItems";
import { CrewTeamItem } from "./CrewTeamItem";

type Layout = "cards" | "list";

/** Saved crews as cards or rows with a name filter. */
export function CrewsTeams({
  cwd,
  data,
  setDialog,
  onOpenSession,
}: {
  cwd: string;
  data: ProjectCrews;
  setDialog: Dispatch<SetStateAction<CrewDialog | null>>;
  onOpenSession?: OpenCrewSession;
}) {
  const [layout, setLayout] = useState<Layout>("cards");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const crews = needle
    ? data.definitions.filter((crew) => crew.name.toLocaleLowerCase().includes(needle))
    : data.definitions;
  const openCoordinator = (run: CrewRunView) => {
    const sessionId = run.coordinatorSessionId;
    if (!sessionId || !onOpenSession) return;
    setError("");
    Promise.resolve(
      onOpenSession({ cwd, machineId: data.machine.id, projectId: data.project.id, sessionId }),
    ).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  if (!data.definitions.length)
    return (
      <EmptyState
        context="page"
        kind="empty"
        title={t("No crews yet")}
        description={t("Create a team of members that works on a task together.")}
        action={
          <Button
            variant="primary"
            startIcon={<Plus className="icon-sm" />}
            onClick={() => setDialog({ kind: "edit", createScope: "project" })}
          >
            {t("Create your first crew")}
          </Button>
        }
      />
    );
  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          appearance="field"
          containerClassName="min-w-0 max-w-96 flex-1"
          aria-label={t("Filter crews")}
          placeholder={t("Filter crews")}
          clearable
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SegmentedControl
          label={t("Crew layout")}
          value={layout}
          onValueChange={(value) => setLayout(value as Layout)}
          options={[
            { value: "cards", label: t("Cards"), icon: <LayoutGrid className="icon-sm" /> },
            { value: "list", label: t("List"), icon: <ListBullet className="icon-sm" /> },
          ]}
        />
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {crews.length === 0 ? (
        <EmptyState
          context="panel"
          kind="filtered"
          description={t("No crews match your filter.")}
          onReset={() => setQuery("")}
        />
      ) : (
        <ul
          aria-label={t("Crews")}
          className={
            layout === "cards"
              ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3"
              : "flex flex-col gap-2"
          }
        >
          {crews.map((crew) => (
            <CrewTeamItem
              key={crew.id}
              crew={crew}
              runs={activeCrewRuns(data.runs, crew.id)}
              layout={layout}
              deleteSupported={data.deleteSupported}
              canOpenCoordinator={!!onOpenSession}
              onStart={() => setDialog({ kind: "start", definitionId: crew.id })}
              onEdit={() => setDialog({ kind: "edit", crewId: crew.id })}
              onPick={(id, single) => {
                if (id === "open" && single) openCoordinator(single);
                else {
                  const next = crewMenuDialog(id, crew);
                  if (next) setDialog(next);
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

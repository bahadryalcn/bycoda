import { useEffect, useState, type ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronRight } from "../../../shared/ui/icons";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews } from "../model/crewClient";
import { crewRunMatchesQuery } from "../model/crewPresentation";
import { crewRunTitle } from "../model/crewRoster";
import { CrewWorkManager } from "./CrewWorkManager";
import { CrewWorkStatusText } from "./CrewWorkState";
import { classifyRemoteError, isConnectionFailure } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { useRemoteConnectionFeedback } from "../../connections/ui/RemoteConnectionFeedback";

import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
export type OpenSession = (target: BackgroundSessionTarget) => void | Promise<void>;
type CrewState = ReturnType<typeof useProjectCrews>;

/** Only query transport failures belong to the machine notice; mutations keep their own outcomes. */
function useCrewConnectionFeedback(cwd: string, state: CrewState) {
  const failure = state.error ? classifyRemoteError(state.error) : undefined;
  const connectionFailure = failure && isConnectionFailure(failure);
  const sharedConnectionIssue = useRemoteConnectionFeedback(cwd, failure);
  // Keyed on values, not the data object: a report re-renders the sidebar, so an
  // effect that ran on every new object looped forever (React #185).
  const loaded = state.isSuccess && !!state.data;
  useEffect(() => {
    if (state.error && connectionFailure) reportRemoteConnection(cwd, "crews", state.error);
    else if (loaded) reportRemoteConnection(cwd, "crews");
  }, [cwd, state.error, loaded, connectionFailure]);
  return !!connectionFailure && sharedConnectionIssue;
}

export function CrewSidebar({
  cwd,
  onManagedChange,
  ...props
}: {
  cwd: string;
  query?: string;
  onOpen: OpenSession;
  onManagedChange: (cwd: string, ids: string[]) => void;
}) {
  const state = useProjectCrews(cwd);
  // The managed ids as one value, so the parent hears only real changes; a new
  // data object on each render must not set parent state on each render.
  const managed = state.data
    ? JSON.stringify(
        state.data.runs
          .flatMap((run) => [
            run.coordinatorSessionId,
            ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
          ])
          .filter((id): id is string => !!id),
      )
    : undefined;
  useEffect(() => {
    if (managed === undefined) return;
    onManagedChange(cwd, JSON.parse(managed) as string[]);
  }, [cwd, managed, onManagedChange]);
  return <CrewSessions cwd={cwd} state={state} {...props} />;
}

/** Navigation stays compact. All operations and conversations live in one work view. */
export function CrewSessions({
  cwd,
  state,
  query = "",
  definitionId,
  onOpen,
}: {
  cwd: string;
  state: CrewState;
  query?: string;
  definitionId?: string;
  onOpen?: OpenSession;
}) {
  useLocale();
  const [opened, setOpened] = useState<{
    definitionId?: string;
    runId?: string;
  } | null>(null);
  const data = state.data;
  const sharedConnectionIssue = useCrewConnectionFeedback(cwd, state);
  const q = query.trim();
  const runs = [...(data?.runs ?? [])]
    .filter(
      (run) => run.status !== "finished" && (!definitionId || run.definition.id === definitionId),
    )
    .filter((run) => crewRunMatchesQuery(run, q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!data && !state.error) return null;
  if (data && !data.runs.length && !data.definitions.length && !state.error) return null;
  return (
    // A quiet section label on the list's gutter. With nothing running it is only this one
    // line (and Manage), so an idle project spends no rows on an empty state.
    <section aria-label={t("Crew work")} className="px-1.5 pt-1">
      <div className="flex min-h-7 items-center gap-1 ps-2.5 pe-0.5">
        <span className="min-w-0 flex-1 text-ui-caption font-medium text-(--ui-text-muted)">
          {t("Crew work")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!data}
          onClick={() => setOpened({ definitionId })}
        >
          {t("Manage")}
        </Button>
      </div>
      {state.error && !sharedConnectionIssue ? (
        <Button variant="ghost" onClick={() => void state.refetch()} tooltip={state.error.message}>
          {t("Crew host unavailable. Retry")}
        </Button>
      ) : null}
      {sharedConnectionIssue && !data ? (
        <p role="status" className="px-2.5 py-1 text-ui-caption text-(--ui-text-muted)">
          {t("Not connected")}
        </p>
      ) : null}
      <div className="flex flex-col gap-px empty:hidden">
        {runs.map((run) => (
          <Button
            key={run.id}
            data-crew-work-link={run.id}
            variant="item"
            motion="none"
            className="min-w-0 w-full"
            onClick={() => setOpened({ definitionId: run.definition.id, runId: run.id })}
            tooltip={crewRunTitle(run)}
            tooltipWhen="overflow"
          >
            <span className="min-w-0 flex-1 text-start">
              <span className="block truncate font-medium">{crewRunTitle(run)}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-2 text-ui-caption text-(--ui-text-secondary)">
                <span className="truncate">{run.definition.name}</span>
                <CrewWorkStatusText run={run} />
              </span>
            </span>
            <ChevronRight className="icon-sm shrink-0" />
          </Button>
        ))}
      </div>
      {opened ? (
        <CrewManagementDialog
          cwd={cwd}
          state={state}
          definitionId={opened.definitionId}
          initialRunId={opened.runId}
          onOpen={onOpen}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </section>
  );
}

/** The Crew work dialog: the shared work manager in a modal. */
export function CrewManagementDialog(
  props: Omit<ComponentProps<typeof CrewWorkManager>, "layout">,
) {
  return <CrewWorkManager {...props} layout="dialog" />;
}

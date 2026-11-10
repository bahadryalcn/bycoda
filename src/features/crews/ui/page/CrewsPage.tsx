import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Bot, Plus } from "../../../../shared/ui/icons";
import { PaneHeader, type PaneHeaderProps } from "../../../../shared/ui/PaneHeader";
import { TabList, TabPanel, Tabs, type TabItem } from "../../../../shared/ui/Tabs";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { useActiveCrewMembers, useActiveCrewSupported } from "../../model/crewActive";
import { useProjectCrews } from "../../model/crewClient";
import { consumeCrewsPageRequest, usePendingCrewsPageRequest } from "../../model/crewsPage";
import { CrewDialogHost, type OpenCrewSession } from "../CrewDialogHost";
import type { CrewDialog } from "../crewMenuItems";
import { CrewLibrary } from "../CrewLibrary";
import { CrewsActive } from "./CrewsActive";
import { CrewsModelPools } from "./CrewsModelPools";
import { CrewsLoadState } from "./CrewsLoadState";
import { CrewsTeams } from "./CrewsTeams";
import { CrewsWork } from "./CrewsWork";

type CrewsTab = "active" | "teams" | "members" | "models" | "work";

/** The page's tabs in order; a new tab is one entry here plus its branch in `CrewsPage`. */
function crewsTabs(activeCount: number | null, models: boolean): TabItem<CrewsTab>[] {
  return [
    ...(activeCount === null
      ? []
      : [{ value: "active" as const, label: t("Active"), count: activeCount }]),
    { value: "teams", label: t("Teams") },
    { value: "members", label: t("Members") },
    ...(models ? [{ value: "models" as const, label: t("Models") }] : []),
    { value: "work", label: t("Work") },
  ];
}

export type CrewsPageProps = {
  cwd: string;
  /** Window chrome supplied by the app shell. */
  chromeInset?: PaneHeaderProps["chromeInset"];
  leading?: ReactNode;
  trailing?: ReactNode;
  /** The workspace tool tabs; they take the title's place, as in the other tools. */
  navigation?: ReactNode;
  onOpenSession?: OpenCrewSession;
};

/** Full-page Crews: saved teams, the member library and ongoing work for the current project. */
export function CrewsPage({ cwd, chromeInset, leading, trailing, onOpenSession }: CrewsPageProps) {
  useLocale();
  const state = useProjectCrews(cwd);
  const supported = useActiveCrewSupported();
  const active = useActiveCrewMembers(supported);
  const activeItems = active.data?.items;
  const [picked, setPicked] = useState<CrewsTab | null>(null);
  const [workTarget, setWorkTarget] = useState<{
    definitionId?: string;
    runId?: string;
    nonce: number;
  }>({ nonce: 0 });
  const request = usePendingCrewsPageRequest();
  // A landing request is applied while rendering, once per nonce; the store is cleared after commit.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (request && request.nonce !== appliedNonce) {
    setAppliedNonce(request.nonce);
    if (request.tab) setPicked(request.tab);
    if (request.definitionId || request.runId) {
      setWorkTarget({
        definitionId: request.definitionId,
        runId: request.runId,
        nonce: request.nonce,
      });
      if (!request.tab) setPicked("work");
    }
  }
  useEffect(() => {
    if (request) consumeCrewsPageRequest(request);
  }, [request]);
  // Until the owner picks a tab: Active when someone is working, else Teams.
  const tab: CrewsTab =
    picked && (picked !== "active" || supported)
      ? picked
      : supported && (!active.data || active.data.items.length > 0)
        ? "active"
        : "teams";
  const setTab = setPicked;
  const [dialog, setDialog] = useState<CrewDialog | null>(null);
  const noProject = !cwd || cwd === "~";
  const known = useMemo(
    () =>
      state.data
        ? { machineId: state.data.machine.id, projectId: state.data.project.id, cwd }
        : undefined,
    [state.data, cwd],
  );
  return (
    <div data-app-crews className="flex min-h-0 min-w-0 flex-1 flex-col text-content">
      <Tabs value={tab} onValueChange={setTab} panels="shared">
        <PaneHeader
          dragRegion
          chromeInset={chromeInset}
          className="select-none"
          leading={leading}
          icon={<Bot className="icon-sm" />}
          title={t("Crews")}
          meta={t("Teams, members and work for this project")}
          actions={
            <Button
              variant="primary"
              startIcon={<Plus className="icon-sm" />}
              disabled={!state.data}
              onClick={() => setDialog({ kind: "edit", createScope: "project" })}
            >
              {t("New crew")}
            </Button>
          }
          trailing={trailing}
        />
        <div className="border-b border-stroke px-3 py-1.5">
          <TabList
            label={t("Crews sections")}
            items={crewsTabs(
              supported ? (activeItems?.length ?? 0) : null,
              state.data?.modelPoolsSupported === true,
            )}
          />
        </div>
        <TabPanel className="min-h-0 flex-1 overflow-y-auto">
          {tab === "active" ? (
            active.data ? (
              <CrewsActive
                items={active.data.items}
                truncated={active.data.truncated}
                known={known}
                onOpenSession={onOpenSession}
                onOpenWork={(item) => {
                  setWorkTarget({
                    definitionId: item.definitionId,
                    runId: item.runId,
                    nonce: workTarget.nonce + 1,
                  });
                  setPicked("work");
                }}
                onNewWork={() => setDialog({ kind: "start" })}
              />
            ) : (
              <div className="p-4">
                <LoadingText>{t("Loading crews…")}</LoadingText>
              </div>
            )
          ) : (
            <CrewsLoadState state={state} noProject={noProject}>
              {(data) =>
                tab === "teams" ? (
                  <CrewsTeams
                    cwd={cwd}
                    data={data}
                    setDialog={setDialog}
                    onOpenSession={onOpenSession}
                  />
                ) : tab === "members" ? (
                  <div className="settings-topics p-4">
                    <CrewLibrary cwd={cwd} state={state} data={data} />
                  </div>
                ) : tab === "models" ? (
                  <CrewsModelPools data={data} />
                ) : (
                  <CrewsWork
                    key={workTarget.nonce}
                    cwd={cwd}
                    state={state}
                    definitionId={workTarget.definitionId}
                    initialRunId={workTarget.runId}
                    onOpenSession={onOpenSession}
                  />
                )
              }
            </CrewsLoadState>
          )}
        </TabPanel>
      </Tabs>
      <CrewDialogHost
        cwd={cwd}
        state={state}
        dialog={dialog}
        setDialog={setDialog}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Bot, Plus } from "../../../../shared/ui/icons";
import { PaneHeader, type PaneHeaderProps } from "../../../../shared/ui/PaneHeader";
import { TabList, TabPanel, Tabs, type TabItem } from "../../../../shared/ui/Tabs";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { InlineError } from "../../../../shared/ui/InlineError";
import { useActiveCrewMembers, useActiveCrewSupported } from "../../model/crewActive";
import { useProjectCrews } from "../../model/crewClient";
import { consumeCrewsPageRequest, usePendingCrewsPageRequest } from "../../model/crewsPage";
import { CrewDialogHost, type OpenCrewSession } from "../CrewDialogHost";
import type { CrewDialog } from "../crewMenuItems";
import { CrewLibrary } from "../CrewLibrary";
import { CrewsActive } from "./CrewsActive";
import { CrewsLoadState } from "./CrewsLoadState";
import { CrewsTeams } from "./CrewsTeams";
import { CrewsWork } from "./CrewsWork";

type CrewsTab = "active" | "teams" | "members" | "work";

/** The page's tabs in order; a new tab is one entry here plus its branch in `CrewsPage`. */
function crewsTabs(activeCount: number | null | undefined): TabItem<CrewsTab>[] {
  return [
    ...(activeCount === null
      ? []
      : [{ value: "active" as const, label: t("Active"), count: activeCount }]),
    { value: "teams", label: t("Teams") },
    { value: "members", label: t("Members") },
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
  renderCoordinator?: (target: import("../../../tasks").BackgroundSessionTarget) => ReactNode;
};

/** Full-page Crews: saved teams, the member library and ongoing work for the current project. */
export function CrewsPage({
  cwd,
  chromeInset,
  leading,
  trailing,
  navigation,
  onOpenSession,
  renderCoordinator,
}: CrewsPageProps) {
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
    <Text
      data-app-crews
      as="div"
      size="inherit"
      tone="primary"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <Tabs value={tab} onValueChange={setTab} panels="shared">
        <PaneHeader
          dragRegion
          chromeInset={chromeInset}
          className="select-none"
          leading={leading}
          icon={navigation ? undefined : <Bot className="icon-sm" />}
          title={navigation ? undefined : t("Crews")}
          meta={navigation ? undefined : t("Teams, members and work for this project")}
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
        >
          {navigation}
        </PaneHeader>
        <div {...surfaceAttributes({ frame: "stroke", edge: "bottom" }, "px-3 py-1.5")}>
          <TabList
            label={t("Crews sections")}
            items={crewsTabs(supported ? activeItems?.length : null)}
          />
        </div>
        <TabPanel className="min-h-0 flex-1 overflow-y-auto">
          {tab === "active" ? (
            <>
              {active.error ? (
                <div className="p-4">
                  <InlineError
                    retry={{ onRetry: () => void active.refetch(), pending: active.isFetching }}
                  >
                    {active.error instanceof Error ? active.error.message : String(active.error)}
                  </InlineError>
                </div>
              ) : null}
              {active.data ? (
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
              ) : !active.error ? (
                <div className="p-4">
                  <LoadingText>{t("Loading crews…")}</LoadingText>
                </div>
              ) : null}
            </>
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
                ) : (
                  <CrewsWork
                    key={workTarget.nonce}
                    cwd={cwd}
                    state={state}
                    definitionId={workTarget.definitionId}
                    initialRunId={workTarget.runId}
                    renderCoordinator={renderCoordinator}
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
    </Text>
  );
}

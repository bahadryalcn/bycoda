import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useEffect, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Bot, Plus } from "../../../../shared/ui/icons";
import { PaneHeader, type PaneHeaderProps } from "../../../../shared/ui/PaneHeader";
import { TabList, TabPanel, Tabs, type TabItem } from "../../../../shared/ui/Tabs";
import { useProjectCrews } from "../../model/crewClient";
import { crewOpenAttention } from "../../model/crewPresentation";
import { consumeCrewsPageRequest, usePendingCrewsPageRequest } from "../../model/crewsPage";
import { CrewDialogHost } from "../CrewDialogHost";
import type { CrewDialog } from "../crewMenuItems";
import { CrewLibrary } from "../CrewLibrary";
import type { OpenCrewSession } from "../CrewWorkManager";
import { CrewsActive } from "./CrewsActive";
import { CrewsLoadState } from "./CrewsLoadState";
import { CrewsTeams } from "./CrewsTeams";
import { CrewsWork } from "./CrewsWork";

type CrewsTab = "teams" | "members" | "work";

/** The page's tabs in order; a new tab is one entry here plus its branch in `CrewsPage`. */
function crewsTabs(): TabItem<CrewsTab>[] {
  return [
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

/** Full-page Crews: saved teams, the member library and the work of the current project. */
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
  const [picked, setPicked] = useState<CrewsTab | null>(null);
  const [workTarget, setWorkTarget] = useState<{
    definitionId?: string;
    runId?: string;
    nonce: number;
  }>({ nonce: 0 });
  // The crew the Work tab shows, so the header's "New work" starts work for it.
  const [workCrewId, setWorkCrewId] = useState<string>();
  const [newMemberOpen, setNewMemberOpen] = useState(false);
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
    // The request is applied during render above; clearing it after commit lets the next one land.
    if (request) consumeCrewsPageRequest(request);
  }, [request]);
  const noProject = !cwd || cwd === "~";
  // Until the owner picks a tab: Work when something needs a decision or no project is open
  // (work on other projects is all this page can show then), else Teams.
  const needsOwner = !!state.data?.runs.some((run) => crewOpenAttention(run));
  const landing: CrewsTab = needsOwner || noProject ? "work" : "teams";
  // Pin the landing tab once data decides it, so a resolved decision cannot move the page.
  if (picked === null && state.data && !request) setPicked(landing);
  const tab: CrewsTab = picked ?? landing;
  const [dialog, setDialog] = useState<CrewDialog | null>(null);
  const definitions = state.data?.definitions;
  const known = state.data
    ? { machineId: state.data.machine.id, projectId: state.data.project.id, cwd }
    : undefined;
  const header =
    tab === "members"
      ? {
          label: t("New member"),
          disabled: !state.data,
          reason: t("Wait for the crews to load first."),
          onClick: () => setNewMemberOpen(true),
        }
      : tab === "work"
        ? {
            label: t("New work"),
            disabled: !definitions?.length,
            reason: t("Create a crew first."),
            onClick: () =>
              setDialog({
                kind: "start",
                // A deleted crew keeps its work but cannot start more.
                definitionId: definitions?.some((crew) => crew.id === workCrewId)
                  ? workCrewId
                  : undefined,
              }),
          }
        : {
            label: t("New crew"),
            disabled: !state.data,
            reason: t("Wait for the crews to load first."),
            onClick: () => setDialog({ kind: "edit", createScope: "project" }),
          };
  return (
    <Text
      data-app-crews
      as="div"
      size="inherit"
      tone="primary"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <Tabs value={tab} onValueChange={setPicked} panels="shared">
        <PaneHeader
          dragRegion
          chromeInset={chromeInset}
          className="select-none"
          leading={leading}
          icon={navigation ? undefined : <Bot className="icon-sm" />}
          title={navigation ? undefined : t("Crews")}
          actions={
            <Button
              variant="primary"
              startIcon={<Plus className="icon-sm" />}
              disabled={header.disabled}
              disabledReason={header.disabled ? header.reason : undefined}
              onClick={header.onClick}
            >
              {header.label}
            </Button>
          }
          trailing={trailing}
        >
          {navigation}
        </PaneHeader>
        <div {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "px-3 py-1.5")}>
          <TabList label={t("Crews sections")} items={crewsTabs()} />
        </div>
        <TabPanel className="flex min-h-0 w-full max-w-336 flex-1 flex-col self-center overflow-y-auto">
          {tab === "work" ? <CrewsActive known={known} onOpenSession={onOpenSession} /> : null}
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
                <div className="settings-topics flex-1 p-4">
                  <CrewLibrary
                    cwd={cwd}
                    state={state}
                    data={data}
                    newMemberOpen={newMemberOpen}
                    onNewMember={() => setNewMemberOpen(true)}
                    onNewMemberClose={() => setNewMemberOpen(false)}
                  />
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
                  onCrewChange={setWorkCrewId}
                />
              )
            }
          </CrewsLoadState>
        </TabPanel>
      </Tabs>
      <CrewDialogHost cwd={cwd} state={state} dialog={dialog} setDialog={setDialog} />
    </Text>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t, useLocale } from "../../../shared/i18n";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { FailureState } from "../../../shared/ui/FailureState";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { Sparkles, Plus, Zap } from "../../../shared/ui/icons";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { Text } from "../../../shared/ui/Text";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { IS_MAC } from "../../../platform/tauri/platform";
import type { RemoteMachine } from "../../connections/model/protocol";
import { HostModelSource } from "../../connections/ui/HostModelSource";
import { UnreachableMachinesNotice } from "../../connections/public/UnreachableMachinesNotice";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/public/lockState";
import type { RecentProject } from "../../projects/model/recents";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";
import { unreachableNotice, useAutomationActions } from "../hooks/useAutomationActions";
import { useAutomationDraftStart } from "../hooks/useAutomationDraftStart";
import { useAutomationHistory } from "../hooks/useAutomationHistory";
import { useHostAutomations } from "../hooks/useHostAutomations";
import { assistantAutomationSelection } from "../model/assistantAutomationSelection";
import { automationKey } from "../model/automationKey";
import { automationName } from "../model/automationDraftRules";
import {
  applyAutomationChange,
  draftFromAutomation,
  listAutomations,
  peekAutomations,
  subscribeAutomations,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "../model/automations";
import { backgroundMachineFor } from "../model/hostAutomationClient";
import { AutomationAssistant } from "./AutomationAssistant";
import { AutomationEditor } from "./AutomationEditor";
import { AutomationFilter } from "./AutomationFilter";
import { AutomationList } from "./AutomationList";
import "./automations.css";

/** The list is searched and filtered only once it is long enough to need it. */
const FILTER_MIN_AUTOMATIONS = 8;

type Props = {
  revealAutomation?: import("../../assistant/model/assistantAutomationReveal").AssistantAutomationReveal;
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  recents: RecentProject[];
  onClose: () => void;
  onToggleSidebar?: () => void;
  onLaunchAssistant?: (launch: QuickLaunch, deliveryId: string) => Promise<unknown>;
  onLaunch: (automation: Automation, run: AutomationRun) => void | Promise<void>;
  onOpenTask?: (
    target: import("../../tasks/model/taskReveal").TaskRevealTarget,
  ) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  /** Opens a session a machine's host ran for a background automation. */
  onOpenBackgroundSession: (target: BackgroundSessionTarget) => void | Promise<void>;
};

export function AutomationsView({
  revealAutomation,
  besideRail = false,
  compactRail = false,
  cwd,
  recents,
  onClose,
  onToggleSidebar,
  onLaunchAssistant,
  onLaunch,
  onOpenSession,
  onOpenBackgroundSession,
  onOpenTask,
}: Props) {
  useLocale();
  // Inside the workspace the tool switcher takes the title's place.
  const toolNavigation = useContext(ToolNavigationContext)?.active != null;
  return (
    <Text
      as="div"
      size="inherit"
      tone="neutral"
      role="region"
      aria-label={t("Automations")}
      data-app-automations
      className="flex min-h-0 min-w-0 flex-1 flex-col [container-type:inline-size] [container-name:automations]"
    >
      <PaneHeader
        chromeInset={besideRail ? (compactRail ? "compact" : false) : true}
        dragRegion
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        icon={toolNavigation ? undefined : <Zap strokeWidth={1.75} />}
        title={toolNavigation ? undefined : t("Automations")}
        trailing={IS_MAC ? null : <WindowControls />}
        className={toolNavigation ? "items-stretch" : undefined}
      >
        {toolNavigation ? <ToolNavigation /> : null}
      </PaneHeader>
      <AutomationsContent
        revealAutomation={revealAutomation}
        cwd={cwd}
        recents={recents}
        onLaunch={onLaunch}
        onOpenSession={onOpenSession}
        onOpenBackgroundSession={onOpenBackgroundSession}
        onOpenTask={onOpenTask}
        onLaunchAssistant={onLaunchAssistant}
      />
    </Text>
  );
}

function AutomationsContent({
  revealAutomation,
  cwd,
  recents,
  onLaunch,
  onOpenSession,
  onOpenBackgroundSession,
  onOpenTask,
  onLaunchAssistant,
}: Pick<
  Props,
  | "revealAutomation"
  | "cwd"
  | "recents"
  | "onLaunch"
  | "onOpenSession"
  | "onOpenBackgroundSession"
  | "onOpenTask"
  | "onLaunchAssistant"
>) {
  useLocale();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const queryVisible = useQueryVisible();
  const localQuery = useQuery({
    queryKey: ["automations", "local"],
    queryFn: listAutomations,
    initialData: () => peekAutomations() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    enabled: queryVisible,
    retry: false,
  });
  const storedAutomations = localQuery.data ?? [];
  // Automations aimed at a project in a locked group are not listed.
  const lock = useLockSnapshot();
  // Automations that machines' hosts run on their own, this computer's included.
  const host = useHostAutomations(queryVisible);
  const {
    machines,
    unreachable: unreachableNames,
    automations: hostAutomations,
    refresh: refreshHost,
  } = host;
  const automations = useMemo(
    () =>
      [...storedAutomations, ...hostAutomations].filter(
        (automation) => !isProjectLockedIn(lock, automation.cwd),
      ),
    [hostAutomations, lock, storedAutomations],
  );
  const collectionPending = localQuery.isPending || !host.loaded;
  const loading =
    !automations.length &&
    collectionPending &&
    !localQuery.isError &&
    !host.error &&
    !unreachableNames.length;
  const paused = loading && !queryVisible && !localQuery.isFetching && !host.fetching;
  const viewStateKey = `automations:${cwd ? projectKey(cwd) : "global"}`;
  const [storedSelectedId, setSelectedId] = useRetainedState<string | null>(
    `${viewStateKey}:selected`,
    null,
  );
  const [query, setQuery] = useRetainedState(`${viewStateKey}:query`, "");
  const [statusFilter, setStatusFilter] = useRetainedState(`${viewStateKey}:status`, "all");
  const [compactListOpen, setCompactListOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const [draft, setDraft] = useRetainedState<AutomationDraft | null>(`${viewStateKey}:draft`, null);
  const [groupLabels] = useState(loadTabGroupLabels);

  useEffect(
    () =>
      subscribeAutomations((change) => {
        const current = queryClient.getQueryData<Automation[]>(["automations", "local"]);
        if (change && current) {
          // A confirmed local mutation is authoritative; discard an older list read.
          void queryClient.cancelQueries({ queryKey: ["automations", "local"] }, { revert: false });
          queryClient.setQueryData<Automation[]>(
            ["automations", "local"],
            applyAutomationChange(current, change),
          );
        } else void queryClient.invalidateQueries({ queryKey: ["automations"] });
      }),
    [queryClient],
  );
  // The retained choice, normalized against the lists. While the local or host
  // list is still arriving it stands, so a retained host selection survives.
  const selectedId =
    storedSelectedId &&
    (localQuery.isPending ||
      !host.loaded ||
      automations.some((entry) => automationKey(entry) === storedSelectedId))
      ? storedSelectedId
      : automations[0]
        ? automationKey(automations[0])
        : null;
  const history = useAutomationHistory({
    selectedId,
    target: automations.find((entry) => automationKey(entry) === selectedId),
    enabled: queryVisible,
  });

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return automations.filter((automation) => {
      if (statusFilter === "active" && !automation.enabled) return false;
      if (statusFilter === "paused" && automation.enabled) return false;
      if (
        statusFilter === "attention" &&
        automation.lastRunStatus !== "failed" &&
        !automation.host?.needsInput
      )
        return false;
      if (!needle) return true;
      const project = resolveTabGroupLabel(
        projectKey(automation.cwd),
        groupLabels,
        projectName(automation.cwd),
      );
      return `${automation.name}\n${automation.prompt}\n${project}\n${automation.cwd}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [automations, groupLabels, deferredQuery, statusFilter]);
  const selected = automations.find((entry) => automationKey(entry) === selectedId) ?? null;

  const {
    saving,
    savingRef,
    running,
    deleting,
    toggling,
    actionError,
    setActionError,
    onSave,
    onRun,
    onDelete,
    onToggle,
    confirmDiscard,
  } = useAutomationActions({
    machines,
    confirmSaved: host.confirmSaved,
    confirmDeleted: host.confirmDeleted,
    refreshHost,
    selected,
    selectedId,
    runs: history.runs,
    errorStamp: localQuery.data,
    confirm,
    setDraft,
    setSelectedId,
    onLaunch,
  });
  const { beginBlank } = useAutomationDraftStart({
    cwd,
    recents,
    selected,
    savingRef,
    setDraft,
  });
  // Collection failures block first use; one offline machine only makes its own data unknown.
  // The central connection notice already explains machines that did not answer.
  const unreachableShownCentrally = useConnectionErrorShownCentrally(host.unreachableDetail);
  const readFailed = (localQuery.isError && storedAutomations.length === 0) || !!host.error;
  const error = actionError ?? (readFailed ? null : (localQuery.error?.message ?? null));

  const editorDraft = draft ?? (selected ? draftFromAutomation(selected) : null);
  const machine = editorDraft ? editorMachine(machines, selected, editorDraft) : undefined;
  const hasAutomations = automations.length > 0;
  const showList = (!paused && loading) || hasAutomations;
  const filtered = !!query.trim() || statusFilter !== "all";
  const resetFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };
  const [revealStatus, setRevealStatus] = useState<"" | "draft" | "filter" | "unavailable">("");
  const revealAttempt = useRef<number | undefined>(undefined);
  const revealDone = useRef<number | undefined>(undefined);
  function applyReveal(resetFilters = false, refreshMissing = true) {
    if (!revealAutomation || revealDone.current === revealAutomation.token) return;
    if (draft || savingRef.current) {
      setRevealStatus("draft");
      return;
    }
    const target = assistantAutomationSelection(
      revealAutomation,
      automations,
      (path) =>
        recents.some((project) => projectKey(project.path) === projectKey(path)) &&
        !isProjectLockedIn(lock, path),
    );
    if (!target) {
      setRevealStatus("unavailable");
      if (refreshMissing && queryVisible) void refreshHost();
      return;
    }
    if (!resetFilters && !visible.some((row) => automationKey(row) === automationKey(target))) {
      setRevealStatus("filter");
      return;
    }
    if (resetFilters) {
      setQuery("");
      setStatusFilter("all");
    }
    setSelectedId(automationKey(target));
    setCompactListOpen(false);
    revealDone.current = revealAutomation.token;
    setRevealStatus("");
  }
  useEffect(() => {
    if (!revealAutomation || !host.loaded || revealDone.current === revealAutomation.token) return;
    const refreshMissing = revealAttempt.current !== revealAutomation.token;
    revealAttempt.current = revealAutomation.token;
    applyReveal(false, refreshMissing);
  }, [revealAutomation?.token, host.loaded, automations, lock, recents]);

  const beginNew = async () => {
    if (savingRef.current || (draft && !(await confirmDiscard()))) return;
    beginBlank();
  };
  const showListControls = hasAutomations || loading;
  const showFilter = automations.length >= FILTER_MIN_AUTOMATIONS || filtered;
  const showAssistant = Boolean(onLaunchAssistant);
  // A new draft is already the editor; with no automations the empty page offers the start.
  const showCreate = hasAutomations && !(draft && !draft.id);
  const showHeader = showListControls || showAssistant || showCreate;

  return (
    <Text
      as="div"
      size="inherit"
      tone="neutral"
      className="automation-layout flex min-h-0 min-w-0 flex-1 flex-col"
      data-list-open={compactListOpen || undefined}
    >
      {confirmDialog}
      {revealStatus && revealAutomation && (
        <Text
          as="div"
          size="secondary"
          tone="inherit"
          role="status"
          className="flex flex-wrap items-center gap-2 px-4 py-2"
        >
          <span>
            {t(
              revealStatus === "draft"
                ? "Keep or close your current automation draft before opening the requested automation."
                : revealStatus === "filter"
                  ? "The requested automation is hidden by your filters."
                  : "The linked automation is unavailable on its original computer.",
            )}
          </span>
          <Button
            disabled={saving || !!draft}
            onClick={() => applyReveal(revealStatus === "filter")}
          >
            {t(revealStatus === "filter" ? "Reset filters" : "Retry")}
          </Button>
          <Button
            onClick={() => {
              revealDone.current = revealAutomation.token;
              setRevealStatus("");
            }}
          >
            {t("Dismiss")}
          </Button>
        </Text>
      )}
      {host.migrationBlocked.length ? (
        <Alert tone="warning">
          {host.migrationBlocked.join("\n")}
          <Button variant="ghost" loading={host.fetching} onClick={() => void refreshHost(true)}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : host.fetching ? (
        <LoadingText>{t("Loading…")}</LoadingText>
      ) : null}
      {assistantOpen && onLaunchAssistant ? (
        <AutomationAssistant
          cwd={cwd}
          recents={recents}
          stateKey={`${viewStateKey}:assistant`}
          onClose={() => setAssistantOpen(false)}
          onLaunch={onLaunchAssistant}
        />
      ) : null}
      {showHeader ? (
        <div className="automation-page-header flex shrink-0 items-center gap-2 px-3 py-2">
          {showListControls ? (
            <div className="automation-compact-navigation">
              <Button
                variant="ghost"
                aria-pressed={compactListOpen}
                onClick={() => setCompactListOpen((open) => !open)}
              >
                {t(compactListOpen ? "Back" : "Show automation list")}
                {!compactListOpen ? ` · ${automations.length}` : null}
              </Button>
            </div>
          ) : null}
          {showFilter ? (
            <AutomationFilter
              query={query}
              status={statusFilter}
              onQueryChange={setQuery}
              onStatusChange={setStatusFilter}
              onReset={resetFilters}
            />
          ) : null}
          <span className="flex-1" />
          {showAssistant ? (
            <Button
              variant="ghost"
              aria-label={t("AI assistant")}
              aria-haspopup="dialog"
              startIcon={<Sparkles className="icon-sm" strokeWidth={1.75} />}
              onClick={() => setAssistantOpen(true)}
            >
              <span className="automation-wide-only">{t("AI assistant")}</span>
            </Button>
          ) : null}
          {showCreate ? (
            <Button
              variant="primary"
              aria-label={t("New automation")}
              startIcon={<Plus className="icon-sm" strokeWidth={1.75} />}
              onClick={() => void beginNew()}
            >
              <span className="automation-wide-only">{t("New automation")}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {unreachableNames.length && !unreachableShownCentrally ? (
        <UnreachableMachinesNotice
          className="shrink-0 px-2 py-1"
          message={unreachableNotice(unreachableNames)}
          detail={host.unreachableDetail}
          disabled={!queryVisible}
          retrying={host.fetching}
          onRetry={() => void refreshHost(true)}
        />
      ) : null}
      <div className="automation-body flex min-h-0 min-w-0 flex-1">
        {showList ? (
          <AutomationList
            automations={visible}
            loading={loading}
            filtered={filtered}
            selectedId={draft && !draft.id ? null : selectedId}
            groupLabels={groupLabels}
            isPending={(automation) =>
              toggling.has(automationKey(automation)) || deleting === automationKey(automation)
            }
            isDisabled={(automation) => saving || running === automationKey(automation)}
            onSelect={async (automation) => {
              if (savingRef.current || (draft && !(await confirmDiscard()))) return;
              setDraft(null);
              setSelectedId(automationKey(automation));
              setCompactListOpen(false);
            }}
            onToggle={(automation, enabled) => void onToggle(automation, enabled)}
          />
        ) : null}

        <main className="automation-workspace flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <Alert
              tone="danger"
              className="mx-3 mt-1 mb-2 shrink-0"
              extra={<ErrorDetails detail={error} title={t("Automation action failed.")} />}
            >
              {t("Automation action failed.")}
            </Alert>
          ) : null}
          {paused && !editorDraft ? (
            <EmptyState
              title={t("Automations")}
              description={t("Focus this window to load automations.")}
              showDescription
            />
          ) : loading && !editorDraft ? (
            <div className="min-h-0 flex-1">
              <SurfaceLoading />
            </div>
          ) : editorDraft ? (
            <HostModelSource
              local={!editorDraft.runInBackground}
              machine={machine}
              cwd={editorDraft.cwd}
              model={editorDraft.model}
              values={editorDraft.modelSettings}
            >
              <AutomationEditor
                key={editorDraft.id ? selectedId : "new"}
                machines={machines}
                machine={machine}
                draft={editorDraft}
                recents={recents}
                runs={editorDraft.id ? history.runs : []}
                historyLoading={!!editorDraft.id && history.loading}
                historyError={history.error}
                onRefreshHistory={history.refresh}
                saving={saving}
                running={!!editorDraft.id && selectedId === running}
                deleteDisabled={
                  saving ||
                  !!deleting ||
                  (!!editorDraft.id && selectedId === running) ||
                  selected?.lastRunStatus === "running" ||
                  history.runs.some((run) => run.status === "running")
                }
                dirty={draft != null}
                onChange={(nextDraft) => void (!savingRef.current && setDraft(nextDraft))}
                onClose={() => {
                  if (savingRef.current) return;
                  setDraft(null);
                }}
                onSubmit={(event) =>
                  onSave(event, { ...editorDraft, name: automationName(editorDraft) })
                }
                onRun={selected && editorDraft.id ? () => void onRun(selected) : undefined}
                onDelete={selected && editorDraft.id ? () => void onDelete(selected) : undefined}
                onOpenTask={
                  selected?.host && onOpenTask
                    ? async (taskId) => {
                        try {
                          await onOpenTask({
                            machineId: selected.host!.machineId,
                            environmentId: selected.host!.environmentId,
                            projectId: selected.host!.projectId,
                            cwd: selected.cwd,
                            taskId,
                          });
                        } catch (reason) {
                          setActionError(presentRemoteError(reason, { explicit: true }));
                        }
                      }
                    : undefined
                }
                onOpenSession={async (sessionId) => {
                  try {
                    if (selected?.host && editorDraft.id)
                      await onOpenBackgroundSession({
                        machineId: selected.host.machineId,
                        cwd: selected.cwd,
                        projectId: selected.host.projectId,
                        sessionId,
                      });
                    else await onOpenSession(sessionId);
                  } catch (reason: unknown) {
                    setActionError(presentRemoteError(reason, { explicit: true }));
                  }
                }}
              />
            </HostModelSource>
          ) : readFailed && !hasAutomations ? (
            <FailureState
              title={t("Automations unavailable")}
              description={
                host.error?.message ??
                localQuery.error?.message ??
                t("Automations could not be read.")
              }
              onRetry={
                queryVisible
                  ? () => {
                      void localQuery.refetch();
                      void refreshHost(true);
                    }
                  : undefined
              }
              retrying={localQuery.isFetching || host.fetching}
            />
          ) : (
            <EmptyState
              kind="empty"
              description={t("No automations yet")}
              showDescription
              action={{ label: t("New automation"), onClick: () => void beginNew() }}
            />
          )}
        </main>
      </div>
    </Text>
  );
}

/** The machine whose Host stores and runs the draft: the saved one, else the project's. */
function editorMachine(
  machines: readonly RemoteMachine[],
  selected: Automation | null,
  draft: AutomationDraft,
): RemoteMachine | undefined {
  return selected?.host && draft.id
    ? machines.find((entry) => entry.id === selected.host!.machineId)
    : (machines.find((entry) => entry.id === draft.hostMachineId) ??
        backgroundMachineFor(machines, draft.cwd));
}

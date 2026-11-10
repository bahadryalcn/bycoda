import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostAutomations } from "../hooks/useHostAutomations";
import { useAutomationHistory } from "../hooks/useAutomationHistory";
import { unreachableNotice, useAutomationActions } from "../hooks/useAutomationActions";
import { useAutomationDraftStart } from "../hooks/useAutomationDraftStart";
import { useAutomationFolderOptions } from "../hooks/useAutomationFolderOptions";
import { automationKey } from "../model/automationKey";
import {
  TRIGGER_CATEGORIES,
  TRIGGER_EVENTS,
  findTriggerEvent,
  triggerName,
} from "../model/automationTriggerCatalog";
import { TriggerMark, TriggerRow } from "./TriggerEditor";
import { useProviderConnections } from "../../inbox/hooks/useProviderConnections";
import "./automations.css";
import { AutomationAssistant } from "./AutomationAssistant";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { TextField } from "../../../shared/ui/TextField";
import { Switch } from "../../../shared/ui/Switch";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Alert } from "../../../shared/ui/Alert";
import { Divider } from "../../../shared/ui/Divider";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Spinner } from "../../../shared/ui/Spinner";
import { Surface } from "../../../shared/ui/Surface";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { Tooltip, OverflowTooltip } from "../../../shared/ui/Tooltip";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { t, useLocale } from "../../../shared/i18n";
import {
  GRACE_OPTIONS,
  RUN_TIME_LIMIT_OPTIONS,
  RUNS_PER_DAY_OPTIONS,
  optionLabel,
} from "../model/automationLimitOptions";
import {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementType,
  type FormEvent,
  type ReactNode,
} from "react";
import { loadModelControls, subscribeModelControls } from "../../settings/model/settings";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { Row } from "../../settings/ui/settingsControls";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  File,
  Gauge,
  GitPullRequest,
  Inbox,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Terminal,
  Trash2,
  Zap,
} from "../../../shared/ui/icons";
import { ModelControlPills, ModelPicker } from "../../sessions/ui/ModelPicker";
import { Popover } from "../../../shared/ui/Popover";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { HostModelSource } from "../../connections/ui/HostModelSource";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  applyTriggers,
  applyAutomationChange,
  automationScheduleLabel,
  automationTriggers,
  createAutomationTrigger,
  draftFromAutomation,
  formatAutomationRunAt,
  formatAutomationRunDuration,
  listAutomations,
  peekAutomations,
  subscribeAutomations,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "../model/automations";
import {
  AUTOMATION_TEMPLATE_CATEGORIES,
  templatesForCategory,
  type AutomationTemplate,
  type AutomationTemplateCategoryId,
  type AutomationTemplateIcon,
} from "../model/automationTemplates";
import { backgroundMachineFor } from "../model/hostAutomationClient";
import type { RemoteMachine } from "../../connections/model/protocol";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { resolveModel } from "../../sessions/model/models";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

import { assistantAutomationSelection } from "../model/assistantAutomationSelection";
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
}: Props) {
  useLocale();
  // Inside the workspace the tool switcher takes the title's place.
  const toolNavigation = useContext(ToolNavigationContext)?.active != null;
  return (
    <div
      role="region"
      aria-label={t("Automations")}
      data-app-automations
      style={{ containerType: "inline-size", containerName: "automations" }}
      className="flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
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
        onLaunchAssistant={onLaunchAssistant}
      />
    </div>
  );
}

function AutomationsContent({
  revealAutomation,
  cwd,
  recents,
  onLaunch,
  onOpenSession,
  onOpenBackgroundSession,
  onLaunchAssistant,
}: Pick<
  Props,
  | "revealAutomation"
  | "cwd"
  | "recents"
  | "onLaunch"
  | "onOpenSession"
  | "onOpenBackgroundSession"
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [compactListOpen, setCompactListOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const deferredQuery = useDeferredValue(query);
  const [draft, setDraft] = useRetainedState<AutomationDraft | null>(`${viewStateKey}:draft`, null);
  const [pickerOpen, setPickerOpen] = useState(() => draft == null);
  const logos = useTabGroupLogos();
  const [groupLabels] = useState(loadTabGroupLabels);
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

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
    setPickerOpen,
    setDraft,
    setSelectedId,
    onLaunch,
  });
  const { beginCreate, beginBlank, beginFromTemplate } = useAutomationDraftStart({
    cwd,
    recents,
    selected,
    savingRef,
    setPickerOpen,
    setCompactListOpen,
    setDraft,
  });
  // Collection failures block first use; one offline machine only makes its own data unknown.
  const readFailed = (localQuery.isError && storedAutomations.length === 0) || !!host.error;
  const error = actionError ?? (readFailed ? null : (localQuery.error?.message ?? null));

  const editorDraft = pickerOpen
    ? null
    : (draft ?? (selected ? draftFromAutomation(selected) : null));
  const listLock = useLockOverscroll<HTMLDivElement>();

  const hasAutomations = automations.length > 0;
  const showList = !focusMode && ((!paused && loading) || hasAutomations);
  const filtered = !!query.trim() || statusFilter !== "all";
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
    setPickerOpen(false);
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
  const showFilter = hasAutomations || loading;
  const showAssistant = Boolean(onLaunchAssistant) && !pickerOpen;
  const showCreate = !pickerOpen;
  const showHeader = showFilter || showAssistant || showCreate;
  const firstUse =
    !revealAutomation &&
    !collectionPending &&
    !readFailed &&
    !unreachableNames.length &&
    !hasAutomations;

  return (
    <div
      className="automation-layout flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
      data-list-open={compactListOpen || undefined}
    >
      {confirmDialog}
      {revealStatus && revealAutomation && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 px-4 py-2 text-ui-secondary"
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
        </div>
      )}
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
          {showFilter ? (
            <>
              <div className="automation-compact-navigation">
                <Button
                  variant="ghost"
                  aria-pressed={compactListOpen}
                  onClick={() => {
                    setFocusMode(false);
                    setCompactListOpen((open) => !open);
                  }}
                >
                  {t(compactListOpen ? "Back" : "Show automation list")}
                  {!compactListOpen ? ` · ${automations.length}` : null}
                </Button>
              </div>
              <span className="automation-count px-1 text-ui-caption text-(--ui-text-muted)">
                {t("Automations")} · {automations.length}
              </span>
              <Button
                ref={filterButton}
                type="button"
                size="sm"
                variant="ghost"
                iconOnly
                label={t("Filter automations")}
                selected={filtered}
                aria-haspopup="dialog"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((open) => !open)}
              >
                <Search className="icon-sm" strokeWidth={1.75} />
              </Button>
              {filterOpen ? (
                <Popover
                  anchor={filterButton}
                  role="dialog"
                  aria-label={t("Filter automations")}
                  onDismiss={() => setFilterOpen(false)}
                  width={280}
                  className="space-y-2 p-3"
                >
                  <TextField
                    label={t("Filter automations")}
                    type="search"
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <SearchableSelect
                    hideLabel
                    label={t("Status")}
                    value={statusFilter}
                    searchable={false}
                    options={[
                      { value: "all", label: t("All") },
                      { value: "active", label: t("Active") },
                      { value: "paused", label: t("Paused") },
                      { value: "attention", label: t("Needs attention") },
                    ]}
                    onChange={setStatusFilter}
                  />
                  <Button
                    onClick={() => {
                      setQuery("");
                      setStatusFilter("all");
                    }}
                    disabled={!query && statusFilter === "all"}
                  >
                    {t("Reset")}
                  </Button>
                </Popover>
              ) : null}
            </>
          ) : null}
          <span className="flex-1" />
          {hasAutomations ? (
            <Button
              className="automation-focus-action"
              type="button"
              variant="ghost"
              iconOnly
              label={t(focusMode ? "Show automation list" : "Focus mode")}
              aria-pressed={focusMode}
              onClick={() => setFocusMode(!focusMode)}
            >
              {focusMode ? (
                <Minimize2 className="icon-sm" strokeWidth={1.75} />
              ) : (
                <Maximize2 className="icon-sm" strokeWidth={1.75} />
              )}
            </Button>
          ) : null}
          {showAssistant ? (
            <Button
              variant="secondary"
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
              onClick={beginCreate}
            >
              <span className="automation-wide-only">{t("New automation")}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {unreachableNames.length ? (
        <Alert
          tone="warning"
          className="mx-3 mb-2 shrink-0"
          action={
            <Button
              variant="secondary"
              disabled={!queryVisible}
              loading={host.fetching}
              onClick={() => void refreshHost(true)}
            >
              {t("Retry")}
            </Button>
          }
        >
          {unreachableNotice(unreachableNames)}
        </Alert>
      ) : null}
      <div className="automation-body flex min-h-0 min-w-0 flex-1">
        {showList ? (
          <aside className="automation-list flex shrink-0 flex-col">
            <div ref={listLock} className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5">
              {loading ? (
                <SurfaceLoading />
              ) : visible.length > 0 ? (
                <ul className="space-y-0.5">
                  {visible.map((automation) => (
                    <li key={automationKey(automation)}>
                      <AutomationCard
                        automation={automation}
                        pending={
                          toggling.has(automationKey(automation)) ||
                          deleting === automationKey(automation)
                        }
                        disabled={saving || running === automationKey(automation)}
                        active={
                          !pickerOpen &&
                          automationKey(automation) === selectedId &&
                          (!draft || draft.id === automation.id)
                        }
                        logos={logos}
                        labels={groupLabels}
                        mascots={groupMascots}
                        colors={groupColors}
                        customColors={groupCustomColors}
                        onSelect={async () => {
                          if (savingRef.current || (draft && !(await confirmDiscard()))) return;
                          setPickerOpen(false);
                          setDraft(null);
                          setSelectedId(automationKey(automation));
                          setCompactListOpen(false);
                        }}
                        onToggle={(enabled) => void onToggle(automation, enabled)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  context="list"
                  kind={filtered ? "filtered" : "empty"}
                  description={filtered ? t("No matching automations") : t("No automations yet")}
                  onReset={
                    filtered
                      ? () => {
                          setQuery("");
                          setStatusFilter("all");
                        }
                      : undefined
                  }
                />
              )}
            </div>
          </aside>
        ) : null}

        <main className="automation-workspace flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <Alert tone="danger" className="mx-3 mt-1 mb-2 shrink-0">
              {error}
            </Alert>
          ) : null}
          {paused && !editorDraft ? (
            <EmptyState
              title={t("Automations")}
              description={t("Focus this window to load automations.")}
            />
          ) : loading && !editorDraft ? (
            <div className="min-h-0 flex-1">
              <SurfaceLoading />
            </div>
          ) : editorDraft ? (
            <HostModelSource
              local={!editorDraft.runInBackground}
              machine={
                selected?.host && editorDraft.id
                  ? machines.find((entry) => entry.id === selected.host!.machineId)
                  : backgroundMachineFor(machines, editorDraft.cwd)
              }
              cwd={editorDraft.cwd}
              model={editorDraft.model}
              values={editorDraft.modelSettings}
            >
              <AutomationEditor
                key={editorDraft.id ? selectedId : "new"}
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
                backgroundMachine={
                  selected?.host && editorDraft.id
                    ? selected.host.machineName
                    : backgroundMachineName(machines, editorDraft.cwd)
                }
                backgroundMachineId={
                  selected?.host && editorDraft.id
                    ? selected.host.machineId
                    : backgroundMachineFor(machines, editorDraft.cwd)?.id
                }
                onChange={(nextDraft) => void (!savingRef.current && setDraft(nextDraft))}
                onClose={() => {
                  if (savingRef.current) return;
                  setDraft(null);
                  if (!editorDraft.id) setPickerOpen(true);
                }}
                onSubmit={(event) => onSave(event, editorDraft)}
                onRun={selected && editorDraft.id ? () => void onRun(selected) : undefined}
                onDelete={selected && editorDraft.id ? () => void onDelete(selected) : undefined}
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
                    setActionError(reason instanceof Error ? reason.message : String(reason));
                  }
                }}
              />
            </HostModelSource>
          ) : readFailed && !hasAutomations ? (
            <EmptyState
              kind="unavailable"
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
            <AutomationPicker
              firstUse={firstUse}
              onBlank={beginBlank}
              onPick={beginFromTemplate}
              onAssistant={onLaunchAssistant ? () => setAssistantOpen(true) : undefined}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function backgroundMachineName(
  machines: readonly RemoteMachine[],
  cwd: string,
): string | undefined {
  const machine = backgroundMachineFor(machines, cwd);
  if (!machine) return undefined;
  return parseRemotePath(cwd) ? machine.name : "this computer";
}

function AutomationCard({
  automation,
  active,
  logos,
  labels,
  mascots,
  colors,
  customColors,
  onSelect,
  onToggle,
  pending,
  disabled,
}: {
  automation: Automation;
  active: boolean;
  logos: Record<string, string>;
  labels: Record<string, string>;
  mascots: Record<string, string>;
  colors: Record<string, number>;
  customColors: Record<string, string>;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  pending: boolean;
  disabled: boolean;
}) {
  useLocale();
  const seed = projectName(automation.cwd);
  const key = projectKey(automation.cwd);
  const project = resolveTabGroupLabel(key, labels, seed);
  const logoPath = resolveTabGroupLogo(key, logos);
  const mascotName = resolveTabGroupMascot(key, mascots);
  const mascotColor = resolveTabGroupColor(key, colors, customColors, seed);
  const lastRun = automation.lastRunAt
    ? formatRelativeTime(new Date(automation.lastRunAt).toISOString())
    : null;
  const model = resolveModel(automation.harness, automation.model);
  // The first trigger names the card; the others open from a "+N" beside the switch, which cannot
  // sit inside the card button.
  const otherTriggers = automationTriggers(automation).slice(1);
  return (
    <div className="group relative" data-paused={automation.enabled ? undefined : ""}>
      <Button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={t("Open {p0}", { p0: automation.name })}
        onClick={onSelect}
        variant="item"
        selected={active}
        layout="stacked"
      >
        <span
          className={`flex min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-muted) ${otherTriggers.length > 0 ? "pr-24" : "pr-14"}`}
        >
          <TriggerMark
            kind={automationTriggers(automation)[0]?.kind ?? automation.triggerKind}
            className="icon-xs"
          />
          <span className="min-w-0 truncate">
            {triggerLabel(automation)}
            {automation.host ? t(" · on {p0}", { p0: automation.host.machineName }) : ""}
            {automation.host?.stale ? t(" (offline, last known)") : ""}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
            {automation.name}
          </span>
          {automation.host?.needsInput ? (
            <Badge tone="warning" className="shrink-0 whitespace-nowrap">
              {t("Needs input")}
            </Badge>
          ) : automation.lastRunStatus === "failed" || automation.lastRunStatus === "running" ? (
            <RunStatusPill status={automation.lastRunStatus} />
          ) : !automation.enabled ? (
            <Badge tone="neutral" className="shrink-0 whitespace-nowrap">
              {t("Paused")}
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-micro text-(--ui-text-muted)">
          {logoPath ? (
            <ProjectLogoIcon
              path={logoPath}
              className="icon-sm shrink-0 rounded-sm"
              imageClassName="icon-sm"
            />
          ) : (
            <ProjectMascot
              project={seed}
              color={mascotColor}
              name={mascotName}
              className="icon-xs shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{project}</span>
          {lastRun ? (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{lastRun}</span>
            </>
          ) : null}
          <OverflowTooltip label={model.name}>
            <span className="ml-auto flex min-w-0 max-w-28 items-center gap-1 text-(--ui-text-muted)">
              <HarnessIcon harness={automation.harness} className="icon-sm shrink-0" />
              <span className="min-w-0 truncate">{model.name}</span>
            </span>
          </OverflowTooltip>
        </span>
      </Button>
      <span className="absolute right-2.5 top-2 flex items-center gap-1">
        <BadgeList
          label={t("Triggers")}
          size="xs"
          max={0}
          items={otherTriggers.map((trigger) => ({
            id: trigger.id,
            label: triggerText(trigger),
            icon: <TriggerMark kind={trigger.kind} className="icon-xs" />,
          }))}
        />
        {pending ? <Spinner size="xs" /> : null}
        <ToggleSwitch
          label={`${automation.enabled ? "Pause" : "Enable"} ${automation.name}`}
          on={automation.enabled}
          onChange={onToggle}
          busy={pending}
          disabled={disabled}
          compact
        />
      </span>
    </div>
  );
}

const FIRST_TEMPLATES = 6;

/**
 * Three separate ways to begin: write it yourself, ask the assistant, or adapt an
 * example. Each ends in an editable draft; nothing is saved or run from here.
 */
function AutomationPicker({
  firstUse,
  onBlank,
  onPick,
  onAssistant,
}: {
  firstUse: boolean;
  onBlank: () => void;
  onPick: (template: AutomationTemplate) => void;
  onAssistant?: () => void;
}) {
  useLocale();
  const [category, setCategory] = useState<AutomationTemplateCategoryId>("all");
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [templateQuery, setTemplateQuery] = useState("");
  const [allTemplates, setAllTemplates] = useState(false);
  const templates = templatesForCategory(category).filter((template) =>
    `${t(template.name)} ${t(template.description)}`
      .toLocaleLowerCase()
      .includes(templateQuery.trim().toLocaleLowerCase()),
  );
  const collapsible = !templateQuery.trim() && category === "all";
  const shown = collapsible && !allTemplates ? templates.slice(0, FIRST_TEMPLATES) : templates;

  return (
    <div ref={lockOverscroll} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none">
      <div className="automation-content automation-picker">
        <header>
          <h1 className="text-ui-heading font-medium leading-tight text-(--ui-tone-neutral-fg)">
            {firstUse ? t("Create your first automation") : t("New automation")}
          </h1>
          <p className="mt-1.5 text-ui-secondary text-(--ui-text-muted)">
            {t("Choose how to start. You can edit everything before saving.")}
          </p>
        </header>
        <div className="automation-start mt-5" role="group" aria-label={t("Start")}>
          <Button
            type="button"
            onClick={onBlank}
            variant="item"
            layout="stacked"
            className="automation-start-option"
          >
            <span className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center text-(--ui-text-muted)">
                <Plus className="icon-md" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                  {t("Start from scratch")}
                </span>
                <span className="mt-1 block text-ui-caption leading-snug text-(--ui-text-muted)">
                  {t("Write your own instructions and choose a trigger.")}
                </span>
              </span>
            </span>
          </Button>
          {onAssistant ? (
            <Button
              type="button"
              onClick={onAssistant}
              variant="item"
              layout="stacked"
              aria-haspopup="dialog"
              className="automation-start-option"
            >
              <span className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center text-(--ui-text-muted)">
                  <Sparkles className="icon-md" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                    {t("AI assistant")}
                  </span>
                  <span className="mt-1 block text-ui-caption leading-snug text-(--ui-text-muted)">
                    {t(
                      "Continue in a full AI session with automation tools and approval controls.",
                    )}
                  </span>
                </span>
              </span>
            </Button>
          ) : null}
        </div>
        <section className="mt-7" aria-labelledby="automation-templates-title">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2
              id="automation-templates-title"
              className="me-auto text-ui-secondary font-medium text-(--ui-tone-neutral-fg)"
            >
              {t("Start from a template")}
            </h2>
            <TextField
              label={t("Search templates")}
              hideLabel
              placeholder={t("Search templates")}
              value={templateQuery}
              onChange={(event) => setTemplateQuery(event.target.value)}
              fieldClassName="automation-template-search"
            />
            <SearchableSelect
              hideLabel
              label={t("Template category")}
              value={category}
              options={AUTOMATION_TEMPLATE_CATEGORIES.map((option) => ({
                value: option.id,
                label: t(option.label),
              }))}
              onChange={(value) => setCategory(value as AutomationTemplateCategoryId)}
            />
          </div>
          {templates.length === 0 ? (
            <EmptyState
              size="inline"
              kind="filtered"
              className="mt-4"
              description={t("No matching options")}
            />
          ) : null}
          <div className="automation-gallery mt-3">
            {shown.map((template) => {
              const Icon = TEMPLATE_ICONS[template.icon];
              return (
                <Button
                  key={template.id}
                  type="button"
                  onClick={() => onPick(template)}
                  variant="item"
                  layout="stacked"
                  className="automation-template"
                  tooltip={t(template.description)}
                >
                  <span className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center text-(--ui-text-muted)">
                      <Icon className="icon-md" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                        {t(template.name)}
                      </span>
                      <span className="mt-1 line-clamp-2 text-ui-caption leading-snug text-(--ui-text-muted)">
                        {t(template.description)}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="icon-sm mt-1 shrink-0 text-(--ui-text-muted)"
                      strokeWidth={1.75}
                    />
                  </span>
                  <span className="mt-auto flex min-w-0 items-center gap-1.5 ps-10 pt-2 text-ui-micro text-(--ui-text-muted)">
                    <TriggerMark kind={template.trigger.kind} className="icon-xs shrink-0" />
                    <span className="min-w-0 truncate">{t(template.triggerLabel)}</span>
                  </span>
                </Button>
              );
            })}
          </div>
          {collapsible && templates.length > FIRST_TEMPLATES ? (
            <Button
              className="mt-3"
              variant="ghost"
              aria-expanded={allTemplates}
              onClick={() => setAllTemplates((value) => !value)}
            >
              {t(allTemplates ? "Show less" : "Show all")} · {templates.length}
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const RUN_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_9.5rem_6.75rem_3.5rem] items-center gap-x-4 gap-y-1 px-4";

function RunRow({
  run,
  draft,
  onOpenSession,
}: {
  run: AutomationRun;
  draft: AutomationDraft;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  useLocale();
  const trigger = runTriggerMeta(run, draft);
  const sessionId = run.sessionId;
  return (
    <li>
      <Button
        type="button"
        disabled={!sessionId}
        tooltip={sessionId ? t("Open session") : undefined}
        disabledReason={sessionId ? undefined : (run.error ?? t("This run has no session yet"))}
        onClick={() => {
          if (!sessionId) return;
          void onOpenSession(sessionId);
        }}
        variant="item"
        className={`${RUN_GRID} min-w-[480px] w-full`}
        style={{ display: "grid" }}
      >
        <span className="flex min-w-0 items-center gap-2 text-(--ui-tone-neutral-fg)">
          <TriggerMark kind={trigger.kind} className="icon-sm shrink-0 text-(--ui-text-muted)" />
          <span className="min-w-0 truncate">{trigger.label}</span>
        </span>
        <span className="truncate text-(--ui-tone-neutral-fg)">
          {formatAutomationRunAt(run.scheduledFor || run.createdAt)}
        </span>
        <span>
          {/* Still running, but stuck until the owner answers. */}
          {run.status === "running" && run.needsInput ? (
            <Badge tone="warning" title={t("The session is waiting on an approval or a question")}>
              {t("Needs input")}
            </Badge>
          ) : (
            <RunStatusPill status={run.status} />
          )}
        </span>
        <span className="text-right tabular-nums text-(--ui-text-muted)">
          {formatAutomationRunDuration(run)}
        </span>
        {run.error && (run.status === "failed" || run.status === "skipped") ? (
          <span
            title={run.error}
            className="col-span-full line-clamp-2 break-words text-start text-ui-micro text-(--ui-tone-danger-fg)"
          >
            {run.error}
          </span>
        ) : null}
      </Button>
    </li>
  );
}

function RunStatusPill({ status }: { status: AutomationRun["status"] }) {
  return (
    <Badge
      tone={runStatusTone(status)}
      className="shrink-0 whitespace-nowrap"
      icon={status === "running" ? <Spinner size="xs" /> : undefined}
    >
      {runStatusLabel(status)}
    </Badge>
  );
}

function runStatusLabel(status: AutomationRun["status"]): string {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  return "Pending";
}

function runStatusTone(status: AutomationRun["status"]): BadgeTone {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "warning";
  if (status === "cancelled") return "neutral";
  return "info";
}

function runTriggerMeta(
  run: AutomationRun,
  draft: AutomationDraft,
): { kind: AutomationTriggerKind; label: string } {
  if (run.trigger === "manual")
    return {
      kind: "time",
      get label() {
        return t("Test run");
      },
    };
  if (run.trigger === "event") {
    const kind = run.eventKind ?? draft.triggerKind;
    const event = run.event ?? draft.triggerEvent;
    return {
      kind,
      label: findTriggerEvent(kind, event)?.label ?? triggerName(kind),
    };
  }
  const times = draft.triggers.filter((trigger) => trigger.kind === "time");
  if (times[0]) {
    return {
      kind: "time",
      get label() {
        return t("Scheduled · {p0}", { p0: automationScheduleLabel(times[0]) });
      },
    };
  }
  const first = draft.triggers[0];
  if (!first)
    return {
      kind: "time",
      get label() {
        return t("Scheduled");
      },
    };
  const event = findTriggerEvent(first.kind, first.event)?.label ?? triggerName(first.kind);
  return { kind: first.kind, label: event };
}

function AutomationEditor({
  draft,
  recents,
  runs,
  historyLoading,
  historyError,
  onRefreshHistory,
  saving,
  running,
  deleteDisabled,
  dirty,
  backgroundMachine,
  backgroundMachineId,
  onChange,
  onClose,
  onSubmit,
  onRun,
  onDelete,
  onOpenSession,
}: {
  draft: AutomationDraft;
  recents: RecentProject[];
  runs: AutomationRun[];
  historyLoading: boolean;
  historyError: string | null;
  onRefreshHistory: () => void;
  saving: boolean;
  running: boolean;
  deleteDisabled: boolean;
  dirty: boolean;
  /** The machine whose host can run this draft's project in the background. */
  backgroundMachine?: string;
  backgroundMachineId?: string;
  onChange: (draft: AutomationDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onRun?: () => void;
  onDelete?: () => void;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  useLocale();
  const extrasBeside = useSyncExternalStore(subscribeModelControls, loadModelControls) === "beside";
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { connections: providerConnected } = useProviderConnections();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const triggerReady = (kind: AutomationTriggerKind) => {
    if (kind === "time" || kind === "tasks" || kind === "social") return true;
    // Never-read status stays disabled; a rejected read keeps the last-known value
    // instead of inferring revocation. Host validation still gates the trigger.
    return providerConnected[kind] === true;
  };
  const valid =
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    looksLikeProject(draft.cwd) &&
    draft.model.length > 0;
  const folderChoices = useAutomationFolderOptions(draft.cwd, draft.sessionFolderId);
  const update = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const setTriggers = (triggers: AutomationTrigger[]) => onChange(applyTriggers(draft, triggers));
  const triggerOptions = TRIGGER_CATEGORIES.flatMap((category) =>
    TRIGGER_EVENTS[category.value].map((event) => ({
      value: category.value + ":" + event.value,
      label: event.label,
      keywords: category.label,
      description: triggerReady(category.value)
        ? category.label
        : t("Connect {p0} in Settings", { p0: category.label }),
      disabled: !triggerReady(category.value),
    })),
  );
  const selectTrigger = (value: string) => {
    const option = triggerOptions.find((entry) => entry.value === value);
    if (!option || option.disabled || draft.triggers.length >= 20) return;
    const [kind, event] = value.split(":") as [AutomationTriggerKind, string];
    setTriggers([...draft.triggers, createAutomationTrigger(kind, event)]);
  };
  const updateTrigger = (next: AutomationTrigger) =>
    setTriggers(draft.triggers.map((trigger) => (trigger.id === next.id ? next : trigger)));

  const historyAvailable = Boolean(draft.id);
  const showingHistory = historyAvailable && tab === "history";

  const limitsSummary = [
    `${t("Run time limit")}: ${optionLabel(RUN_TIME_LIMIT_OPTIONS, draft.maxRunMinutes)}`,
    `${t("Runs per day")}: ${optionLabel(RUNS_PER_DAY_OPTIONS, draft.maxRunsPerDay)}`,
  ].join(" · ");

  // With a run history the scroll region is the one panel both tabs show.
  const Scroll: ElementType = historyAvailable ? TabPanel : "div";

  return (
    <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={onSubmit} aria-busy={saving}>
      <Tabs value={tab} onValueChange={setTab} panels="shared">
        <div className="automation-editor-header shrink-0 px-3 pt-2 sm:px-6">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <TextField
                label={t("Automation name")}
                hideLabel
                autoFocus
                aria-label={t("Automation name")}
                value={draft.name}
                disabled={saving}
                onChange={(event) => update("name", event.target.value)}
                placeholder={t("Untitled")}
                fieldClassName="min-w-0 flex-[1_1_16rem]"
              />
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {!draft.id || dirty ? (
                  <Button type="button" onClick={onClose} disabled={saving} variant="secondary">
                    {draft.id ? t("Reset") : t("Cancel")}
                  </Button>
                ) : null}
                {onRun ? (
                  <Button
                    type="button"
                    onClick={onRun}
                    loading={running}
                    disabled={saving || dirty}
                    startIcon={<Play className="icon-sm" />}
                    variant="secondary"
                  >
                    {t("Run now")}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={!valid || saving || (!!draft.id && !dirty)}
                  variant="primary"
                  loading={saving}
                >
                  {draft.id ? t("Save") : t("Create")}
                </Button>
                {onDelete ? (
                  <>
                    <Button
                      ref={menuButton}
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      disabled={saving}
                      onClick={() => setMenuOpen((open) => !open)}
                      variant="ghost"
                      iconOnly
                      label={t("Automation actions")}
                    >
                      <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
                    </Button>
                    {menuOpen ? (
                      <DropdownMenu
                        anchor={menuButton}
                        label={t("Automation actions")}
                        onClose={() => setMenuOpen(false)}
                        returnFocusRef={menuButton}
                        items={[
                          {
                            kind: "item",
                            id: "delete",
                            label: t("Delete automation"),
                            icon: <Trash2 />,
                            danger: true,
                            disabled: deleteDisabled,
                            title: deleteDisabled
                              ? t(
                                  "Wait for the current operation to finish before deleting this automation.",
                                )
                              : undefined,
                          },
                        ]}
                        onPick={() => onDelete()}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            <div
              inert={saving}
              className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-ui-caption text-(--ui-text-muted)"
            >
              <span className="flex shrink-0 items-center gap-2">
                <ToggleSwitch
                  label={draft.enabled ? t("Pause automation") : t("Enable automation")}
                  on={draft.enabled}
                  onChange={(enabled) => update("enabled", enabled)}
                  compact
                />
                <span>{draft.enabled ? t("Active") : t("Inactive")}</span>
              </span>
              <SearchableProjectPicker
                cwd={draft.cwd}
                recents={recents}
                disabled={!!draft.id && draft.runInBackground}
                onSelectProject={(cwd) => {
                  if (!draft.id || !draft.runInBackground)
                    onChange({ ...draft, cwd, sessionFolderId: "" });
                }}
              />
            </div>
          </header>
          {historyAvailable ? (
            <TabList label={t("Automation view")} className="mt-1">
              <Tab value="settings">{t("Settings")}</Tab>
              <Tab value="history">{t("Run history")}</Tab>
            </TabList>
          ) : (
            <div className="pb-2" />
          )}
        </div>

        <Scroll
          ref={lockOverscroll}
          inert={saving}
          className="automation-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
        >
          {!showingHistory ? (
            <div className="automation-content automation-editor-grid">
              <section>
                <SectionLabel
                  as="h2"
                  className="px-1"
                  actions={
                    <InfoPopover className="shrink-0">
                      <p>{t("Skills, @file references, and built-in commands work here.")}</p>
                    </InfoPopover>
                  }
                >
                  {t("Instructions")}
                </SectionLabel>
                <div className="mt-2">
                  <InstructionsField
                    value={draft.prompt}
                    harness={draft.harness}
                    cwd={draft.cwd}
                    onChange={(prompt) => update("prompt", prompt)}
                    toolbarLeading={
                      <div className="flex shrink-0 items-center gap-1">
                        <ModelPicker
                          harness={draft.harness}
                          model={draft.model}
                          values={draft.modelSettings}
                          project={draft.cwd}
                          onChange={(harness, model) => onChange({ ...draft, harness, model })}
                          onSettingsChange={(modelSettings) =>
                            update("modelSettings", modelSettings)
                          }
                        />
                        {/* Chat settings "Extras summary: beside" also shows the active options here; the menu stays complete. */}
                        {extrasBeside ? (
                          <ModelControlPills
                            harness={draft.harness}
                            model={draft.model}
                            values={draft.modelSettings}
                            onSettingsChange={(modelSettings) =>
                              update("modelSettings", modelSettings)
                            }
                          />
                        ) : null}
                        {draft.harness !== "fx" ? (
                          <AccessPicker
                            value={draft.runtimeMode}
                            onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
                          />
                        ) : null}
                      </div>
                    }
                  />
                </div>
              </section>

              <div className="automation-editor-side">
                <section>
                  <SectionLabel as="h2" className="px-1">
                    {t("Triggers")}
                  </SectionLabel>
                  {draft.triggers.some(
                    (trigger) => trigger.kind === "tasks" || trigger.kind === "social",
                  ) ? (
                    <p className="mt-2 px-1 text-ui-caption text-(--ui-text-muted)">
                      {t(
                        "Task and social events run while this app is open. Connect the source machine; social accounts must be linked to this project.",
                      )}
                    </p>
                  ) : null}
                  {draft.triggers.length > 0 ? (
                    <ul className="mt-1 px-2">
                      {draft.triggers.map((trigger) => (
                        <li key={trigger.id}>
                          <TriggerRow
                            trigger={trigger}
                            cwd={draft.cwd}
                            background={draft.runInBackground}
                            machineId={backgroundMachineId}
                            onChange={updateTrigger}
                            onRemove={() =>
                              setTriggers(draft.triggers.filter((entry) => entry.id !== trigger.id))
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2">
                    <SearchableSelect
                      hideLabel
                      label={t("Add Trigger")}
                      value=""
                      placeholder={t("Add Trigger")}
                      options={triggerOptions}
                      onChange={selectTrigger}
                      disabled={draft.triggers.length >= 20}
                      searchPlaceholder={t("Search triggers")}
                    />
                  </div>
                </section>

                <section>
                  <SectionLabel as="h2" className="px-1">
                    {t("Session")}
                  </SectionLabel>
                  <div className="mt-1">
                    <SettingsRow
                      label={t("Runs")}
                      hint={
                        backgroundMachine
                          ? "In the background keeps running with this app closed"
                          : "Background runs need the project’s machine connected"
                      }
                    >
                      <SettingsSelect
                        label={t("Runs")}
                        value={draft.runInBackground ? "background" : "app"}
                        disabled={draft.id != null || !backgroundMachine}
                        options={[
                          {
                            value: "app",
                            get label() {
                              return t("While this app is open");
                            },
                          },
                          {
                            value: "background",
                            get label() {
                              return t("In the background on {p0}", {
                                p0: backgroundMachine ?? "its machine",
                              });
                            },
                          },
                        ]}
                        onChange={(value) => update("runInBackground", value === "background")}
                      />
                    </SettingsRow>
                    {draft.runInBackground ? null : (
                      <>
                        <SettingsRow
                          label={t("Working copy")}
                          hint="This repo, or a fresh worktree"
                        >
                          <SettingsSelect
                            label={t("Working copy")}
                            value={
                              draft.workspaceMode === "existing"
                                ? "current"
                                : (draft.workspaceMode ?? "automatic")
                            }
                            options={WORKSPACE_OPTIONS}
                            onChange={(value) =>
                              onChange({
                                ...draft,
                                workspaceMode:
                                  value === "automatic"
                                    ? undefined
                                    : (value as "current" | "worktree"),
                                worktreeCwd: "",
                                reuseSession: value === "current" && draft.reuseSession,
                              })
                            }
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={t("Conversation")}
                          hint="New chat, or continue the last run"
                        >
                          <SettingsSelect
                            label={t("Conversation")}
                            value={draft.reuseSession ? "reuse" : "fresh"}
                            disabled={draft.workspaceMode === "worktree"}
                            options={CONVERSATION_OPTIONS}
                            onChange={(value) => update("reuseSession", value === "reuse")}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={t("Session folder")}
                          hint={
                            folderChoices.error ??
                            (folderChoices.loading
                              ? t("Loading folders…")
                              : "Where runs appear in the sidebar")
                          }
                        >
                          <SearchableSelect
                            hideLabel
                            variant="pill"
                            searchable
                            align="end"
                            label={t("Session folder")}
                            value={draft.sessionFolderId}
                            options={folderChoices.options}
                            disabled={folderChoices.loading || !!folderChoices.error}
                            onChange={(value) => update("sessionFolderId", value)}
                          />
                        </SettingsRow>
                      </>
                    )}
                  </div>
                </section>

                <Disclosure
                  chevron="end"
                  summary={
                    <span className="min-w-0">
                      <span className="block text-ui-caption font-medium text-(--ui-text-muted)">
                        {t("Advanced")}
                      </span>
                      <span className="mt-0.5 block truncate text-ui-micro text-(--ui-text-muted)">
                        {limitsSummary}
                      </span>
                    </span>
                  }
                >
                  <div>
                    <SettingsRow
                      label={t("Missed-run grace")}
                      hint={
                        draft.runInBackground
                          ? "Background runs catch up within 12 hours"
                          : "Catch up if a scheduled run was missed"
                      }
                    >
                      <SettingsSelect
                        label={t("Missed-run grace")}
                        value={String(draft.runInBackground ? 720 : draft.missedRunGraceMinutes)}
                        disabled={draft.runInBackground}
                        options={GRACE_OPTIONS}
                        onChange={(value) => update("missedRunGraceMinutes", Number(value))}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={t("Run time limit")}
                      hint="Stop a run that is still going after this long"
                    >
                      <SettingsSelect
                        label={t("Run time limit")}
                        value={String(draft.maxRunMinutes)}
                        options={RUN_TIME_LIMIT_OPTIONS}
                        onChange={(value) => update("maxRunMinutes", Number(value))}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={t("Runs per day")}
                      hint="Skip scheduled and event runs past this many a day"
                    >
                      <SettingsSelect
                        label={t("Runs per day")}
                        value={String(draft.maxRunsPerDay)}
                        options={RUNS_PER_DAY_OPTIONS}
                        onChange={(value) => update("maxRunsPerDay", Number(value))}
                      />
                    </SettingsRow>
                  </div>
                </Disclosure>
              </div>
            </div>
          ) : (
            <section className="automation-content">
              <SectionLabel as="h2" className="px-1">
                {t("Run history")}
              </SectionLabel>
              {historyLoading ? <LoadingText className="p-3" /> : null}
              {historyError ? (
                <InlineError
                  className="mt-2 px-1"
                  retry={{ onRetry: onRefreshHistory, disabled: historyLoading }}
                >
                  {historyError}
                </InlineError>
              ) : null}
              {runs.length > 0 ? (
                <Surface variant="outline" padding="none" className="mt-3 overflow-x-auto">
                  <div
                    className={`${RUN_GRID} min-w-[480px] h-10 text-ui-micro text-(--ui-text-muted)`}
                  >
                    <span>{t("Trigger")}</span>
                    <span>{t("Triggered")}</span>
                    <span>{t("Status")}</span>
                    <span className="text-right">{t("Duration")}</span>
                  </div>
                  <Divider decorative />
                  <ul className="divide-y divide-stroke">
                    {runs.slice(0, 100).map((run) => (
                      <RunRow key={run.id} run={run} draft={draft} onOpenSession={onOpenSession} />
                    ))}
                  </ul>
                </Surface>
              ) : !historyLoading && !historyError ? (
                <EmptyState description={t("This automation has not run yet.")} />
              ) : null}
            </section>
          )}
        </Scroll>
      </Tabs>
    </form>
  );
}

function InstructionsField({
  value,
  harness,
  cwd,
  onChange,
  toolbarLeading,
}: {
  value: string;
  harness: AutomationDraft["harness"];
  cwd: string;
  onChange: (value: string) => void;
  toolbarLeading: ReactNode;
}) {
  useLocale();
  return (
    <SkillPromptField
      value={value}
      harness={harness}
      cwd={cwd}
      onChange={onChange}
      surface="raised"
      minRows={6}
      toolbarLeading={toolbarLeading}
      label={t("Instructions")}
      placeholder={t("Tell the agent what to do when this automation runs…")}
    />
  );
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  useLocale();
  // The shared settings Row keeps optional help behind its information control.
  return (
    <Row label={label} description={hint ? t(hint) : undefined}>
      {children}
    </Row>
  );
}

function SettingsSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <SearchableSelect
      hideLabel
      variant="pill"
      searchable={false}
      align="end"
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

function ToggleSwitch({
  label,
  on,
  onChange,
  compact = false,
  busy = false,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  compact?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const control = (
    <Switch
      label={compact ? undefined : label}
      aria-label={label}
      checked={on}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || disabled || undefined}
      onCheckedChange={(value) => {
        if (!busy && !disabled) onChange(value);
      }}
      compact={compact}
    />
  );
  return compact ? <Tooltip label={label}>{control}</Tooltip> : control;
}

const WORKSPACE_OPTIONS = [
  {
    value: "automatic",
    get label() {
      return t("Automatic");
    },
  },
  {
    value: "current",
    get label() {
      return t("Current");
    },
  },
  {
    value: "worktree",
    get label() {
      return t("Fresh worktree");
    },
  },
] as const;

const CONVERSATION_OPTIONS = [
  {
    value: "fresh",
    get label() {
      return t("Start fresh");
    },
  },
  {
    value: "reuse",
    get label() {
      return t("Continue last");
    },
  },
] as const;

const TEMPLATE_ICONS: Record<AutomationTemplateIcon, typeof Search> = {
  search: Search,
  alert: AlertCircle,
  file: File,
  check: CheckCircle,
  lock: Lock,
  pr: GitPullRequest,
  inbox: Inbox,
  gauge: Gauge,
  terminal: Terminal,
  note: StickyNote,
};

function triggerText(trigger: AutomationTrigger): string {
  return trigger.kind === "time"
    ? automationScheduleLabel(trigger)
    : (findTriggerEvent(trigger.kind, trigger.event)?.label ?? triggerName(trigger.kind));
}

/** The first trigger; the card lists the others behind a "+N". */
function triggerLabel(automation: Automation): string {
  const first = automationTriggers(automation)[0];
  return first ? triggerText(first) : "No trigger";
}

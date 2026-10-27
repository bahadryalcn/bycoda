import { useQuery, useQueryClient } from "@tanstack/react-query";
import "./automations.css";
import { AutomationAssistant } from "./AutomationAssistant";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Switch } from "../../../shared/ui/Switch";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { Row } from "../../settings/ui/settingsControls";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Clock,
  File,
  Gauge,
  GitPullRequest,
  Inbox,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  StickyNote,
  Terminal,
  Trash2,
  X,
  Zap,
} from "../../../shared/ui/icons";
import { InboxProviderMark } from "../../inbox/ui/InboxProviderMark";
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
  AUTOMATION_WEEKDAYS,
  applyTriggers,
  applyAutomationChange,
  automationScheduleLabel,
  automationTriggers,
  createAutomationTrigger,
  createManualAutomationRun,
  deleteAutomation,
  draftFromAutomation,
  draftFromTemplate,
  formatAutomationRunAt,
  formatAutomationRunDuration,
  gmtOffsetLabel,
  listAutomationRuns,
  listAutomations,
  newAutomationDraft,
  nextAutomationRunAt,
  nextRunPreview,
  peekAutomations,
  saveAutomation,
  setAutomationEnabled,
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
import {
  backgroundMachineFor,
  probeMachines,
  deleteHostAutomation,
  listHostAutomationRuns,
  listHostAutomationResults,
  runHostAutomationNow,
  saveHostAutomation,
  previewHostAutomation,
  type HostSchedulePreview,
} from "../model/hostAutomationClient";
import { failedMachineNames } from "../model/machineResults";
import type { RemoteMachine } from "../../connections/model/protocol";
import { AZUREDEVOPS_CHANGE_EVENT, azureDevOpsConnected } from "../../inbox/model/azureDevOps";
import { gitBranches } from "../../../platform/tauri/fs";
import { formatRelativeTime, githubStatus } from "../../inbox/model/githubTasks";
import { GITLAB_CHANGE_EVENT, gitlabConnected } from "../../inbox/model/gitlab";
import { LINEAR_CHANGE_EVENT, linearConnected } from "../../inbox/model/linear";
import { JIRA_CHANGE_EVENT, jiraConnected } from "../../inbox/model/jira";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import { loadSessionFolders, subscribeSessionFolders } from "../../sessions/model/sessionFolders";
import { loadModelControls, subscribeModelControls } from "../../settings/model/settings";
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

type Props = {
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

function automationKey(automation: Pick<Automation, "id" | "host">): string {
  return JSON.stringify([automation.host?.machineId ?? null, automation.id]);
}

export function AutomationsView({
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
  return (
    <div
      role="region"
      aria-label={t("Automations")}
      data-app-automations
      style={{ containerType: "inline-size", containerName: "automations" }}
      className="flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-(--ui-tone-neutral-border)"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
            <Zap className="icon-sm shrink-0 text-(--ui-text-muted)" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-(--ui-tone-neutral-fg)">{t("Automations")}</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <AutomationsContent
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
  cwd,
  recents,
  onLaunch,
  onOpenSession,
  onOpenBackgroundSession,
  onLaunchAssistant,
}: Pick<
  Props,
  "cwd" | "recents" | "onLaunch" | "onOpenSession" | "onOpenBackgroundSession" | "onLaunchAssistant"
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
  const loading = localQuery.isPending;
  // Automations aimed at a project in a locked group are not listed.
  const lock = useLockSnapshot();
  // Automations that machines' hosts run on their own, this computer's included.
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [hostAutomations, setHostAutomations] = useState<Automation[]>([]);
  // Machines that did not answer; their automations shown are last-known ones.
  const [unreachableNames, setUnreachableNames] = useState<string[]>([]);
  const hostAutomationsRef = useRef(hostAutomations);
  const showHostAutomations = useCallback(
    (next: Automation[]) => {
      hostAutomationsRef.current = next;
      setHostAutomations(next);
      queryClient.setQueryData<{
        machines: RemoteMachine[];
        unreachable: string[];
        automations: Automation[];
      }>(["automations", "hosts"], (current) =>
        current ? { ...current, automations: next } : current,
      );
    },
    [queryClient],
  );
  const automations = useMemo(
    () =>
      [...storedAutomations, ...hostAutomations].filter(
        (automation) => !isProjectLockedIn(lock, automation.cwd),
      ),
    [hostAutomations, lock, storedAutomations],
  );
  const [history, setHistory] = useState<{
    id: string | null;
    runs: AutomationRun[];
    loading: boolean;
    error: string | null;
  }>({ id: null, runs: [], loading: false, error: null });
  const [historyRevision, setHistoryRevision] = useState(0);
  const viewStateKey = `automations:${cwd ? projectKey(cwd) : "global"}`;
  const [selectedId, setSelectedId] = useRetainedState<string | null>(
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
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useRetainedState<AutomationDraft | null>(`${viewStateKey}:draft`, null);
  const [pickerOpen, setPickerOpen] = useState(() => draft == null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const togglingRef = useRef(new Set<string>());
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const logos = useTabGroupLogos();
  const [groupLabels] = useState(loadTabGroupLabels);
  const [groupMascots] = useState(loadTabGroupMascots);
  const [groupColors] = useState(loadTabGroupColors);
  const [groupCustomColors] = useState(loadTabGroupCustomColors);

  useEffect(() => {
    if (localQuery.error) setError(localQuery.error.message);
    else if (localQuery.data) setError(null);
  }, [localQuery.error, localQuery.data]);
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
  const hostQuery = useQuery({
    queryKey: ["automations", "hosts"],
    queryFn: async () => {
      const reach = await probeMachines();
      const results = await listHostAutomationResults(reach.capable, reach.unreachableMachines);
      return {
        machines: reach.capable,
        unreachable: failedMachineNames(results),
        automations: results.flatMap((result) => result.data),
      };
    },
    enabled: queryVisible,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const refreshHost = useCallback(async () => {
    await hostQuery.refetch();
  }, [hostQuery.refetch]);
  useEffect(() => {
    if (!hostQuery.data) return;
    setMachines(hostQuery.data.machines);
    setUnreachableNames(hostQuery.data.unreachable);
    showHostAutomations(hostQuery.data.automations);
  }, [hostQuery.data, showHostAutomations]);
  useEffect(() => {
    setSelectedId((current) => {
      // A retained host selection must survive the local list arriving first.
      if (
        current &&
        (localQuery.isPending ||
          hostQuery.isPending ||
          hostQuery.data?.automations !== hostAutomations)
      )
        return current;
      return current && automations.some((entry) => automationKey(entry) === current)
        ? current
        : automations[0]
          ? automationKey(automations[0])
          : null;
    });
  }, [
    automations,
    hostAutomations,
    hostQuery.data,
    hostQuery.isPending,
    localQuery.isPending,
    setSelectedId,
  ]);
  const historyTarget = automations.find((entry) => automationKey(entry) === selectedId);
  const historyKey = [
    "automations",
    "runs",
    selectedId,
    historyTarget?.host?.machineId ?? "local",
  ] as const;
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      historyTarget?.host
        ? listHostAutomationRuns(historyTarget)
        : listAutomationRuns(historyTarget!.id),
    enabled: queryVisible && !!selectedId && !!historyTarget,
    staleTime: 10_000,
    retry: false,
  });
  const previousHistoryRevision = useRef(historyRevision);
  useEffect(() => {
    if (previousHistoryRevision.current === historyRevision) return;
    previousHistoryRevision.current = historyRevision;
    void queryClient.invalidateQueries({ queryKey: historyKey });
  }, [historyRevision, selectedId, queryClient]);
  useEffect(() => {
    setHistory({
      id: selectedId,
      runs: historyQuery.data ?? [],
      loading: !!historyTarget && historyQuery.isPending,
      error: historyQuery.error?.message ?? null,
    });
  }, [selectedId, historyTarget, historyQuery.data, historyQuery.isPending, historyQuery.error]);

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

  const defaultDraftTarget = () => {
    const project = cwd && looksLikeProject(cwd) ? cwd : (recents[0]?.path ?? "~");
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, selected?.harness ?? preferred.harness);
    const model =
      (selected?.harness === harness ? selected.model : undefined) ??
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    return { project, harness, model };
  };

  const beginCreate = () => {
    if (savingRef.current) return;
    setCompactListOpen(false);
    setPickerOpen(true);
    setDraft(null);
  };

  const beginBlank = () => {
    if (savingRef.current) return;
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft(newAutomationDraft(project, harness, model));
  };

  const beginFromTemplate = (template: AutomationTemplate) => {
    if (savingRef.current) return;
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft(
      draftFromTemplate(project, harness, model, {
        ...template,
        name: t(template.name),
        prompt: t(template.prompt),
      }),
    );
  };

  const onSave = async (event: FormEvent, nextDraft: AutomationDraft) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (nextDraft.id && selected?.host && nextDraft.cwd !== selected.cwd) {
        throw new Error("Create a new automation to use another project.");
      }
      const saved = nextDraft.runInBackground
        ? await saveHostAutomation(machines, nextDraft)
        : await saveAutomation(nextDraft);
      if (saved.host)
        showHostAutomations([
          ...hostAutomationsRef.current.filter(
            (entry) => automationKey(entry) !== automationKey(saved),
          ),
          saved,
        ]);
      setPickerOpen(false);
      setDraft(null);
      setSelectedId(automationKey(saved));
      setError(null);
      if (saved.host) await refreshHost();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onRun = async (automation: Automation) => {
    if (running) return;
    setRunning(automationKey(automation));
    try {
      if (automation.host) {
        await runHostAutomationNow(automation);
        await refreshHost();
        return;
      }
      const run = await createManualAutomationRun(automation.id);
      await onLaunch(automation, run);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(null);
    }
  };

  const onDelete = async (automation: Automation) => {
    if (deleting || saving) return;
    if (
      running === automationKey(automation) ||
      automation.lastRunStatus === "running" ||
      (history.id === automationKey(automation) &&
        history.runs.some((run) => run.status === "running"))
    ) {
      setError(t("Wait for the current run to finish before deleting this automation."));
      return;
    }
    if (
      !(await confirm({
        title: t("Delete automation"),
        message: t("Delete “{p0}” and its run history?", { p0: automation.name }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    setDeleting(automationKey(automation));
    try {
      if (automation.host) {
        await deleteHostAutomation(automation);
        showHostAutomations(
          hostAutomationsRef.current.filter(
            (entry) => automationKey(entry) !== automationKey(automation),
          ),
        );
      } else await deleteAutomation(automation.id);
      setSelectedId(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(null);
    }
  };

  const onToggle = async (automation: Automation, enabled: boolean) => {
    const key = automationKey(automation);
    if (savingRef.current || togglingRef.current.has(key)) return;
    togglingRef.current.add(key);
    setToggling(new Set(togglingRef.current));
    try {
      if (automation.host) {
        await saveHostAutomation(machines, {
          ...draftFromAutomation(automation),
          enabled,
        });
        await refreshHost();
        return;
      }
      await setAutomationEnabled(automation, enabled);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      togglingRef.current.delete(key);
      setToggling(new Set(togglingRef.current));
    }
  };

  const editorDraft = pickerOpen
    ? null
    : (draft ?? (selected ? draftFromAutomation(selected) : null));
  const listLock = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      className="automation-layout flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row text-(--ui-tone-neutral-fg)"
      data-list-open={compactListOpen || undefined}
    >
      {confirmDialog}
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
      <aside
        hidden={focusMode}
        className={
          focusMode
            ? "hidden"
            : "flex w-full max-h-48 sm:max-h-none sm:w-[250px] shrink-0 flex-col border-r border-(--ui-tone-neutral-border)"
        }
      >
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-(--ui-tone-neutral-border) px-2">
          <Button
            ref={filterButton}
            type="button"
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Filter automations")}
            selected={!!query.trim() || statusFilter !== "all"}
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
          <span className="flex-1" />
          <Button
            type="button"
            title={t("New automation")}
            aria-label={t("New automation")}
            onClick={beginCreate}
            variant="ghost"
            iconOnly
            label={t("New automation")}
            size="sm"
          >
            <Plus className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
        <div ref={listLock} className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5">
          {unreachableNames.length ? (
            <Alert tone="warning" className="mb-1.5">
              {unreachableNames.join(", ")}{" "}
              {unreachableNames.length === 1 ? t("isn’t") : t("aren’t")}
              {t(" reachable right now, so its automations may be out of date.")}
            </Alert>
          ) : null}
          {loading ? (
            <div className="grid place-items-center py-12 text-(--ui-text-muted)">
              <LoaderCircle className="icon-md animate-spin" />
            </div>
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
                    onSelect={() => {
                      if (savingRef.current) return;
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
              description={query.trim() ? t("No matching automations") : t("No automations yet")}
            />
          )}
        </div>
      </aside>

      <main className="automation-workspace flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2">
          <span className="mr-auto text-ui-caption text-(--ui-text-muted)">
            {t("Automations")} · {automations.length}
          </span>
          <Button variant="ghost" onClick={beginCreate}>
            <Plus className="icon-sm" />
            {t("New automation")}
          </Button>
          {onLaunchAssistant ? (
            <Button
              variant="secondary"
              aria-expanded={assistantOpen}
              onClick={() => setAssistantOpen(!assistantOpen)}
            >
              {t("AI assistant")}
            </Button>
          ) : null}
          <Button
            className="automation-focus-action"
            variant="ghost"
            aria-pressed={focusMode}
            onClick={() => setFocusMode(!focusMode)}
          >
            {t(focusMode ? "Show automation list" : "Focus mode")}
          </Button>
        </div>
        {assistantOpen && onLaunchAssistant ? (
          <div className="shrink-0 px-3 py-3">
            <AutomationAssistant cwd={cwd} recents={recents} onLaunch={onLaunchAssistant} />
          </div>
        ) : null}
        {error ? (
          <Alert tone="danger" className="m-4 shrink-0">
            {error}
          </Alert>
        ) : null}
        {loading && !editorDraft ? (
          <div className="grid min-h-0 flex-1 place-items-center text-(--ui-text-muted)">
            <LoaderCircle className="icon-md animate-spin" />
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
              runs={editorDraft.id && history.id === selectedId ? history.runs : []}
              historyLoading={!!editorDraft.id && (history.id !== selectedId || history.loading)}
              historyError={history.id === selectedId ? history.error : null}
              onRefreshHistory={() => setHistoryRevision((value) => value + 1)}
              saving={saving}
              running={!!editorDraft.id && selectedId === running}
              deleteDisabled={
                saving ||
                !!deleting ||
                (!!editorDraft.id && selectedId === running) ||
                selected?.lastRunStatus === "running" ||
                (history.id === selectedId && history.runs.some((run) => run.status === "running"))
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
              onChange={(nextDraft) => {
                if (!savingRef.current) setDraft(nextDraft);
              }}
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
                  setError(reason instanceof Error ? reason.message : String(reason));
                }
              }}
            />
          </HostModelSource>
        ) : (
          <AutomationPicker onBlank={beginBlank} onPick={beginFromTemplate} />
        )}
      </main>
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
  return (
    <div className="group relative rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface)">
      <Button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={t("Open {p0}", { p0: automation.name })}
        onClick={onSelect}
        variant="item"
        selected={active}
        layout="stacked"
      >
        <span className="flex min-w-0 items-center gap-1.5 pr-14 text-ui-caption text-(--ui-text-muted)">
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
            <Badge tone="warning" className="shrink-0">
              {t("Needs input")}
            </Badge>
          ) : automation.lastRunStatus === "failed" || automation.lastRunStatus === "running" ? (
            <RunStatusPill status={automation.lastRunStatus} />
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
          <span
            title={model.name}
            className="ml-auto flex min-w-0 max-w-28 items-center gap-1 text-(--ui-text-muted)"
          >
            <HarnessIcon harness={automation.harness} className="icon-sm shrink-0" />
            <span className="min-w-0 truncate">{model.name}</span>
          </span>
        </span>
      </Button>
      <span className="absolute right-2.5 top-2 flex items-center gap-1">
        {pending ? <LoaderCircle className="icon-xs animate-spin" aria-hidden="true" /> : null}
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

function AutomationPicker({
  onBlank,
  onPick,
}: {
  onBlank: () => void;
  onPick: (template: AutomationTemplate) => void;
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

  return (
    <div ref={lockOverscroll} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none">
      <div className="automation-content">
        <h1 className="text-ui-heading font-medium leading-tight text-(--ui-tone-neutral-fg)">
          {t("New automation")}
        </h1>
        <p className="mt-1.5 text-ui-secondary text-(--ui-text-muted)">
          {t("Pick an example or start from scratch.")}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <TextField
            label={t("Search templates")}
            hideLabel
            placeholder={t("Search templates")}
            value={templateQuery}
            onChange={(event) => setTemplateQuery(event.target.value)}
            fieldClassName="min-w-0 flex-1"
          />
          <SearchableSelect
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
          <p role="status" className="mt-4 text-ui-secondary text-(--ui-text-muted)">
            {t("No matching options")}
          </p>
        ) : null}
        <div className="automation-gallery mt-4">
          <Button
            type="button"
            onClick={onBlank}
            variant="item"
            layout="stacked"
            className="automation-template flex h-full min-w-0 flex-col"
          >
            <div className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center text-(--ui-text-muted)">
                <Plus className="icon-md" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                  {t("Start from scratch")}
                </span>
                <span className="mt-1 line-clamp-3 text-ui-caption leading-snug text-(--ui-text-muted)">
                  {t("Write your own instructions and choose a trigger.")}
                </span>
              </span>
            </div>
          </Button>
          {(allTemplates || templateQuery.trim() || category !== "all"
            ? templates
            : templates.slice(0, 4)
          ).map((template) => {
            const Icon = TEMPLATE_ICONS[template.icon];
            return (
              <Button
                key={template.id}
                type="button"
                onClick={() => onPick(template)}
                variant="item"
                layout="stacked"
                className="automation-template flex h-full min-w-0 flex-col"
                title={t(template.description)}
              >
                <div className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center text-(--ui-text-muted)">
                    <Icon className="icon-md" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                      {t(template.name)}
                    </span>
                    <span className="mt-1 line-clamp-3 text-ui-caption leading-snug text-(--ui-text-muted)">
                      {t(template.description)}
                    </span>
                  </span>
                </div>
                <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-3 text-ui-micro text-(--ui-text-muted)">
                  <TriggerMark kind={template.trigger.kind} className="icon-xs" />
                  <span className="min-w-0 truncate">{t(template.triggerLabel)}</span>
                </span>
              </Button>
            );
          })}
        </div>
        {!templateQuery.trim() && category === "all" && templates.length > 4 ? (
          <Button
            className="mt-3"
            variant="ghost"
            aria-expanded={allTemplates}
            onClick={() => setAllTemplates((value) => !value)}
          >
            {t(allTemplates ? "Show less" : "Show all")} · {templates.length}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const RUN_GRID = "grid grid-cols-[minmax(0,1.4fr)_9.5rem_6.75rem_3.5rem] items-center gap-4 px-4";

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
        title={sessionId ? t("Open session") : (run.error ?? t("This run has no session yet"))}
        onClick={() => {
          if (!sessionId) return;
          void onOpenSession(sessionId);
        }}
        variant="item"
        className={`${RUN_GRID} min-w-[560px] w-full`}
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
            className="col-span-full truncate text-start text-ui-micro text-(--ui-tone-danger-fg)"
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
      icon={status === "running" ? <LoaderCircle className="icon-xs animate-spin" /> : undefined}
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
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const settingsTabId = useId();
  const historyTabId = useId();
  const tabPanelId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [providerConnected, setProviderConnected] = useState({
    github: false,
    linear: false,
    jira: false,
    gitlab: false,
    azuredevops: false,
  });
  const controlsBeside =
    useSyncExternalStore(subscribeModelControls, loadModelControls) === "beside";
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.all([
        githubStatus()
          .then((status) => status.connected)
          .catch(() => false),
        linearConnected()
          .then((status) => status.connected)
          .catch(() => false),
        jiraConnected()
          .then((status) => status.connected)
          .catch(() => false),
        gitlabConnected()
          .then((status) => status.connected)
          .catch(() => false),
        azureDevOpsConnected()
          .then((status) => status.connected)
          .catch(() => false),
      ]).then(([github, linear, jira, gitlab, azuredevops]) => {
        if (!cancelled) {
          setProviderConnected({ github, linear, jira, gitlab, azuredevops });
        }
      });
    };
    load();
    window.addEventListener(LINEAR_CHANGE_EVENT, load);
    window.addEventListener(JIRA_CHANGE_EVENT, load);
    window.addEventListener(GITLAB_CHANGE_EVENT, load);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(LINEAR_CHANGE_EVENT, load);
      window.removeEventListener(JIRA_CHANGE_EVENT, load);
      window.removeEventListener(GITLAB_CHANGE_EVENT, load);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, load);
    };
  }, []);
  const triggerReady = (kind: AutomationTriggerKind) => {
    if (kind === "time" || kind === "tasks" || kind === "social") return true;
    return providerConnected[kind];
  };
  const valid =
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    looksLikeProject(draft.cwd) &&
    draft.model.length > 0;
  const [sessionFolders, setSessionFolders] = useState(() => loadSessionFolders(draft.cwd));
  useEffect(() => {
    setSessionFolders(loadSessionFolders(draft.cwd));
    return subscribeSessionFolders(draft.cwd, () => {
      setSessionFolders(loadSessionFolders(draft.cwd));
    });
  }, [draft.cwd]);
  const folderOptions = useMemo(() => {
    const options = [
      {
        value: "",
        get label() {
          return t("None");
        },
      },
      ...sessionFolders.map((folder) => ({
        value: folder.id,
        label: folder.name,
        keywords: folder.name,
      })),
    ];
    if (
      draft.sessionFolderId &&
      !sessionFolders.some((folder) => folder.id === draft.sessionFolderId)
    ) {
      options.push({
        value: draft.sessionFolderId,
        get label() {
          return t("Removed folder");
        },
        keywords: draft.sessionFolderId,
      });
    }
    return options;
  }, [getLocale(), draft.sessionFolderId, sessionFolders]);
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

  return (
    <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={onSubmit} aria-busy={saving}>
      <div className="relative w-full shrink-0 border-b border-(--ui-tone-neutral-border)">
        <div className="flex w-full flex-col gap-2.5 px-3 sm:px-6 pt-4">
          <header className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-start gap-3">
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
                    disabled={saving}
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
              </div>
            </div>
            <div
              inert={saving}
              className="flex min-w-0 flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-muted)"
            >
              <ToggleSwitch
                label={draft.enabled ? t("Pause automation") : t("Enable automation")}
                on={draft.enabled}
                onChange={(enabled) => update("enabled", enabled)}
                compact
              />
              <span className="shrink-0">{draft.enabled ? t("Active") : t("Inactive")}</span>
              <span aria-hidden className="h-3 ml-2 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
              <SearchableProjectPicker
                cwd={draft.cwd}
                recents={recents}
                disabled={!!draft.id && draft.runInBackground}
                onSelectProject={(cwd) => {
                  if (!draft.id || !draft.runInBackground)
                    onChange({ ...draft, cwd, sessionFolderId: "" });
                }}
              />
              {onDelete ? (
                <>
                  <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
                  <Button
                    ref={menuButton}
                    type="button"
                    title={t("Automation actions")}
                    aria-label={t("Automation actions")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
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
          </header>
          {historyAvailable ? (
            <div
              role="tablist"
              aria-label={t("Automation view")}
              className="flex h-9 items-stretch gap-1"
            >
              <PageTab
                id={settingsTabId}
                controls={tabPanelId}
                label={t("Settings")}
                selected={!showingHistory}
                onSelect={() => setTab("settings")}
              />
              <PageTab
                id={historyTabId}
                controls={tabPanelId}
                label={t("Run history")}
                selected={showingHistory}
                onSelect={() => setTab("history")}
              />
            </div>
          ) : (
            <div className="pb-5" />
          )}
        </div>
      </div>

      <div
        ref={lockOverscroll}
        inert={saving}
        id={historyAvailable ? tabPanelId : undefined}
        role={historyAvailable ? "tabpanel" : undefined}
        aria-labelledby={
          historyAvailable ? (showingHistory ? historyTabId : settingsTabId) : undefined
        }
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
      >
        {!showingHistory ? (
          <div className="automation-content automation-editor-grid">
            <section>
              <SectionTitle>{t("Instructions")}</SectionTitle>
              <div
                data-ui-focus-group=""
                className="relative mt-3 rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface) has-focus:border-(--ui-tone-neutral-border)"
              >
                <PromptField
                  value={draft.prompt}
                  harness={draft.harness}
                  cwd={draft.cwd}
                  onChange={(prompt) => update("prompt", prompt)}
                />
                <div className="flex items-center gap-1 px-2 pb-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
                    <div className="flex shrink-0 items-center gap-1">
                      <ModelPicker
                        harness={draft.harness}
                        model={draft.model}
                        values={draft.modelSettings}
                        project={draft.cwd}
                        hideSettings={controlsBeside}
                        onChange={(harness, model) => onChange({ ...draft, harness, model })}
                        onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                      />
                      {controlsBeside ? (
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
                  </div>
                </div>
              </div>
              <p className="mt-2 px-1 text-ui-micro text-(--ui-text-muted)">
                {t("Skills, @file references, and built-in commands work here.")}
              </p>
            </section>

            <section>
              <SectionTitle>{t("Triggers")}</SectionTitle>
              {draft.triggers.some(
                (trigger) => trigger.kind === "tasks" || trigger.kind === "social",
              ) ? (
                <p className="mt-2 text-ui-caption text-(--ui-text-muted)">
                  {t(
                    "Task and social events run while this app is open. Connect the source machine; social accounts must be linked to this project.",
                  )}
                </p>
              ) : null}
              <div className="mt-3 rounded-md border border-(--ui-tone-neutral-border)">
                {draft.triggers.length > 0 ? (
                  <ul className="px-3 py-1.5">
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
                {draft.triggers.length > 0 ? (
                  <div className="border-t border-(--ui-tone-neutral-border)" />
                ) : null}
                <SearchableSelect
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
              <SectionTitle>{t("Session")}</SectionTitle>
              <div className="mt-3 overflow-hidden rounded-md border border-(--ui-tone-neutral-border)">
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
                    <SettingsRow label={t("Working copy")} hint="This repo, or a fresh worktree">
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
                              value === "automatic" ? undefined : (value as "current" | "worktree"),
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
                      hint="Where runs appear in the sidebar"
                    >
                      <SearchableSelect
                        variant="pill"
                        searchable
                        align="end"
                        label={t("Session folder")}
                        value={draft.sessionFolderId}
                        options={folderOptions}
                        onChange={(value) => update("sessionFolderId", value)}
                      />
                    </SettingsRow>
                  </>
                )}
              </div>
            </section>

            <details className="group/advanced rounded-md border border-(--ui-tone-neutral-border)">
              <summary className="flex min-h-14 cursor-default list-none items-center justify-between gap-3 px-4">
                <span>
                  <span className="block text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
                    {t("Advanced")}
                  </span>
                  <span className="mt-0.5 block text-ui-micro text-(--ui-text-muted)">
                    {t("Catch-up window and run limits")}
                  </span>
                </span>
                <ChevronDown className="icon-sm text-(--ui-text-muted) transition-transform group-open/advanced:rotate-180" />
              </summary>
              <div className="border-t border-(--ui-tone-neutral-border)">
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
            </details>
          </div>
        ) : (
          <section className="automation-content">
            <SectionTitle>{t("Run history")}</SectionTitle>
            {historyLoading ? (
              <p role="status" className="p-3 text-ui-caption text-(--ui-text-muted)">
                {t("Loading…")}
              </p>
            ) : null}
            {historyError ? (
              <Alert tone="danger">
                <p>{historyError}</p>
                <Button
                  type="button"
                  onClick={onRefreshHistory}
                  disabled={historyLoading}
                  variant="ghost"
                >
                  {t("Retry")}
                </Button>
              </Alert>
            ) : null}
            {runs.length > 0 ? (
              <div className="mt-3 overflow-x-auto rounded-md border border-(--ui-tone-neutral-border)">
                <div
                  className={`${RUN_GRID} min-w-[560px] h-10 text-ui-micro text-(--ui-text-muted)`}
                >
                  <span>{t("Trigger")}</span>
                  <span>{t("Triggered")}</span>
                  <span>{t("Status")}</span>
                  <span className="text-right">{t("Duration")}</span>
                </div>
                <ul className="divide-y divide-stroke border-t border-(--ui-tone-neutral-border)">
                  {runs.slice(0, 100).map((run) => (
                    <RunRow key={run.id} run={run} draft={draft} onOpenSession={onOpenSession} />
                  ))}
                </ul>
              </div>
            ) : !historyLoading && !historyError ? (
              <EmptyState description={t("This automation has not run yet.")} />
            ) : null}
          </section>
        )}
      </div>
    </form>
  );
}

function PromptField({
  value,
  harness,
  cwd,
  onChange,
}: {
  value: string;
  harness: AutomationDraft["harness"];
  cwd: string;
  onChange: (value: string) => void;
}) {
  useLocale();
  return (
    <SkillPromptField
      value={value}
      harness={harness}
      cwd={cwd}
      onChange={onChange}
      focusOwner="group"
      label={t("Instructions")}
      placeholder={t("Tell the agent what to do when this automation runs…")}
    />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  useLocale();
  return <h2 className="px-1 text-ui-caption font-medium text-(--ui-text-muted)">{children}</h2>;
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

function PageTab({
  id,
  controls,
  label,
  selected,
  onSelect,
}: {
  id: string;
  controls: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  return (
    <Button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onSelect}
      variant="tab"
    >
      {label}
    </Button>
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
  return (
    <Switch
      label={compact ? undefined : label}
      aria-label={label}
      title={compact ? label : undefined}
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

const GRACE_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("Do not catch up");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "720",
    get label() {
      return t("12 hours");
    },
  },
  {
    value: "1440",
    get label() {
      return t("24 hours");
    },
  },
] as const;

const RUN_TIME_LIMIT_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("No limit");
    },
  },
  {
    value: "15",
    get label() {
      return t("15 minutes");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "60",
    get label() {
      return t("1 hour");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "240",
    get label() {
      return t("4 hours");
    },
  },
  {
    value: "480",
    get label() {
      return t("8 hours");
    },
  },
] as const;

const RUNS_PER_DAY_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("No limit");
    },
  },
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "20", label: "20" },
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

const TRIGGER_CATEGORIES: readonly {
  value: AutomationTriggerKind;
  label: string;
}[] = [
  {
    value: "tasks",
    get label() {
      return t("Tasks");
    },
  },
  {
    value: "social",
    get label() {
      return t("Social Media");
    },
  },
  {
    value: "time",
    get label() {
      return t("Scheduled");
    },
  },
  {
    value: "github",
    get label() {
      return t("GitHub");
    },
  },
  {
    value: "linear",
    get label() {
      return t("Linear");
    },
  },
  {
    value: "jira",
    get label() {
      return t("Jira");
    },
  },
  {
    value: "gitlab",
    get label() {
      return t("GitLab");
    },
  },
  {
    value: "azuredevops",
    get label() {
      return t("Azure DevOps");
    },
  },
];

type TriggerEvent = {
  value: string;
  label: string;
};

export const TRIGGER_EVENTS: Record<AutomationTriggerKind, readonly TriggerEvent[]> = {
  tasks: [
    {
      value: "task_created",
      get label() {
        return t("Task created");
      },
    },
    {
      value: "task_completed",
      get label() {
        return t("Task completed");
      },
    },
    {
      value: "task_blocked",
      get label() {
        return t("Task blocked");
      },
    },
    {
      value: "task_review",
      get label() {
        return t("Task ready for review");
      },
    },
  ],
  social: [
    {
      value: "message_received",
      get label() {
        return t("Message received");
      },
    },
    {
      value: "comment_received",
      get label() {
        return t("Comment received");
      },
    },
  ],
  time: [
    {
      value: "hourly",
      get label() {
        return t("Hourly");
      },
    },
    {
      value: "daily",
      get label() {
        return t("Daily");
      },
    },
    {
      value: "weekdays",
      get label() {
        return t("Weekdays");
      },
    },
    {
      value: "weekly",
      get label() {
        return t("Weekly");
      },
    },
  ],
  github: [
    {
      value: "draft_opened",
      get label() {
        return t("Draft opened");
      },
    },
    {
      value: "pull_request_opened",
      get label() {
        return t("Pull request opened");
      },
    },
    {
      value: "pull_request_ready_for_review",
      get label() {
        return t("Pull request ready for review");
      },
    },
    {
      value: "pull_request_reopened",
      get label() {
        return t("Pull request reopened");
      },
    },
    {
      value: "pull_request_merged",
      get label() {
        return t("Pull request merged");
      },
    },
    {
      value: "pull_request_closed",
      get label() {
        return t("Pull request closed");
      },
    },
    {
      value: "pull_request_labeled",
      get label() {
        return t("Pull request labeled");
      },
    },
    {
      value: "issue_opened",
      get label() {
        return t("Issue opened");
      },
    },
    {
      value: "issue_reopened",
      get label() {
        return t("Issue reopened");
      },
    },
    {
      value: "issue_closed",
      get label() {
        return t("Issue closed");
      },
    },
    {
      value: "issue_labeled",
      get label() {
        return t("Issue labeled");
      },
    },
  ],
  linear: [
    {
      value: "issue_created",
      get label() {
        return t("Issue created");
      },
    },
  ],
  jira: [
    {
      value: "issue_created",
      get label() {
        return t("Issue appeared");
      },
    },
  ],
  gitlab: [
    {
      value: "merge_request_opened",
      get label() {
        return t("Merge request opened");
      },
    },
    {
      value: "issue_opened",
      get label() {
        return t("Issue opened");
      },
    },
  ],
  azuredevops: [
    {
      value: "pull_request_appeared",
      get label() {
        return t("Pull request appeared");
      },
    },
    {
      value: "work_item_appeared",
      get label() {
        return t("Work item appeared");
      },
    },
  ],
};

function TriggerMark({ kind, className }: { kind: AutomationTriggerKind; className?: string }) {
  useLocale();
  if (kind === "time") {
    return <Clock className={className} strokeWidth={1.75} />;
  }
  if (kind === "tasks") return <CheckCircle className={className} strokeWidth={1.75} />;
  if (kind === "social") return <Inbox className={className} strokeWidth={1.75} />;
  return <InboxProviderMark provider={kind} className={className} />;
}

function triggerName(kind: AutomationTriggerKind): string {
  return TRIGGER_CATEGORIES.find((option) => option.value === kind)?.label ?? kind;
}

function findTriggerEvent(kind: AutomationTriggerKind, value: string): TriggerEvent | undefined {
  return TRIGGER_EVENTS[kind].find((event) => event.value === value);
}

function triggerLabel(automation: Automation): string {
  const triggers = automationTriggers(automation);
  if (triggers.length === 0) return "No trigger";
  const first = triggers[0]!;
  const label =
    first.kind === "time"
      ? automationScheduleLabel(first)
      : (findTriggerEvent(first.kind, first.event)?.label ?? triggerName(first.kind));
  return triggers.length > 1 ? `${label} +${triggers.length - 1}` : label;
}

export function TriggerRow({
  trigger,
  cwd,
  background = false,
  machineId,
  onChange,
  onRemove,
}: {
  trigger: AutomationTrigger;
  cwd: string;
  background?: boolean;
  machineId?: string;
  onChange: (trigger: AutomationTrigger) => void;
  onRemove: () => void;
}) {
  useLocale();
  const [branches, setBranches] = useState<string[]>([]);
  const projectPath = looksLikeProject(cwd) ? cwd : "";
  const push = trigger.event === "push_to_branch";
  useEffect(() => {
    if (!projectPath || !push) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    void gitBranches(projectPath).then(
      (info) => {
        if (!cancelled) setBranches(info.branches.map((branch) => branch.name));
      },
      () => {
        if (!cancelled) setBranches([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectPath, push]);
  const branchOptions = branches.map((name) => ({ value: name, label: name }));
  if (trigger.branch && !branchOptions.some((option) => option.value === trigger.branch)) {
    branchOptions.unshift({ value: trigger.branch, label: trigger.branch });
  }
  const previewKey = `${machineId}:${trigger.scheduleKind}:${trigger.time}:${trigger.minute}:${trigger.dayOfWeek}`;
  const [preview, setPreview] = useState<{ key: string; value: HostSchedulePreview } | null>(null);
  useEffect(() => {
    if (!background || !machineId || trigger.kind !== "time") return;
    let cancelled = false;
    void previewHostAutomation(machineId, trigger).then(
      (value) => {
        if (!cancelled) setPreview({ key: previewKey, value });
      },
      () => {
        if (!cancelled) setPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [background, machineId, previewKey, trigger.kind]);
  const hostPreview = preview?.key === previewKey ? preview.value : undefined;
  const nextAt =
    trigger.kind === "time"
      ? background
        ? (hostPreview?.nextRunAt ?? 0)
        : nextAutomationRunAt(trigger)
      : 0;

  return (
    <div className="group flex min-h-10 items-center gap-2.5 py-1">
      <TriggerMark kind={trigger.kind} className="icon-sm shrink-0 text-(--ui-text-muted)" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-ui-secondary text-(--ui-tone-neutral-fg)">
        {trigger.kind === "time" ? (
          <TimeTriggerSentence
            trigger={trigger}
            nextAt={nextAt}
            onChange={onChange}
            executionTimeZone={background ? (hostPreview?.timeZone ?? null) : undefined}
          />
        ) : (
          <EventTriggerSentence
            trigger={trigger}
            branchOptions={branchOptions}
            projectChosen={Boolean(projectPath)}
            onChange={onChange}
          />
        )}
      </div>
      <Button
        type="button"
        aria-label={t("Remove trigger")}
        onClick={onRemove}
        variant="ghost"
        iconOnly
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        label={t("Remove trigger")}
      >
        <X className="icon-sm" />
      </Button>
    </div>
  );
}

function TimeTriggerSentence({
  trigger,
  nextAt,
  executionTimeZone,
  onChange,
}: {
  trigger: AutomationTrigger;
  nextAt: number;
  executionTimeZone?: string | null;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  useLocale();
  const dayOptions = AUTOMATION_WEEKDAYS.map((label, value) => ({
    value: String(value),
    label,
  }));
  const minuteOptions = [0, 15, 30, 45].map((value) => ({
    value: String(value),
    label: `:${String(value).padStart(2, "0")}`,
  }));
  const prefix =
    trigger.scheduleKind === "hourly"
      ? "Every hour at"
      : trigger.scheduleKind === "daily"
        ? "Every day at"
        : trigger.scheduleKind === "weekdays"
          ? "Every weekday at"
          : "Every week on";
  return (
    <>
      <span>{t(prefix)}</span>
      {trigger.scheduleKind === "weekly" ? (
        <>
          <TriggerPill
            label={t("Day")}
            value={String(trigger.dayOfWeek)}
            options={dayOptions}
            onChange={(value) => onChange({ ...trigger, dayOfWeek: Number(value) })}
          />
          <span>{t("at")}</span>
        </>
      ) : null}
      {trigger.scheduleKind === "hourly" ? (
        <TriggerPill
          label={t("Minute")}
          value={String(trigger.minute)}
          options={minuteOptions}
          onChange={(value) => onChange({ ...trigger, minute: Number(value) })}
        />
      ) : (
        <TriggerPill
          label={t("Time")}
          value={trigger.time}
          options={timeOptions(trigger.time)}
          onChange={(value) => onChange({ ...trigger, time: value })}
        />
      )}
      <span className="text-(--ui-text-muted)">
        {executionTimeZone === undefined
          ? gmtOffsetLabel()
          : (executionTimeZone ?? t("Execution host timezone unavailable"))}
      </span>
      <span className="ml-1 text-(--ui-text-muted)">
        {executionTimeZone === undefined
          ? nextRunPreview(nextAt)
          : executionTimeZone && nextAt
            ? `${t("Next run")} ${new Date(nextAt).toLocaleString(undefined, { timeZone: executionTimeZone, timeZoneName: "short" })}`
            : t("Host schedule preview unavailable")}
      </span>
    </>
  );
}

export function EventTriggerSentence({
  trigger,
  branchOptions,
  projectChosen,
  onChange,
}: {
  trigger: AutomationTrigger;
  branchOptions: { value: string; label: string }[];
  projectChosen: boolean;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  useLocale();
  if (trigger.kind === "tasks" || trigger.kind === "social")
    return <span>{findTriggerEvent(trigger.kind, trigger.event)?.label ?? trigger.event}</span>;
  const stem =
    trigger.event === "push_to_branch"
      ? "Push"
      : (findTriggerEvent(trigger.kind, trigger.event)?.label ?? trigger.event);
  const push = trigger.event === "push_to_branch";
  const labeled = trigger.event === "issue_labeled" || trigger.event === "pull_request_labeled";
  return (
    <>
      {labeled ? (
        <>
          <span>{t("Label")}</span>
          <TextField
            label={t("Label")}
            hideLabel
            aria-label={t("Label")}
            value={trigger.label ?? ""}
            onChange={(event) => onChange({ ...trigger, label: event.target.value })}
            placeholder={t("any label")}
            spellCheck={false}
            autoComplete="off"
            fieldClassName="w-32"
          />
          <span>
            {t("added to")} {trigger.event === "issue_labeled" ? t("issue") : t("pull request")}
          </span>
        </>
      ) : (
        <span>{stem}</span>
      )}
      {push ? (
        <>
          <span>{t("on")}</span>
          <TriggerPill
            label={t("Branch")}
            value={trigger.branch}
            options={branchOptions}
            placeholder={t("Select a branch")}
            disabled={!projectChosen}
            emptyLabel={projectChosen ? "No branches found" : "Choose a project first"}
            onChange={(value) => onChange({ ...trigger, branch: value })}
          />
        </>
      ) : null}
      <span>{t("by")}</span>
      <TriggerPill
        label={t("Actor")}
        value={trigger.actor || "anyone"}
        options={[
          {
            value: "anyone",
            get label() {
              return t("Anyone");
            },
          },
        ]}
        onChange={(value) => onChange({ ...trigger, actor: value })}
      />
    </>
  );
}

function TriggerPill({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; keywords?: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  useLocale();
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      emptyLabel={emptyLabel}
      variant="pill"
      searchable={label === t("Branch") || options.length > 8}
    />
  );
}

function timeOptions(current: string) {
  const options = Array.from({ length: 24 }, (_, hour) => {
    const prefix = String(hour).padStart(2, "0");
    return [
      { value: `${prefix}:00`, label: `${prefix}:00` },
      { value: `${prefix}:30`, label: `${prefix}:30` },
    ];
  }).flat();
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
}

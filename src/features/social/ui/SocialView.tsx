import { NativeSelect, Select } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { TextField } from "../../../shared/ui/TextField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { socialQueryScope } from "../model/socialQuery";
import { SocialPanelActiveContext } from "./socialContext";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { Campaigns } from "./SocialCampaigns";
import { Audience, Rules } from "./SocialManagement";
import { Inbox } from "./SocialInbox";
import { PublishingPlans } from "./SocialPublishingPlans";
import { Popover } from "../../../shared/ui/Popover";
import { SocialHistory } from "./SocialHistory";
import { SocialSendingControls } from "./SocialSendingControls";
import { RetainedSocialPanel } from "./RetainedSocialPanel";
import {
  Empty,
  Notice,
  StatusBadge,
  Composer,
  closeComposer,
  Projects,
  field,
  names,
  operations,
  type Run,
  type Props,
} from "./socialShared";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import { pathKey } from "../../../shared/lib/paths";
import { socialClient } from "../model/socialClient";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_ACCOUNT_TYPES,
  PROFILE_ONLY_PLATFORMS,
  TOKEN_PLATFORMS,
  type SocialAccount,
  type SocialSnapshot,
  type SocialOperation,
  type SocialCollection,
  type SocialWorkspaceQuery,
  type SocialWorkspaceResponse,
  type SocialWorkspaceFilters,
  type SocialCollectionFilter,
} from "../model/social";
import "./social.css";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  Globe,
  RefreshCw,
  X,
  Link,
  Share,
  Inbox as InboxIcon,
  MessageMultiple,
  Zap,
  Settings,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { accountConnectionStatus } from "../model/accountConnection";
import { SocialAuthority } from "./SocialAuthority";
import { SocialPolicySettings } from "./SocialPolicySettings";
import { SocialBrowserWorkspace } from "./SocialBrowserWorkspace";
import { DEFAULT_SOCIAL_POLICIES } from "../model/socialPolicy";
import {
  createRefreshScheduler,
  type RefreshScheduler,
} from "../../automations/model/refreshScheduler";
import type { SocialClient } from "../model/socialClient";
import { scopeSocialSnapshot } from "../model/socialWorkspace";

type Tab = "Accounts" | "Campaigns" | "Inbox" | "Audience" | "Automations" | "Settings";
const tabs: Tab[] = ["Accounts", "Campaigns", "Inbox", "Audience", "Automations", "Settings"];
function accountTypeLabel(id: string) {
  return (
    {
      member: t("Member"),
      professional: t("Professional"),
      page: t("Page"),
      channel: t("Channel"),
      organization: t("Organization account"),
      public_profile: t("Public profile"),
      business: t("Business"),
      bot: t("Bot"),
    } as Record<string, string>
  )[id];
}
function permissionLabels(): Record<string, string> {
  return {
    read: t("Read"),
    draft: t("Draft"),
    publish: t("Sharing"),
    reply: t("Reply"),
    message: t("Message"),
    comment: t("Comment"),
  };
}
function tabLabel(tab: Tab) {
  return {
    Accounts: t("Accounts"),
    Campaigns: t("Campaigns"),
    Inbox: t("Inbox"),
    Audience: t("Audience"),
    Automations: t("Automations"),
    Settings: t("Settings"),
  }[tab];
}
type Section = NonNullable<SocialWorkspaceQuery["section"]>;
function workspaceSection(tab: Tab, automationMode: string): Section {
  if (tab === "Automations")
    return (
      (
        { publish: "plans", reply: "rules", history: "history", sending: "sending" } as Record<
          string,
          Section
        >
      )[automationMode] ?? "plans"
    );
  return (
    {
      Accounts: "accounts",
      Campaigns: "campaigns",
      Inbox: "inbox",
      Audience: "audience",
      Settings: "settings",
    } as const
  )[tab];
}
type HostWorkspaceState = {
  machineId: string;
  snapshots: Map<Section, SocialSnapshot>;
  cursors: Map<string, SocialWorkspaceResponse>;
  projects: HostProject[];
  projectsLoaded: boolean;
  snapshot: SocialSnapshot | null;
  tab: Tab;
  visited: Tab[];
  filter: string;
  offsets: SocialWorkspaceQuery["offsets"];
  automationMode: string;
  collectionFilters: Partial<Record<Section, SocialWorkspaceFilters>>;
  client?: SocialClient;
  run?: Run;
};
const tabIcons = {
  Accounts: Link,
  Campaigns: Share,
  Inbox: InboxIcon,
  Audience: MessageMultiple,
  Automations: Zap,
  Settings: Settings,
};
/** Sentinel stored in browser availability state; the visible text is translated when rendered. */
const HOST_BROWSER_UNSUPPORTED = "host-browser-unsupported";
const actionMessages: Record<string, () => string> = {
  "accounts.create": () => t("Account added. Complete the connection."),
  "accounts.grant": () => t("Project permissions saved."),
  "accounts.pause": () => t("Account run state updated."),
  "accounts.disconnect": () => t("Account disconnected."),
  "campaigns.create": () => t("Campaign draft saved."),
  "campaigns.update": () => t("Campaign updated. Approve the current content again."),
  "campaigns.approve": () => t("Campaign content approved."),
  "campaigns.schedule": () => t("Post queued. Track the result in Activity history."),
  "campaigns.pause": () => t("Campaign run state updated."),
  "contacts.upsert": () => t("Contact details saved."),
  "contacts.import": () => t("Contacts imported."),
  "segments.create": () => t("Contact group created."),
  "replies.draft": () => t("Reply draft ready. Review and approve it."),
  "messages.draft": () => t("Message draft ready. Review and approve it."),
  "comments.draft": () => t("Comment draft ready. Review and approve it."),
  "drafts.update": () => t("Draft updated; the earlier send approval was removed."),
  "drafts.approve": () => t("Draft approved. Ready to send."),
  "replies.send": () => t("Reply queued. Track the send result in Activity history."),
  "messages.send": () => t("Message queued. Track the send result in Activity history."),
  "comments.send": () => t("Comment queued. Track the send result in Activity history."),
  "jobs.cancel": () => t("Queued job cancelled."),
  "jobs.retry": () => t("Failed job queued again."),
  "thread.assign": () => t("Conversation project updated."),
  "policy.update": () => t("Agent and content limits saved."),
  "automations.create": () => t("Reply rule saved. Activate it when you are ready."),
  "automations.activate": () => t("Reply rule activated."),
  "automations.pause": () => t("Reply rule paused."),
};
export function SocialView({
  cwd,
  onClose,
  besideRail = false,
  compactRail = false,
  onToggleSidebar = () => {},
}: {
  cwd: string;
  besideRail?: boolean;
  compactRail?: boolean;
  onToggleSidebar?: () => void;
  onClose: () => void;
}) {
  useLocale();
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [tab, setTab] = useState<Tab>("Accounts");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [visited, setVisited] = useState<Tab[]>(["Accounts"]);
  const selectTab = (item: Tab) => {
    setNotice("");
    setError("");
    setTab(item);
    setVisited((current) => (current.includes(item) ? current : [...current, item]));
  };
  const [automationMode, setAutomationMode] = useState("publish");
  const [filter, setFilter] = useState("");
  const [offsets, setOffsets] = useState<SocialWorkspaceQuery["offsets"]>({});
  const [collectionFilters, setCollectionFilters] = useState<
    Partial<Record<Section, SocialWorkspaceFilters>>
  >({});
  const hostWorkspaces = useRef(new Map<string, HostWorkspaceState>());
  const scheduler = useRef<RefreshScheduler | null>(null);
  const scheduledQuery = useRef("");
  const forceRefresh = useRef(false);
  const refreshProjects = useRef(false);
  const refreshSucceeded = useRef(false);
  const legacyHosts = useRef(new Set<string>());
  const section = workspaceSection(tab, automationMode);
  const query = useRef<SocialWorkspaceQuery>({ section });
  query.current = {
    section,
    ...(filter ? { projectId: filter } : {}),
    offsets,
    filters: collectionFilters[section] ?? {},
  };
  const running = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  const currentMachine = useRef(machineId);
  const lastAction = useRef("");
  const loadedMachine = useRef("");
  const retainedSnapshot = useRef(snapshot);
  retainedSnapshot.current = snapshot;
  currentMachine.current = machineId;
  const client = useMemo(() => {
    const base = socialClient(machineId);
    const request: typeof base.request = async <T,>(
      action: string,
      input?: Record<string, unknown>,
      requestId?: string,
    ) => {
      lastAction.current = action;
      return base.request<T>(action, input, requestId);
    };
    return { ...base, request };
  }, [machineId]);
  const readWorkspace = useCallback(async (id: string, isCurrent: () => boolean) => {
    const version = ++epoch.current;
    const host = hostWorkspaces.current.get(id)!;
    const input = query.current;
    const queryKey = JSON.stringify(input);
    const force = forceRefresh.current;
    const withProjects = refreshProjects.current || !host.projectsLoaded;
    forceRefresh.current = false;
    refreshProjects.current = false;
    const base = socialClient(id);
    const read = async (): Promise<SocialWorkspaceResponse> => {
      if (!legacyHosts.current.has(id)) {
        try {
          return await base.workspaceSnapshot(
            {
              ...input,
              ...(force ? {} : { cursor: host.cursors.get(queryKey)?.cursor }),
            },
            force,
          );
        } catch (value) {
          if (!String(value).includes("Unsupported social operation")) throw value;
          legacyHosts.current.add(id);
        }
      }
      return { cursor: "", unchanged: false, snapshot: await base.snapshot() };
    };
    if (force || !retainedSnapshot.current) setRefreshing(true);
    const answers = await Promise.allSettled([
      read(),
      withProjects
        ? remoteRequest<HostProject[]>(id, "projects.list", {}, force)
        : Promise.resolve(host.projects),
    ]);
    if (!isCurrent() || version !== epoch.current || currentMachine.current !== id) return;
    setStale(answers.some((answer) => answer.status === "rejected"));
    if (answers[0].status === "fulfilled") {
      const result = answers[0].value;
      const next = result.snapshot ?? host.cursors.get(queryKey)?.snapshot;
      if (!next) throw new Error(t("The Social Media refresh response is incomplete."));
      host.cursors.set(queryKey, { ...result, snapshot: next });
      if (host.cursors.size > 16) host.cursors.delete(host.cursors.keys().next().value!);
      host.snapshot = next;
      if (legacyHosts.current.has(id)) {
        for (const key of [
          "accounts",
          "campaigns",
          "inbox",
          "audience",
          "plans",
          "rules",
          "history",
          "sending",
          "settings",
        ] as Section[])
          host.snapshots.set(key, next);
      } else host.snapshots.set(input.section!, next);
      setSnapshot(next);
      setLoadError("");
      setUpdatedAt(Date.now());
    } else {
      setLoadError(String(answers[0].reason));
    }
    if (answers[1].status === "fulfilled") {
      host.projects = answers[1].value;
      host.projectsLoaded = true;
      setProjects(answers[1].value);
    } else if (answers[0].status === "fulfilled") {
      const reason = answers[1].reason;
      setLoadError(
        t("Project list could not be refreshed: {p0}", {
          p0: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
    setLoading(false);
    setRefreshing(false);
    refreshSucceeded.current = answers.every((answer) => answer.status === "fulfilled");
  }, []);
  const refresh = useCallback(async (id: string, interactive = false, withProjects = false) => {
    if (id !== currentMachine.current || !scheduler.current) return false;
    forceRefresh.current ||= interactive;
    refreshProjects.current ||= interactive || withProjects;
    if (interactive) setRefreshing(true);
    await scheduler.current.refresh();
    return id === currentMachine.current && refreshSucceeded.current;
  }, []);
  useEffect(() => {
    let alive = true;
    if (!retainedSnapshot.current) setLoading(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const load = async () => {
      await invoke("local_host_connect").catch(() => undefined);
      const list = await invoke<RemoteMachine[]>("remote_machines");
      if (!alive) return;
      const authority = await invoke<{ authorityMachineId?: string }>(
        "social_authority_status",
      ).catch(() => null);
      if (!alive) return;
      setMachines(list);
      const saved = localStorage.getItem("bycoda.social.host");
      const preferred =
        list.find((machine) => machine.id === (authority?.authorityMachineId ?? saved)) ??
        list.find(isLocalSyncMachine) ??
        list[0];
      if (preferred) setMachineId(preferred.id);
      else
        setLoadError(
          t(
            "Connect a bycoda Host for Social Media. The queue does not run while the Host is offline.",
          ),
        );
    };
    void load()
      .catch((value) => alive && setLoadError(String(value)))
      .finally(() => alive && setLoading(false));
    if (!retainedSnapshot.current) root.current?.focus();
    return () => {
      alive = false;
      ++epoch.current;
      previousFocus?.focus();
    };
  }, [retryKey]);
  useEffect(() => {
    if (!machineId) return;
    localStorage.setItem("bycoda.social.host", machineId);
    if (loadedMachine.current !== machineId) {
      loadedMachine.current = machineId;
      let host = hostWorkspaces.current.get(machineId);
      if (!host) {
        host = {
          machineId,
          snapshots: new Map(),
          cursors: new Map(),
          projects: [],
          projectsLoaded: false,
          snapshot: null,
          tab: "Accounts",
          visited: ["Accounts"],
          filter: "",
          offsets: {},
          automationMode: "publish",
          collectionFilters: {},
        };
        hostWorkspaces.current.set(machineId, host);
      }
      retainedSnapshot.current = host.snapshot;
      setSnapshot(host.snapshot);
      setProjects(host.projects);
      setFilter(host.filter);
      setOffsets(host.offsets);
      setTab(host.tab);
      setVisited(host.visited);
      setAutomationMode(host.automationMode);
      setCollectionFilters(host.collectionFilters);
      query.current = {
        section: workspaceSection(host.tab, host.automationMode),
        ...(host.filter ? { projectId: host.filter } : {}),
        offsets: host.offsets,
        filters: host.collectionFilters[workspaceSection(host.tab, host.automationMode)] ?? {},
      };
      setError("");
      setLoadError("");
      setNotice("");
      setStale(false);
      setLoading(!host.snapshot);
      setUpdatedAt(0);
    }
    scheduledQuery.current = JSON.stringify(query.current);
    const nextScheduler = createRefreshScheduler({
      run: (isCurrent) =>
        document.hidden ? Promise.resolve() : readWorkspace(machineId, isCurrent),
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
    });
    scheduler.current = nextScheduler;
    const onVisibility = () => nextScheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    nextScheduler.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      nextScheduler.stop();
      ++epoch.current;
      if (scheduler.current === nextScheduler) scheduler.current = null;
    };
  }, [machineId, readWorkspace]);
  useEffect(() => {
    const key = JSON.stringify(query.current);
    if (!machineId || scheduledQuery.current === key) return;
    scheduledQuery.current = key;
    setRefreshing(true);
    void refresh(machineId);
  }, [machineId, tab, automationMode, filter, offsets, collectionFilters, refresh]);
  const run: Run = async (work, successMessage) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    lastAction.current = "";
    const id = machineId;
    try {
      await work();
      const completedMessage =
        successMessage ??
        actionMessages[lastAction.current]?.() ??
        t("Operation completed; results updated.");
      if (currentMachine.current === id) {
        const fresh = await refresh(id, false, true);
        setNotice(
          fresh
            ? completedMessage
            : `${completedMessage} ${t("The list could not be refreshed; showing the latest data.")}`,
        );
      }
      return true;
    } catch (value) {
      if (currentMachine.current === id)
        setError(value instanceof Error ? value.message : String(value));
      return false;
    } finally {
      setBusy(false);
      running.current = false;
    }
  };
  const activeProject = projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
  const scoped = useMemo(() => scopeSocialSnapshot(snapshot, filter), [snapshot, filter]);
  const openHistory = () => {
    setTab("Automations");
    setAutomationMode("history");
    setNotice("");
    setVisited((current) =>
      current.includes("Automations") ? current : [...current, "Automations"],
    );
  };
  const host = hostWorkspaces.current.get(machineId);
  if (host && loadedMachine.current === machineId) {
    Object.assign(host, {
      tab,
      visited,
      filter,
      offsets,
      automationMode,
      client,
      run,
      projects,
      collectionFilters,
    });
  }
  const sendingMode: { label: string; tone: "neutral" | "success" | "warning" } = !snapshot
    ? { label: "", tone: "neutral" }
    : snapshot.stopped
      ? { label: t("Sending paused"), tone: "warning" }
      : snapshot.sendingEnabled
        ? { label: t("Approved sends on"), tone: "success" }
        : { label: t("Draft mode · sending off"), tone: "neutral" };
  const hostLabel = snapshot
    ? snapshot.hostOnline
      ? t("Scheduling ready")
      : t("Scheduling offline")
    : loading
      ? t("Loading accounts…")
      : t("Could not connect");
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="region"
      aria-labelledby="social-title"
      className="social-view"
      data-app-social
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
            <Globe className="icon-sm text-(--ui-text-secondary)" aria-hidden />
            <span>{t("Social Media")}</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div className="social-layout">
        <header className="social-header">
          <div className="social-heading">
            <h1 id="social-title" className="social-sr-only">
              {tabLabel(tab)}
            </h1>
          </div>
          <div className="social-header-controls">
            <div className="social-header-field">
              <span>{t("Computer")}</span>
              <SearchableSelect
                value={machineId}
                disabled={busy}
                label={t("Authoritative host")}
                searchable={machines.length > 5}
                searchPlaceholder={t("Search computers…")}
                options={machines.map((machine) => ({
                  value: machine.id,
                  label: isLocalSyncMachine(machine) ? t("This computer") : machine.name,
                }))}
                onChange={(nextValue) => setMachineId(nextValue)}
                searchLocale={getLocale()}
              />
            </div>
            <div className="social-header-field social-project-filter">
              <span>{t("Project")}</span>
              <SearchableSelect
                label={t("Project filter")}
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setOffsets({});
                }}
                options={[
                  { value: "", label: t("All projects") },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name || project.cwd,
                    keywords: project.cwd,
                  })),
                ]}
                searchPlaceholder={t("Search projects…")}
                emptyLabel={t("No project found")}
                disabled={busy}
              />
            </div>
          </div>
          <div className="social-host-status" role="status">
            {snapshot ? (
              <Button
                variant="ghost"
                type="button"
                size="sm"
                aria-label={t("Sending controls: {p0}", { p0: sendingMode.label })}
                title={t("Sending controls")}
                onClick={() => {
                  setTab("Automations");
                  setAutomationMode("sending");
                  setVisited((current) =>
                    current.includes("Automations") ? current : [...current, "Automations"],
                  );
                }}
              >
                <Badge size="sm" tone={sendingMode.tone}>
                  {sendingMode.label}
                </Badge>
              </Button>
            ) : null}
            <HostStatus
              label={hostLabel}
              online={snapshot?.hostOnline ?? false}
              ready={!!snapshot?.hostOnline}
              updatedAt={updatedAt}
            />
            {refreshing && snapshot ? (
              <StatusBadge status="loading" label={t("Refreshing data")} />
            ) : null}
            {stale && snapshot ? (
              <StatusBadge status="warning" label={t("Showing latest data")} />
            ) : null}
          </div>
          <div className="social-header-actions">
            <Button
              ref={headerMenuRef}
              type="button"
              iconOnly
              size="sm"
              variant="ghost"
              label={t("More actions")}
              aria-expanded={headerMenuOpen}
              onClick={() => setHeaderMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="icon-md" />
            </Button>
            {headerMenuOpen ? (
              <Popover
                anchor={headerMenuRef}
                align="end"
                onDismiss={() => setHeaderMenuOpen(false)}
                className="social-header-menu"
              >
                {activeProject && !filter ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setFilter(activeProject);
                      setOffsets({});
                      setHeaderMenuOpen(false);
                    }}
                  >
                    {t("This project")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy || loading}
                  type="button"
                  onClick={() => {
                    openHistory();
                    setHeaderMenuOpen(false);
                  }}
                >
                  {t("Activity history")}
                </Button>
              </Popover>
            ) : null}
            <Button
              type="button"
              iconOnly
              size="sm"
              label={t("Refresh")}
              variant="ghost"
              loading={busy || refreshing}
              disabled={busy || refreshing || !machineId}
              title={refreshing ? t("Refreshing…") : t("Refresh")}
              data-refreshing={refreshing}
              onClick={() => {
                setNotice("");
                void refresh(machineId, true);
              }}
            >
              <RefreshCw className="icon-md" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              iconOnly
              size="sm"
              label={t("Close Social Media")}
              variant="ghost"
              title={t("Close Social Media")}
              onClick={onClose}
            >
              <X className="icon-md" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="social-section-picker">
          <Select
            label={t("Social Media sections")}
            value={tab}
            options={tabs.map((item) => ({ value: item, label: tabLabel(item) }))}
            onValueChange={(value) => {
              const next = tabs.find((item) => item === value);
              if (next) selectTab(next);
            }}
          />
        </div>
        <nav aria-label={t("Social Media sections")} className="social-tabs">
          {tabs.map((item) => {
            const Icon = tabIcons[item];
            return (
              <Button
                type="button"
                variant="tab"
                key={item}
                title={tabLabel(item)}
                aria-current={tab === item ? "page" : undefined}
                onClick={() => selectTab(item)}
              >
                <Icon className="social-nav-icon" aria-hidden="true" />
                <span className="social-nav-label">{tabLabel(item)}</span>
                {item !== "Settings" && scoped ? (
                  <span aria-hidden="true" className="social-nav-count">
                    {
                      {
                        Accounts: scoped.accounts.length,
                        Campaigns: scoped.pages?.campaigns?.total ?? scoped.campaigns.length,
                        Inbox: scoped.pages?.threads?.total ?? scoped.threads.length,
                        Audience: scoped.pages?.contacts?.total ?? scoped.contacts.length,
                        Automations:
                          (scoped.pages?.rules?.total ?? scoped.rules.length) +
                          (scoped.pages?.publishingPlans?.total ??
                            scoped.publishingPlans?.length ??
                            0),
                        Settings: 0,
                      }[item]
                    }
                  </span>
                ) : null}
              </Button>
            );
          })}
        </nav>
        {error || loadError ? (
          <div className="social-error social-feedback-bar">
            <Notice
              kind="error"
              title={
                error
                  ? t("Operation could not be completed")
                  : t("Connection could not be refreshed")
              }
            >
              {error || loadError}
            </Notice>
            <Button
              type="button"
              variant="secondary"
              loading={busy || (!error && refreshing)}
              disabled={busy || loading || (!error && refreshing)}
              onClick={() => {
                if (error) setError("");
                else if (machineId) void refresh(machineId, true);
                else setRetryKey((value) => value + 1);
              }}
            >
              {error ? t("Dismiss notice") : t("Try again")}
            </Button>
          </div>
        ) : null}
        <main className="social-main" aria-busy={loading || busy || refreshing}>
          {busy || notice ? (
            <div className="social-feedback-bar">
              <Notice
                kind={busy ? "loading" : stale ? "warning" : "success"}
                title={busy ? t("Operation in progress…") : notice}
              />
            </div>
          ) : null}
          {scoped ? (
            <WorkspacePagination
              snapshot={scoped}
              section={section}
              disabled={busy || refreshing}
              onPage={(collection, offset) =>
                setOffsets((previous) => ({ ...previous, [collection]: offset }))
              }
            />
          ) : null}
          {Array.from(hostWorkspaces.current.entries()).map(([id, host]) =>
            host.client && host.run ? (
              <RetainedSocialPanel
                key={id}
                active={id === machineId}
                busy={busy}
                error={error}
                notice={notice}
              >
                <WorkspacePanels
                  host={host}
                  active={id === machineId}
                  machines={machines}
                  cwd={cwd}
                  busy={busy}
                  error={error}
                  notice={notice}
                  onOpenHistory={openHistory}
                  onSelect={setMachineId}
                  onNavigate={(next) => {
                    if (next === "Automations") setAutomationMode("publish");
                    setTab(next);
                    setVisited((current) =>
                      current.includes(next) ? current : [...current, next],
                    );
                  }}
                  onAutomationMode={setAutomationMode}
                  onCollectionFilter={(targetSection, collection, next) => {
                    setCollectionFilters((previous) => ({
                      ...previous,
                      [targetSection]: { ...previous[targetSection], [collection]: next },
                    }));
                    setOffsets((previous) => ({ ...previous, [collection]: 0 }));
                  }}
                />
              </RetainedSocialPanel>
            ) : null,
          )}
          {!scoped || !hostWorkspaces.current.get(machineId)?.snapshots.has(section) ? (
            loading || refreshing || !!scoped ? (
              <div className="social-initial-loading">
                <Notice kind="loading" title={t("Loading Social Media workspace")} />
                <Skeleton className="social-skeleton" aria-hidden="true" />
                <Skeleton className="social-skeleton" aria-hidden="true" />
              </div>
            ) : (
              <Empty title={t("Host connection required")}>
                {t("Refresh the connection or choose a connected host.")}
              </Empty>
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
const sectionCollections: Record<Section, SocialCollection[]> = {
  accounts: [],
  campaigns: ["campaigns", "jobs"],
  inbox: ["threads", "drafts", "jobs"],
  audience: ["contacts", "threads", "drafts", "jobs"],
  plans: ["publishingPlans", "campaigns", "jobs"],
  rules: ["rules", "drafts", "jobs"],
  history: ["jobs"],
  sending: [],
  settings: [],
};
const collectionLabels = (): Record<SocialCollection, string> => ({
  campaigns: t("Campaigns"),
  publishingPlans: t("Sharing plans"),
  threads: t("Conversations"),
  contacts: t("Contacts"),
  rules: t("Reply rules"),
  jobs: t("Activity history"),
  drafts: t("Drafts"),
});
function WorkspacePagination({
  snapshot,
  section,
  disabled,
  onPage,
}: {
  snapshot: SocialSnapshot;
  section: Section;
  disabled: boolean;
  onPage: (collection: SocialCollection, offset: number) => void;
}) {
  useLocale();
  const labels = collectionLabels();
  return (
    <nav aria-label={t("Social Media data pages")} className="social-filter-tabs">
      {sectionCollections[section].map((collection) => {
        const page = snapshot.pages?.[collection];
        if (!page || (!page.offset && page.total <= page.limit)) return null;
        return (
          <div
            key={collection}
            role="group"
            aria-label={t("{p0} pages", { p0: labels[collection] })}
          >
            <span>
              {labels[collection]} · {page.total ? page.offset + 1 : 0}–
              {Math.min(page.offset + page.limit, page.total)} / {page.total}
            </span>
            <Button
              variant="secondary"
              type="button"
              disabled={disabled || page.offset === 0}
              onClick={() => onPage(collection, Math.max(0, page.offset - page.limit))}
            >
              {t("Previous page")}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={disabled || page.offset + page.limit >= page.total}
              onClick={() => onPage(collection, page.offset + page.limit)}
            >
              {t("Next page")}
            </Button>
          </div>
        );
      })}
    </nav>
  );
}
function WorkspacePanels({
  host,
  active,
  machines,
  cwd,
  busy,
  error,
  notice,
  onNavigate,
  onOpenHistory,
  onSelect,
  onAutomationMode,
  onCollectionFilter,
}: {
  host: HostWorkspaceState;
  active: boolean;
  machines: RemoteMachine[];
  cwd: string;
  busy: boolean;
  error: string;
  notice: string;
  onNavigate: (tab: Tab) => void;
  onOpenHistory: () => void;
  onSelect: (id: string) => void;
  onAutomationMode: (mode: string) => void;
  onCollectionFilter: (
    section: Section,
    collection: SocialCollection,
    filter: SocialCollectionFilter,
  ) => void;
}) {
  useLocale();
  const { tab, visited, filter, automationMode, projects } = host;
  const client = host.client!,
    run = host.run!;
  const initialProject =
    filter || projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
  const feedback = { busy, error, notice };
  const props = (section: Section): Props => ({
    client,
    run,
    projects,
    initialProject,
    snapshot: scopeSocialSnapshot(host.snapshots.get(section)!, filter)!,
    onFilterChange: (collection, next) => onCollectionFilter(section, collection, next),
  });
  const present = (tab: Tab, section: Section) =>
    visited.includes(tab) && host.snapshots.has(section);
  return (
    <fieldset disabled={busy} className="social-workspace social-workspace-root">
      {present("Accounts", "accounts") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Accounts"}>
          <Accounts {...props("accounts")} onOpenHistory={onOpenHistory} onNavigate={onNavigate} />
        </RetainedSocialPanel>
      ) : null}
      {present("Campaigns", "campaigns") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Campaigns"}>
          <Campaigns {...props("campaigns")} />
        </RetainedSocialPanel>
      ) : null}
      {present("Inbox", "inbox") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Inbox"}>
          <Inbox {...props("inbox")} />
        </RetainedSocialPanel>
      ) : null}
      {present("Audience", "audience") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Audience"}>
          <Audience {...props("audience")} />
        </RetainedSocialPanel>
      ) : null}
      {visited.includes("Automations") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Automations"}>
          <div
            className="social-filter-tabs social-automation-nav"
            role="group"
            aria-label={t("Automation type")}
          >
            {[
              ["publish", t("Sharing plans")],
              ["reply", t("Reply rules")],
              ["sending", t("Sending controls")],
              ["history", t("Activity history")],
            ].map(([value, label]) => (
              <Button
                variant="tab"
                type="button"
                key={value}
                aria-pressed={automationMode === value}
                onClick={() => onAutomationMode(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {host.snapshots.has("plans") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Automations" && automationMode === "publish"}
            >
              <PublishingPlans {...props("plans")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("rules") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Automations" && automationMode === "reply"}
            >
              <Rules {...props("rules")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("sending") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Automations" && automationMode === "sending"}
            >
              <SocialSendingControls {...props("sending")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("history") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Automations" && automationMode === "history"}
            >
              <SocialHistory {...props("history")} />
            </RetainedSocialPanel>
          ) : null}
        </RetainedSocialPanel>
      ) : null}
      {present("Settings", "settings") ? (
        <RetainedSocialPanel
          {...feedback}
          active={active && tab === "Settings"}
          className="social-settings-page"
        >
          <SocialPolicySettings
            client={client}
            policies={host.snapshots.get("settings")?.policies ?? DEFAULT_SOCIAL_POLICIES}
            run={run}
          />
          <SocialAuthority
            machines={machines}
            selectedHost={host.machineId}
            projects={projects}
            run={run}
            onSelect={onSelect}
          />
        </RetainedSocialPanel>
      ) : null}
    </fieldset>
  );
}
function Collapsible({
  collapsed,
  summary,
  children,
}: {
  collapsed: boolean;
  summary: string;
  children: ReactNode;
}) {
  return collapsed ? (
    <details className="social-form">
      <summary>{summary}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
function HostStatus({
  label,
  online,
  ready,
  updatedAt,
}: {
  label: string;
  online: boolean;
  ready: boolean;
  updatedAt: number;
}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="social-scheduling-help">
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <span className="social-status-dot" data-online={online} aria-hidden="true" />
        {ready ? null : <span className="social-host-label">{label}</span>}
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          align="end"
          width={320}
          role="dialog"
          aria-label={t("Scheduling status")}
          onDismiss={() => setOpen(false)}
          className="social-help-popover"
        >
          <strong>{label}</strong>
          {updatedAt ? (
            <p>
              {t("Last refresh {p0}", {
                p0: new Date(updatedAt).toLocaleTimeString(getLocale(), {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>
          ) : null}
          <strong>{t("How scheduling works")}</strong>
          <p>
            {t(
              "Scheduled jobs run while the selected computer is on and the bycoda service is connected. You can close this screen.",
            )}
          </p>
          <p>
            {t(
              "Publishing needs content approval or an active rule. Jobs wait while the computer is offline.",
            )}
          </p>
        </Popover>
      ) : null}
    </div>
  );
}

function Accounts({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onNavigate,
  onOpenHistory,
}: Props & { onNavigate?: (tab: Tab) => void; onOpenHistory?: () => void }) {
  useLocale();
  const [oauthOperations, setOAuthOperations] = useState<SocialOperation[]>(["publish"]);
  const [resourceId, setResourceId] = useState("");
  const [platform, setPlatform] = useState<SocialAccount["platform"]>("x");
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [selected, setSelected] = useState(() => snapshot.accounts[0]?.id ?? "");
  const [availabilityError, setAvailabilityError] = useState("");
  const [availability, setAvailability] = useState<
    Record<string, { configured: boolean; reason: string }>
  >({});
  const [browserAvailability, setBrowserAvailability] = useState<{
    available: boolean;
    reason: string;
  }>();
  const [browserRisk, setBrowserRisk] = useState(false);
  const [grantProject, setGrantProject] = useState(initialProject ?? projects[0]?.id ?? "");
  const [grantPermissions, setGrantPermissions] = useState<string[]>(
    () => snapshot.accounts[0]?.grants[initialProject ?? projects[0]?.id ?? ""] ?? [],
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const retainedGrantAccount = useRef(selected);
  const retainedBrowserAccount = useRef("");
  useEffect(() => {
    let alive = true;
    void client
      .oauthAvailability()
      .then((value) => {
        if (alive) {
          setAvailability(value);
          setAvailabilityError("");
        }
      })
      .catch(() => {
        if (alive)
          setAvailabilityError(t("Connection settings could not be read. Try again with Refresh."));
      });
    return () => {
      alive = false;
    };
  }, [client.oauthAvailability, snapshot.accounts]);
  const account = snapshot.accounts.find((item) => item.id === selected);
  useEffect(() => {
    if (retainedGrantAccount.current !== account?.id) {
      retainedGrantAccount.current = account?.id ?? "";
      if (account) setGrantPermissions(account.grants[grantProject] ?? []);
      setDisconnecting(false);
    }
  }, [account?.id]);
  const browserAccount = account?.platform === "x" ? account.id : "";
  const queryClient = useQueryClient();
  const scope = socialQueryScope(client);
  const active = useContext(SocialPanelActiveContext);
  const visible = useQueryVisible();
  const oauthKey = [...scope, "oauth", selected];
  const browserKey = [...scope, "browser", browserAccount];
  type OAuth = Awaited<ReturnType<SocialClient["oauthStatus"]>>;
  type Browser = Awaited<ReturnType<SocialClient["browserStatus"]>>;
  const oauthQuery = useQuery<OAuth | null>({
    queryKey: oauthKey,
    queryFn: async ({ signal }) => {
      try {
        const value = await client.oauthStatus(selected);
        signal.throwIfAborted();
        return value;
      } catch {
        signal.throwIfAborted();
        return {
          status: "failed",
          candidates: [],
          error: t("Connection status could not be read. Try again with Check connection."),
        };
      }
    },
    enabled:
      active && visible && !!selected && !!account && !TOKEN_PLATFORMS.includes(account.platform),
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 5_000 : false),
  });
  const browserQuery = useQuery<Browser | null>({
    queryKey: browserKey,
    queryFn: async ({ signal }) => {
      const value = await client.browserStatus(browserAccount);
      signal.throwIfAborted();
      return value;
    },
    enabled: active && visible && !!browserAccount,
    staleTime: 3_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 3_000 : false),
  });
  const oauth = oauthQuery.data ?? null;
  const browser = browserQuery.data ?? null;
  const setOAuth = (value: OAuth | null) => queryClient.setQueryData(oauthKey, value);
  const setBrowser = (value: Browser | null) => queryClient.setQueryData(browserKey, value);
  const connectedSeen = useRef("");
  useEffect(() => {
    const connected = oauth?.status === "connected" || browser?.status === "connected";
    const key = `${scope[1]}:${selected}`;
    if (connected && connectedSeen.current !== key) {
      connectedSeen.current = key;
      if (!account?.connected) void run(async () => undefined);
    } else if (!connected) connectedSeen.current = "";
  }, [oauth?.status, browser?.status, selected, account?.connected, scope[1], run]);
  useEffect(() => {
    if (retainedBrowserAccount.current !== browserAccount) {
      retainedBrowserAccount.current = browserAccount;
      setBrowserRisk(false);
    }
    if (!browserAccount || !active || !visible) return;
    let alive = true;
    void client
      .browserAvailability()
      .then((value) => alive && setBrowserAvailability(value))
      .catch(
        () =>
          alive &&
          setBrowserAvailability({
            available: false,
            reason: HOST_BROWSER_UNSUPPORTED,
          }),
      );
    return () => {
      alive = false;
    };
  }, [browserAccount, active, visible, client]);
  return (
    <div className="social-page social-accounts-page">
      <div className="social-section-heading">
        <h2>{t("Accounts")}</h2>
        <span className="social-muted">
          {snapshot.accounts.length === 1
            ? t("1 account")
            : t("{p0} accounts", { p0: snapshot.accounts.length })}
        </span>
      </div>
      <Composer title={t("Add account")}>
        <form
          onSubmit={(event) => {
            const form = event.currentTarget;
            const data = field(event);
            void run(async () => {
              const created = await client.request<SocialAccount>("accounts.create", {
                platform,
                name: data.get("name"),
                accountType: data.get("type"),
                projectIds: selectedProjects,
              });
              setSelected(created.id);
              setOAuth(null);
            }).then((success) => {
              if (success) {
                form.reset();
                closeComposer(form);
              }
            });
          }}
          className="social-form"
        >
          <label>
            {t("Platform")}
            <SearchableSelect
              label={t("Platform")}
              triggerProps={{ "aria-label": t("Platform") }}
              value={platform}
              onChange={(value) => setPlatform(value as SocialAccount["platform"])}
              options={SOCIAL_PLATFORMS.map((id) => ({ value: id, label: names[id] }))}
            />
          </label>
          <TextField label={t("Account name")} name="name" required maxLength={200} />
          <label>
            {t("Account type")}
            <NativeSelect name="type" key={platform}>
              {SOCIAL_ACCOUNT_TYPES[platform].map((id) => (
                <option key={id} value={id}>
                  {accountTypeLabel(id)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Projects
            projects={projects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <Button variant="primary" type="submit">
            {t("Add account")}
          </Button>
          {!selectedProjects.length ? (
            <small>
              {t("If you select a project, it gets read and draft permission on the account.")}
            </small>
          ) : null}
        </form>
      </Composer>
      <div
        className="social-columns social-account-workspace"
        data-single={snapshot.accounts.length <= 1}
      >
        <section hidden={snapshot.accounts.length <= 1}>
          <h2>{t("Connected accounts")}</h2>
          {!snapshot.accounts.length ? (
            <Empty title={t("Add your first account")} icon={Link}>
              {t("Start with Add account, then complete the platform connection.")}
            </Empty>
          ) : null}
          <div className="social-list">
            {snapshot.accounts.map((item) => (
              <Button
                type="button"
                variant="tab"
                className="social-row"
                aria-pressed={selected === item.id}
                key={item.id}
                onClick={() => {
                  setSelected(item.id);
                  setOAuthOperations(["publish"]);
                  setResourceId("");
                  setGrantPermissions(item.grants[grantProject] ?? []);
                  setOAuth(null);
                  setBrowser(null);
                }}
              >
                <strong>{item.name}</strong>
                <span>
                  {names[item.platform]} ·{" "}
                  {availabilityError
                    ? t("Connection check needed")
                    : accountConnectionStatus(
                        item,
                        availability[item.platform],
                        item.id === selected ? oauth?.status : undefined,
                      )}
                  {item.paused ? ` · ${t("Paused")}` : ""}
                </span>
              </Button>
            ))}
          </div>
        </section>
        <section className="social-account-detail">
          {account ? (
            <>
              <h2>{account.name}</h2>
              <div className="social-account-overview">
                <StatusBadge
                  status={
                    account.paused ? "paused" : account.connected ? "connected" : "disconnected"
                  }
                />
                <span>
                  {names[account.platform]} ·{" "}
                  {account.connection === "browser" ? t("Browser connection") : t("API connection")}
                </span>
                {account.connected && onNavigate ? (
                  <div className="social-actions">
                    <Button variant="primary" type="button" onClick={() => onNavigate("Campaigns")}>
                      {t("Prepare post")}
                    </Button>
                    <Button variant="secondary" type="button" onClick={onOpenHistory}>
                      {t("View history")}
                    </Button>
                  </div>
                ) : null}
              </div>
              {account.connected ? (
                <section className="social-account-capabilities">
                  <h3>{t("What you can do with this account")}</h3>
                  <div className="social-capability-grid">
                    {(snapshot.capabilities[account.id] ?? [])
                      .filter((cap) =>
                        ["publish", "reply", "inbox.read", "message.start"].includes(cap.operation),
                      )
                      .map((cap) => (
                        <div key={cap.operation}>
                          <span>{operations[cap.operation]}</span>
                          <StatusBadge status={cap.status} />
                        </div>
                      ))}
                  </div>
                  {account.connection === "browser" ? (
                    <p className="social-muted">
                      {t(
                        "Posting and replying to posts are supported. Mentions and legacy web messaging are followed through recognized reply formats; encrypted Chat is not supported.",
                      )}
                    </p>
                  ) : null}
                </section>
              ) : null}
              <SocialBrowserWorkspace key={account.id} account={account} client={client} />
              {account.platform === "x" ? (
                <details className="social-connection" open={!account.connected || undefined}>
                  <summary>{t("Manage browser connection")}</summary>
                  <strong>
                    {account.connected && account.connection === "browser"
                      ? t("X account connected")
                      : t("Connect your X account")}
                  </strong>
                  <details>
                    <summary>{t("How the browser connection works")}</summary>
                    <p>
                      {t(
                        "Because the X API is paid, you can connect the account with your own X session. A separate Edge/Chrome window opens on the selected host; you sign in to X there yourself and close the window. Your password is never entered into bycoda. Approved posts are shared in the background with this session. Only post/image sharing and replies to a post ID are supported. Mentions and legacy web messaging are read through recognized reply formats; encrypted Chat is not supported. Continuous publishing and replies depend on an active publishing program and automation rules.",
                      )}
                    </p>
                  </details>
                  <Notice kind="warning" title={t("Risk confirmation for browser connection")}>
                    {t(
                      "This method is unofficial. If X detects automation, it may restrict or suspend the account.",
                    )}
                  </Notice>
                  <label className="social-inline-check">
                    <Checkbox
                      checked={browserRisk}
                      onChange={(event) => setBrowserRisk(event.target.checked)}
                    />
                    {t("I understand the risk; use the browser session for this account")}
                  </label>
                  {browserAvailability && !browserAvailability.available ? (
                    <p>
                      {browserAvailability.reason === HOST_BROWSER_UNSUPPORTED
                        ? t(
                            "The selected host does not support browser-session connections. Update the Host and press Refresh.",
                          )
                        : t("Microsoft Edge or Google Chrome was not found on the selected host.")}
                    </p>
                  ) : null}
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={
                        !browserRisk ||
                        !browserAvailability?.available ||
                        browser?.status === "waiting"
                      }
                      onClick={() =>
                        void run(async () => {
                          await queryClient.cancelQueries({ queryKey: browserKey });
                          const status = await client.browserBegin(account.id);
                          await queryClient.cancelQueries({ queryKey: browserKey });
                          setBrowser(status);
                        })
                      }
                    >
                      {account.connected && account.connection === "browser"
                        ? t("Sign in again in the browser")
                        : t("Sign in to X in the browser")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void run(async () => {
                          setBrowserAvailability(await client.browserAvailability());
                          setBrowser(await client.browserStatus(account.id));
                        })
                      }
                    >
                      {t("Check browser connection")}
                    </Button>
                  </div>
                  {browser && browser.status !== "idle" ? (
                    <p role="status">
                      {browser.error ||
                        (
                          {
                            waiting: t(
                              "Sign in to X in the Chrome window that opened (Google sign-in works too). Close the window yourself when you are done; bycoda then checks the session.",
                            ),
                            connected: t("X account connected with the browser session."),
                            failed: t("Connection failed"),
                          } as Record<string, string>
                        )[browser.status]}
                    </p>
                  ) : null}
                </details>
              ) : null}
              {TOKEN_PLATFORMS.includes(account.platform) ? (
                <div className="social-connection">
                  <strong>
                    {availabilityError ||
                      accountConnectionStatus(account, availability[account.platform])}
                  </strong>
                  <p>
                    {account.platform === "telegram"
                      ? t(
                          "Read and reply to text messages with a bot account. Reading is off when a webhook already exists; bycoda does not delete other apps' webhooks.",
                        )
                      : t(
                          "Reply to incoming text messages with a WhatsApp Business account within the 24-hour reply window. Personal accounts, template messages and bulk first messages are not supported.",
                        )}
                  </p>
                  <details>
                    <summary>{t("Host connection settings")}</summary>
                    <p>
                      {t(
                        "Add the keys to the environment settings of the selected host service. The connect button verifies the account identity on the platform.",
                      )}
                    </p>
                    <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_TOKEN</code>
                    <br />
                    <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_APPROVED=1</code>
                    {account.platform === "whatsapp" ? (
                      <>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID</code>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_CLIENT_SECRET</code>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>
                        <p>
                          {t(
                            "Meta webhook address: /social/webhooks/whatsapp. Subscribe to the messages field on the business account.",
                          )}
                        </p>
                      </>
                    ) : null}
                  </details>
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!availability[account.platform]?.configured || !!availabilityError}
                      onClick={() =>
                        void run(async () => {
                          await client.tokenConnect(account.id);
                        })
                      }
                    >
                      {account.connected ? t("Reconnect host account") : t("Connect host account")}
                    </Button>
                  </div>
                </div>
              ) : account.platform === "x" &&
                account.connected &&
                account.connection === "browser" ? null : (
                <Collapsible
                  collapsed={account.platform === "x"}
                  summary={t("Connect with the official X API (requires a paid developer app)")}
                >
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? (
                    <p role="note">
                      {t(
                        "This connection verifies the profile identity and lets you prepare drafts. Publishing, comments and inbox operations are not supported yet.",
                      )}
                    </p>
                  ) : null}
                  <div className="social-connection" role="status">
                    <strong>
                      {availabilityError
                        ? t("Connection check needed")
                        : accountConnectionStatus(
                            account,
                            availability[account.platform],
                            oauth?.status,
                          )}
                    </strong>
                    <p>
                      {availabilityError ||
                        (availability[account.platform] === undefined
                          ? t("Checking platform connection settings…")
                          : !availability[account.platform].configured
                            ? t(
                                "{p0} connection is not ready. Configure the platform app and its redirect address on the selected host.",
                                { p0: names[account.platform] },
                              )
                            : !account.connected && oauth?.status === "waiting"
                              ? t(
                                  "Sign in to your account and grant permission on the platform page that opened. The result is checked here automatically. If the page did not open, try again with Connect in browser.",
                                )
                              : !account.connected && oauth?.status === "selection"
                                ? t(
                                    "The platform verified your account. Choose the account you want to connect from the list below.",
                                  )
                                : account.connected &&
                                    account.expiresAt &&
                                    account.expiresAt < Date.now()
                                  ? t(
                                      "The connection expired. Grant permission to your account again with Reconnect in browser.",
                                    )
                                  : account.connected
                                    ? t(
                                        "Account connected. Manage operations and project permissions below.",
                                      )
                                    : t(
                                        "Select permissions and press Connect in browser. Sign in to your account and grant permission on the platform page that opens; the result is checked here automatically.",
                                      ))}
                    </p>
                    {availability[account.platform]?.configured === false ? (
                      <details>
                        <summary>{t("Setup requirements")}</summary>
                        <p>
                          {t(
                            "These settings are not your social account password. Details from the platform developer app are added to the selected host service; do not enter secret keys here.",
                          )}
                        </p>
                        <ul>
                          <li>{t("App Client ID")}</li>
                          <li>
                            {account.platform === "x"
                              ? t(
                                  "Client Secret for apps that use a secret (optional for public PKCE)",
                                )
                              : t("App Client Secret")}
                          </li>
                          <li>
                            {t(
                              "Redirect address registered on the platform and reachable by the host",
                            )}
                          </li>
                        </ul>
                        <p>
                          {t(
                            "The host service environment settings use the names below. The settings cannot be edited in the app yet; add them through the host setup.",
                          )}
                        </p>
                        <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_CLIENT_ID</code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _CLIENT_SECRET
                        </code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _REDIRECT_URI
                        </code>
                        <p>
                          {t("Redirect address path on the host:")}{" "}
                          <code>/social/oauth/{account.platform}/callback</code>.{" "}
                          {t("The same address must also be registered in the platform app.")}
                        </p>
                        <p>{t("After updating the host settings, press Refresh.")}</p>
                      </details>
                    ) : null}
                  </div>
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? null : (
                    <fieldset className="social-checks">
                      <legend>{t("Capabilities requested through OAuth")}</legend>
                      {(snapshot.capabilities[account.id] ?? [])
                        .filter((capability) => capability.status !== "unsupported")
                        .map((capability) => (
                          <label key={capability.operation}>
                            <Checkbox
                              checked={oauthOperations.includes(capability.operation)}
                              onChange={(event) =>
                                setOAuthOperations((current) =>
                                  event.target.checked
                                    ? [...current, capability.operation]
                                    : current.filter((item) => item !== capability.operation),
                                )
                              }
                            />
                            {operations[capability.operation]}
                          </label>
                        ))}
                    </fieldset>
                  )}
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? null : (
                    <p>
                      {t(
                        "Only the permissions of the selected API products are requested. Platform approval and webhook subscription are required separately.",
                      )}
                    </p>
                  )}
                  {account.accountType === "organization" ? (
                    <TextField
                      label={t("LinkedIn organization ID")}
                      inputMode="numeric"
                      value={resourceId}
                      onChange={(event) => setResourceId(event.target.value)}
                    />
                  ) : null}
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={
                        (!oauthOperations.length &&
                          !PROFILE_ONLY_PLATFORMS.includes(account.platform)) ||
                        !!availabilityError ||
                        !availability[account.platform]?.configured ||
                        (account.accountType === "organization" && !/^\d+$/.test(resourceId))
                      }
                      onClick={() =>
                        void run(async () => {
                          await queryClient.cancelQueries({ queryKey: oauthKey });
                          const begin = await client.oauthBegin(
                            account.id,
                            account.accountType === "organization" ? resourceId : undefined,
                            oauthOperations,
                          );
                          // A waiting poll may have started while begin was in flight.
                          await queryClient.cancelQueries({ queryKey: oauthKey });
                          setOAuth({ status: "waiting", candidates: [] });
                          await openUrl(begin.url);
                        })
                      }
                    >
                      {account.connected ? t("Reconnect in browser") : t("Connect in browser")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void run(async () => setOAuth(await client.oauthStatus(account.id)))
                      }
                    >
                      {t("Check connection")}
                    </Button>
                  </div>
                  {oauth && availability[account.platform]?.configured ? (
                    <div className="social-connection" role="status">
                      <p>
                        {oauth.error ||
                          (
                            {
                              idle: t(
                                "Connection not started. If platform setup is complete, start with Connect in browser.",
                              ),
                              waiting: t(
                                "Waiting for account permission in the browser. Grant permission on the platform page that opened. If the page did not open, try again with Connect in browser.",
                              ),
                              selection: t("Choose the verified account"),
                              connected: t("Account connected"),
                              failed: t("Connection failed"),
                            } as Record<string, string>
                          )[oauth.status]}
                      </p>
                      {(oauth.candidates ?? []).map((candidate) => (
                        <Button
                          type="button"
                          variant="secondary"
                          key={candidate.id}
                          onClick={() =>
                            void run(async () => {
                              await client.oauthSelect(account.id, candidate.id);
                              await queryClient.invalidateQueries({ queryKey: oauthKey });
                            })
                          }
                        >
                          {t("{p0} · Connect", { p0: candidate.name })}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </Collapsible>
              )}
              <div className="social-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void run(() =>
                      client.request("accounts.pause", {
                        accountId: account.id,
                        paused: !account.paused,
                      }),
                    )
                  }
                >
                  {account.paused ? t("Resume account") : t("Pause account")}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="ml-auto"
                  disabled={!account.connected}
                  onClick={() => setDisconnecting(true)}
                >
                  {t("Remove connection")}
                </Button>
              </div>
              {disconnecting ? (
                <div
                  className="social-confirm"
                  role="group"
                  aria-label={t("Disconnect confirmation")}
                >
                  <p>
                    {t("{p0} will be disconnected and sending from this account will stop.", {
                      p0: account.name,
                    })}
                  </p>
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() =>
                        void (async () => {
                          if (
                            await run(() =>
                              client.request("accounts.disconnect", {
                                accountId: account.id,
                              }),
                            )
                          )
                            setDisconnecting(false);
                        })()
                      }
                    >
                      {t("Confirm disconnect")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDisconnecting(false)}
                    >
                      {t("Cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <details className="social-form">
                <summary>{t("Supported operations")}</summary>
                <p className="social-muted">
                  {account.executorId === snapshot.executorId
                    ? t("This account is connected on the selected computer.")
                    : t("This account is connected on another computer.")}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>{t("Operation")}</th>
                      <th>{t("Status / reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.capabilities[account.id]?.map((cap) => (
                      <tr key={cap.operation}>
                        <td>{operations[cap.operation]}</td>
                        <td>
                          <StatusBadge status={cap.status} />
                          <details>
                            <summary>{t("Details")}</summary>
                            <p>{cap.reason}</p>
                            <a href={cap.source} target="_blank" rel="noreferrer">
                              {t("Official documentation")}
                            </a>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <details className="social-form social-account-permissions" open>
                <summary>{t("Project access")}</summary>
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    field(event);
                    void run(() =>
                      client.request("accounts.grants", {
                        accountId: account.id,
                        projectId: grantProject,
                        permissions: grantPermissions,
                      }),
                    );
                  }}
                >
                  <label>
                    {t("Project")}
                    <SearchableSelect
                      value={grantProject}
                      label={t("Project")}
                      options={projects.map((project) => ({
                        value: project.id,
                        label: project.name,
                      }))}
                      onChange={(nextValue) => {
                        setGrantProject(nextValue);
                        setGrantPermissions(account.grants[nextValue] ?? []);
                      }}
                      searchLocale={getLocale()}
                    />
                  </label>
                  <fieldset className="social-checks">
                    <legend>{t("Reading and sending are separate permissions")}</legend>
                    {[
                      ["read", t("Can read")],
                      ["draft", t("Prepare drafts")],
                      ["publish", t("Publish")],
                      ["reply", t("Can reply")],
                      ["message", t("New message")],
                      ["comment", t("Post a comment")],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <Checkbox
                          checked={grantPermissions.includes(id)}
                          onChange={(event) =>
                            setGrantPermissions(
                              event.target.checked
                                ? [...grantPermissions, id]
                                : grantPermissions.filter((item) => item !== id),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <Button type="submit" variant="secondary" disabled={!grantProject}>
                    {t("Save permissions")}
                  </Button>
                  <p className="social-muted">
                    {t("Current permissions:")}{" "}
                    {Object.entries(account.grants)
                      .map(
                        ([id, allowed]) =>
                          `${projects.find((item) => item.id === id)?.name ?? id}: ${allowed.map((permission) => permissionLabels()[permission] ?? permission).join(", ") || t("none")}`,
                      )
                      .join("; ")}
                  </p>
                </form>
              </details>
            </>
          ) : (
            <Empty
              title={
                snapshot.accounts.length ? t("Manage your account") : t("Add your first account")
              }
              icon={Link}
            >
              {snapshot.accounts.length
                ? t("Select an account to see its connection status and project access.")
                : t("Start with Add account, then complete the platform connection.")}
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}

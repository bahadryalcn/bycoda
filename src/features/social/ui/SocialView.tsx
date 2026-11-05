import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { Select } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { Accounts } from "./SocialAccounts";
import { Campaigns } from "./SocialCampaigns";
import { Audience, Rules } from "./SocialManagement";
import { Inbox } from "./SocialInbox";
import { PublishingPlans } from "./SocialPublishingPlans";
import { Popover } from "../../../shared/ui/Popover";
import { SocialHistory } from "./SocialHistory";
import { WorkspaceContinuation } from "./WorkspaceContinuation";
import { SocialSendingControls } from "./SocialSendingControls";
import { RetainedSocialPanel } from "./RetainedSocialPanel";
import { Empty, Notice, StatusBadge, type Props } from "./socialShared";
import { useRef, useState } from "react";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { pathKey } from "../../../shared/lib/paths";
import { type SocialCollection, type SocialCollectionFilter } from "../model/social";
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
  Home,
  Inbox as InboxIcon,
  MessageMultiple,
  Zap,
  Settings,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SocialAuthority } from "./SocialAuthority";
import { SocialPolicySettings } from "./SocialPolicySettings";
import { SocialToday } from "./SocialToday";
import type { AttentionTarget } from "../model/socialAttention";
import { DEFAULT_SOCIAL_POLICIES } from "../model/socialPolicy";
import { scopeSocialSnapshot } from "../model/socialWorkspace";
import {
  useSocialWorkspaceController,
  type HostWorkspaceState,
  type Section,
  type Tab,
} from "./useSocialWorkspaceController";

const tabs: Tab[] = [
  "Today",
  "Campaigns",
  "Inbox",
  "Automations",
  "Audience",
  "Activity",
  "Accounts",
  "Settings",
];
function tabLabel(tab: Tab) {
  return {
    Today: t("Today"),
    Accounts: t("Accounts"),
    Campaigns: t("Prepare content"),
    Inbox: t("Inbox"),
    Audience: t("Audience"),
    Automations: t("Plans and replies"),
    Activity: t("Activity"),
    Settings: t("Settings"),
  }[tab];
}
const tabIcons = {
  Today: Home,
  Accounts: Link,
  Campaigns: Share,
  Inbox: InboxIcon,
  Audience: MessageMultiple,
  Automations: Zap,
  Activity: RefreshCw,
  Settings: Settings,
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
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const {
    machines,
    machineId,
    snapshot,
    scoped,
    projects,
    section,
    tab,
    filter,
    status: { loading, refreshing, stale, busy, error, loadError, notice, updatedAt },
    hosts,
    sectionLoaded,
    actions,
  } = useSocialWorkspaceController({ rootRef: root });
  const activeProject = projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
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
      <PaneHeader
        dragRegion
        chromeInset={!besideRail ? true : compactRail ? "compact" : false}
        className="select-none"
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        trailing={IS_MAC ? null : <WindowControls />}
      >
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
            <Globe className="icon-sm text-(--ui-text-secondary)" aria-hidden />
            <span>{t("Social Media")}</span>
          </div>
        </ToolHeader>
      </PaneHeader>
      <div className="social-layout">
        <header className="social-header">
          <div className="social-heading">
            <h1 id="social-title" className="social-sr-only">
              {tabLabel(tab)}
            </h1>
          </div>
          <div className="social-header-controls">
            <div className="social-header-field" data-single={machines.length <= 1 || undefined}>
              <span>{t("Computer")}</span>
              {machines.length <= 1 ? (
                <strong className="social-header-value">
                  {machines[0] && !isLocalSyncMachine(machines[0])
                    ? machines[0].name
                    : t("This computer")}
                </strong>
              ) : (
                <SearchableSelect
                  value={machineId}
                  disabled={socialLocked || busy}
                  label={t("Authoritative host")}
                  searchable={machines.length > 5}
                  searchPlaceholder={t("Search computers…")}
                  options={machines.map((machine) => ({
                    value: machine.id,
                    label: isLocalSyncMachine(machine) ? t("This computer") : machine.name,
                  }))}
                  onChange={actions.selectMachine}
                  searchLocale={getLocale()}
                />
              )}
            </div>
            <div className="social-header-field social-project-filter">
              <span>{t("Project filter")}</span>
              <SearchableSelect
                label={t("Project filter")}
                value={filter}
                onChange={actions.setProjectFilter}
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
                disabled={socialLocked || busy}
              />
            </div>
          </div>
          <div className="social-host-status" role="status">
            {snapshot ? (
              <Button
                disabled={socialLocked}
                variant="ghost"
                type="button"
                size="sm"
                aria-label={t("Sending controls: {p0}", { p0: sendingMode.label })}
                tooltip={t("Sending controls")}
                onClick={actions.openSending}
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
              disabled={socialLocked}
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
                    disabled={socialLocked || busy}
                    onClick={() => {
                      actions.setProjectFilter(activeProject);
                      setHeaderMenuOpen(false);
                    }}
                  >
                    {t("This project")}
                  </Button>
                ) : null}
                <Button
                  disabled={socialLocked}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    actions.openHistory();
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
              loading={!busy && refreshing}
              disabled={socialLocked || busy || refreshing || !machineId}
              tooltip={refreshing ? t("Refreshing…") : t("Refresh")}
              data-refreshing={refreshing}
              onClick={actions.refreshNow}
            >
              <RefreshCw className="icon-md" aria-hidden="true" />
            </Button>
            <Button
              disabled={socialLocked}
              type="button"
              iconOnly
              size="sm"
              label={t("Close Social Media")}
              variant="ghost"
              onClick={onClose}
            >
              <X className="icon-md" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="social-section-picker">
          <Select
            disabled={socialLocked}
            label={t("Social Media sections")}
            value={tab}
            options={tabs.map((item) => ({ value: item, label: tabLabel(item) }))}
            onValueChange={(value) => {
              const next = tabs.find((item) => item === value);
              if (next) actions.selectTab(next);
            }}
          />
        </div>
        <nav aria-label={t("Social Media sections")} className="social-tabs">
          {tabs.map((item) => {
            const Icon = tabIcons[item];
            return (
              <Button
                disabled={socialLocked}
                type="button"
                variant="tab"
                key={item}
                aria-current={tab === item ? "page" : undefined}
                onClick={() => actions.selectTab(item)}
              >
                <Icon className="social-nav-icon" aria-hidden="true" />
                <span className="social-nav-label">{tabLabel(item)}</span>
                {item !== "Settings" && item !== "Today" && scoped
                  ? (() => {
                      const count = {
                        Activity: scoped.pages?.jobs?.total ?? scoped.jobs.length,
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
                        Today: 0,
                      }[item];
                      return count ? (
                        <span aria-hidden="true" className="social-nav-count">
                          {count}
                        </span>
                      ) : null;
                    })()
                  : null}
              </Button>
            );
          })}
        </nav>
        {error || (loadError && !scoped) ? (
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
              loading={!busy && !error && refreshing}
              disabled={socialLocked || busy || loading || (!error && refreshing)}
              onClick={actions.retry}
            >
              {error ? t("Dismiss notice") : t("Try again")}
            </Button>
          </div>
        ) : null}
        <main className="social-main" aria-busy={loading || busy || refreshing}>
          {notice ? (
            <div className="social-feedback-bar">
              <Notice kind={stale ? "warning" : "success"} title={notice} />
            </div>
          ) : null}
          {hosts.map(([id, host]) =>
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
                  loadError={loadError}
                  notice={notice}
                  onOpenHistory={actions.openHistory}
                  onOpenSending={actions.openSending}
                  onSelect={actions.selectMachine}
                  onNavigate={actions.navigate}
                  onAutomationMode={actions.setAutomationMode}
                  onCollectionFilter={actions.setCollectionFilter}
                  onLoadJobsPage={() => {
                    const page = host.snapshots.get("history")?.pages?.jobs;
                    if (page && page.offset + page.limit < page.total)
                      actions.setPage("jobs", page.offset + page.limit);
                  }}
                />
              </RetainedSocialPanel>
            ) : null,
          )}
          {loadError && scoped ? (
            <div className="social-feedback-bar">
              <Notice kind="error" title={t("Connection could not be refreshed")}>
                {loadError}
              </Notice>
              <Button
                type="button"
                variant="secondary"
                loading={refreshing}
                disabled={socialLocked || busy || refreshing}
                onClick={actions.retry}
              >
                {t("Try again")}
              </Button>
            </div>
          ) : null}
          {scoped ? (
            <WorkspaceContinuation
              snapshot={scoped}
              section={section}
              disabled={busy || refreshing}
              onPage={actions.setPage}
            />
          ) : null}
          {!sectionLoaded ? (
            loading || refreshing || !!scoped ? (
              <div className="social-initial-loading">
                <LoadingText>{t("Loading Social Media workspace")}</LoadingText>
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
function WorkspacePanels({
  host,
  active,
  machines,
  cwd,
  busy,
  error,
  loadError,
  notice,
  onNavigate,
  onOpenHistory,
  onOpenSending,
  onSelect,
  onAutomationMode,
  onCollectionFilter,
  onLoadJobsPage,
}: {
  host: HostWorkspaceState;
  active: boolean;
  machines: RemoteMachine[];
  cwd: string;
  busy: boolean;
  error: string;
  loadError: string;
  notice: string;
  onNavigate: (tab: Tab) => void;
  onOpenHistory: () => void;
  onOpenSending: () => void;
  onSelect: (id: string) => void;
  onAutomationMode: (mode: string) => void;
  onCollectionFilter: (
    section: Section,
    collection: SocialCollection,
    filter: SocialCollectionFilter,
  ) => void;
  onLoadJobsPage: () => void;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const { tab, visited, filter, automationMode, projects } = host;
  const client = host.client!,
    run = host.run!;
  const initialProject =
    filter || projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
  const intentSequence = useRef(0);
  const [contentIntent, setContentIntent] = useState<{ accountId: string; token: number }>();
  const [historyIntent, setHistoryIntent] = useState<{ accountId: string; token: number }>();
  const [projectIntent, setProjectIntent] = useState<{ projectId: string; token: number }>();
  const hostMachine = machines.find((machine) => machine.id === host.machineId);
  const executorLabel = hostMachine?.name ?? host.machineId;
  const machineLabel =
    hostMachine && isLocalSyncMachine(hostMachine) ? t("This computer") : executorLabel;
  const [programIntent, setProgramIntent] = useState<{ id: string; token: number }>();
  const feedback = { busy, error, notice };
  const props = (section: Section): Props => ({
    client,
    run,
    projects,
    initialProject,
    onOpenContent: (projectId) => {
      if (projectId) setProjectIntent({ projectId, token: ++intentSequence.current });
      onNavigate("Campaigns");
    },
    onOpenSettings: () => onNavigate("Settings"),
    snapshot: scopeSocialSnapshot(host.snapshots.get(section)!, filter)!,
    onFilterChange: (collection, next) => onCollectionFilter(section, collection, next),
  });
  const present = (tab: Tab, section: Section) =>
    visited.includes(tab) && host.snapshots.has(section);
  return (
    <fieldset className="social-workspace social-workspace-root">
      {present("Today", "accounts") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Today"}>
          <SocialToday
            client={client}
            run={run}
            projects={projects}
            projectFilter={filter}
            machineLabel={machineLabel}
            snapshot={scopeSocialSnapshot(host.snapshots.get("accounts")!, filter)!}
            onNavigate={(target: AttentionTarget | "Audience") =>
              target === "Sending" ? onOpenSending() : onNavigate(target)
            }
            onOpenProgram={(id) => {
              setProgramIntent({ id, token: ++intentSequence.current });
              onNavigate("Campaigns");
            }}
          />
        </RetainedSocialPanel>
      ) : null}
      {present("Accounts", "accounts") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Accounts"}>
          <Accounts
            {...props("accounts")}
            onPrepare={(accountId) => {
              setContentIntent({ accountId, token: ++intentSequence.current });
              onNavigate("Campaigns");
            }}
            onOpenHistory={(accountId) => {
              if (accountId) setHistoryIntent({ accountId, token: ++intentSequence.current });
              onOpenHistory();
            }}
          />
        </RetainedSocialPanel>
      ) : null}
      {present("Campaigns", "campaigns") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Campaigns"}>
          <Campaigns
            {...props("campaigns")}
            accountIntent={contentIntent}
            projectIntent={projectIntent}
            programIntent={programIntent}
            machineLabel={machineLabel}
            onOpenSettings={() => onNavigate("Settings")}
          />
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
            ].map(([value, label]) => (
              <Button
                disabled={socialLocked}
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
              <PublishingPlans {...props("plans")} onOpenAccounts={() => onNavigate("Accounts")} />
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
              <SocialSendingControls {...props("sending")} executorLabel={executorLabel} />
            </RetainedSocialPanel>
          ) : null}
        </RetainedSocialPanel>
      ) : null}
      {(visited.includes("Activity") || visited.includes("Automations")) &&
      host.snapshots.has("history") ? (
        <RetainedSocialPanel
          {...feedback}
          active={
            active &&
            (tab === "Activity" || (tab === "Automations" && automationMode === "history"))
          }
        >
          <SocialHistory
            {...props("history")}
            accountIntent={historyIntent}
            onLoadMore={onLoadJobsPage}
            loadingMore={busy || !active}
            loadError={loadError}
          />
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
            executorLabel={executorLabel}
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
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="social-scheduling-help" data-ready={ready || undefined}>
      <Button
        disabled={socialLocked}
        ref={trigger}
        variant="ghost"
        size="sm"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <StatusDot size="compact" tone={online ? "success" : "secondary"} preserveColors />
        <span className="social-host-label">{label}</span>
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

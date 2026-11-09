import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { Button } from "../../../shared/ui/Button";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { CrewsSettings } from "../../crews/ui/CrewsSettings";
import { t, useLocale } from "../../../shared/i18n";
import { ConnectionsSettings } from "../../connections/public/ConnectionsSettings";
import { ArrowLeft, Maximize2, Minimize2, RotateCcw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import "./BycodaSettings.css";
import { AccountScreen } from "../../account";
import { SettingsAccountRow, accountRowId, navigationGroups } from "./SettingsAccountRow";
import { SecretsSettings } from "../../secrets";
import { McpSettings } from "./McpSettings";
import { GroupLockSettings } from "../../group-lock/ui/GroupLockSettings";
import { WindowControls } from "../../../app/shell/WindowControls";
import { SETTINGS_SECTION_ICONS } from "../../../app/shell/SettingsRail";
import { SidebarUpdateFooter } from "../../../app/shell/SidebarUpdate";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { IS_MAC } from "../../../platform/tauri/platform";
import { type RecentProject } from "../../projects";
import type { SessionSummary, Session } from "../../sessions";
import {
  AUTOMATIC_SAVE_SECTIONS,
  settingsSectionsByGroup,
  settingsSectionDescription,
  settingsSectionLabel,
  type CollapsedProjectRailMode,
  type SettingsSectionId,
} from "../model/settings";
import { SkillsPage } from "../../skills/ui/SkillsPage";
import { WorktreesPage } from "../../source-control/public/WorktreesPage";
import { removeWorktree, type RemoveWorktree } from "../../source-control/public/worktrees";
import {
  settingDomId,
  RevealedSetting,
  PageAutomaticSaveHint,
  SettingsPageResetRegistry,
  type SettingsPageResetRegistration,
  SettingsPageHelp,
  Group,
  Row,
  Toggle,
  Select,
} from "./settingsControls";
import { SettingsSearch } from "./SettingsSearch";
import { GeneralPage } from "./GeneralSettings";
import { PoliciesSettings } from "./PoliciesSettings";
import { NotificationAlerts } from "./NotificationsSettings";
import { ProjectNotificationSettings } from "../../notifications/ui/ProjectNotificationSettings";
import { WorkspacePage } from "./WorkspaceSettings";
import { WorkspaceEditorSettings } from "./WorkspaceEditorSettings";
import { PrivacyStartupSettings } from "./PrivacyStartupSettings";
import { SourceControlSettings } from "./SourceControlSettings";
import { ChatPage, VoicePage } from "./ChatSettings";
import { IntegrationsPage } from "./integrations/IntegrationsSettings";
import { AppearanceSaveFeedback, useAppearanceSettings } from "./useAppearanceSettings";
import { AppearancePage } from "./AppearanceSettings";
import { KeybindingsPage } from "./ShortcutSettings";
import { TerminalPage } from "./TerminalSettings";
import { ProvidersPageGate } from "./ProvidersPageGate";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { ArchivePage } from "./ArchiveSettings";
import { SettingsPageLoading } from "./SettingsPageLoading";

const UsagePage = lazySurface(
  async () => ({ default: (await import("./UsageSettingsPage")).UsageSettingsPage }),
  { fallback: <SettingsPageLoading lines={8} /> },
);

/**
 * The `data-setting-id` Settings should reveal when it opens: one of the ids in
 * `SETTINGS_INDEX`. Integrations pass their provider id.
 */
export type SettingsAnchor = string;

type Props = {
  section: SettingsSectionId;
  /** Card to scroll to; the General page is too long to land at the top. */
  anchor?: SettingsAnchor | null;
  /** Project to focus when opening notification settings from a quick action. */
  notificationProjectPath?: string | null;
  /** Changes for each quick action, including repeated requests for one project. */
  notificationSettingsRequest?: number;
  recents?: RecentProject[];
  cwd: string;
  sessions: SessionSummary[];
  liveSessions?: Session[];
  onRemoveWorktree?: RemoveWorktree;
  onCheckWorktreeRemoval?: RemoveWorktree;
  onDeleteWorktreeSessions?: (sessionIds: readonly string[]) => Promise<boolean>;
  besideRail?: boolean;
  /**
   * Rendered inside an overlay that owns the window chrome: no duplicate titlebar or native
   * window controls, and the overlay owns Escape, the close action and focus return.
   */
  embedded?: boolean;
  /** Current overlay geometry. Presentation changes restyle this tree; they never remount it. */
  maximized?: boolean;
  /** Shows a maximize/restore action in the page header when the host can resize the surface. */
  onToggleMaximize?: () => void;
  headerAction?: React.ReactNode;
  onClose: () => void;
  /** Lets search jump to a setting that lives on another page. */
  onSelectSection?: (section: SettingsSectionId) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenBackgroundSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  /** Whether `sessions` is complete; Archive must not read loading or failed history as empty. */
  sessionsStatus?: ComponentProps<typeof ArchivePage>["sessionsStatus"];
  onRestoreProject?: (path: string) => void | Promise<void>;
  onDeleteProject?: (path: string) => void | Promise<void>;
  onOpenWhatsNew: (version: string) => void;
  collapsedProjectRailMode?: CollapsedProjectRailMode;
  onCollapsedProjectRailModeChange?: (mode: CollapsedProjectRailMode) => void;
};

export function SettingsView({
  section,
  anchor = null,
  notificationProjectPath = null,
  notificationSettingsRequest = 0,
  recents,
  cwd,
  sessions,
  liveSessions,
  onRemoveWorktree = removeWorktree,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  besideRail = false,
  embedded = false,
  maximized = false,
  onToggleMaximize,
  headerAction,
  onClose,
  onSelectSection,
  onOpenSession,
  onOpenBackgroundSession,
  onArchiveSession,
  onDeleteSession,
  sessionsStatus,
  onRestoreProject,
  onDeleteProject,
  onOpenWhatsNew,
  collapsedProjectRailMode,
  onCollapsedProjectRailModeChange,
}: Props) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const panelId = useId();
  const categoryRefs = useRef(new Map<SettingsSectionId, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const categoryGroups = settingsSectionsByGroup();
  const categories = categoryGroups.flatMap((group) => group.sections);
  const [horizontalNavigation, setHorizontalNavigation] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  // A reveal belongs to the section it targets; it is dropped when another section opens.
  const [reveal, setReveal] = useState<{ id: string | null; section: SettingsSectionId }>({
    id: anchor,
    section,
  });
  const [revealRequest, setRevealRequest] = useState(0);
  const [revealInputs, setRevealInputs] = useState({
    anchor,
    request: notificationSettingsRequest,
    section,
  });
  const externalChanged =
    revealInputs.anchor !== anchor || revealInputs.request !== notificationSettingsRequest;
  let currentReveal = reveal;
  // Section changes alone must not reapply an old external anchor.
  if (externalChanged) currentReveal = { id: anchor, section };
  if (revealInputs.section !== section && currentReveal.section !== section) {
    currentReveal = { id: null, section };
  }
  if (externalChanged || revealInputs.section !== section) {
    setRevealInputs({ anchor, request: notificationSettingsRequest, section });
  }
  if (currentReveal !== reveal) setReveal(currentReveal);
  const revealed = currentReveal.id;
  const notificationHighlightActive =
    section === "notifications" && revealed === "project-notifications";
  const notificationHighlightKey = `${section}|${revealed}|${revealRequest}|${notificationSettingsRequest}`;
  const [expiredHighlightKey, setExpiredHighlightKey] = useState<string | null>(null);
  if (!notificationHighlightActive && expiredHighlightKey !== null) setExpiredHighlightKey(null);
  const notificationHighlight =
    notificationHighlightActive && expiredHighlightKey !== notificationHighlightKey;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings(
    collapsedProjectRailMode,
    onCollapsedProjectRailModeChange,
  );
  // Page-level "Restore defaults": only a page that registers a handler (useSettingsPageReset) gets
  // the header action, always behind a confirmation. Appearance registers through the shell.
  const [registeredReset, setRegisteredReset] = useState<SettingsPageResetRegistration | null>(
    null,
  );
  const pageReset =
    section === "appearance" ? { run: appearance.restoreDefaults } : registeredReset;
  const { confirm: confirmPageReset, dialog: pageResetDialog } = useConfirm();

  useEffect(() => {
    if (!notificationHighlightActive) return;
    const timer = setTimeout(() => setExpiredHighlightKey(notificationHighlightKey), 1800);
    return () => clearTimeout(timer);
  }, [notificationHighlightActive, notificationHighlightKey]);

  useEffect(() => {
    categoryRefs.current.get(section)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);

  useEffect(() => {
    const nav = navigationRef.current;
    if (!nav) return;
    const update = () => setHorizontalNavigation(getComputedStyle(nav).flexDirection === "row");
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  // Keep the reveal context alive so controlled advanced panels do not hide
  // the focused result when its visual highlight would otherwise expire.
  useEffect(() => {
    if (!revealed || (revealed === "project-notifications" && notificationProjectPath)) return;
    const panel = panelRef.current;
    if (!panel) return;
    let frame = 0;
    const observer = new MutationObserver(locate);
    function locate() {
      const target = document.getElementById(settingDomId(revealed!));
      if (!target || !panel?.contains(target)) return;
      if (target instanceof HTMLDetailsElement && !target.open) target.open = true;
      let parent = target.parentElement;
      while (parent && parent !== panel) {
        if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
        parent = parent.parentElement;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (target.getClientRects().length === 0) return;
        observer.disconnect();
        target.scrollIntoView?.({ block: "center" });
        // Search should land on the setting itself, not its optional help trigger.
        const controlRoot =
          target.querySelector<HTMLElement>(".settings-row-control, .settings-group-content") ??
          target;
        const control = [
          ...controlRoot.querySelectorAll<HTMLElement>(
            'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]',
          ),
        ].find((element) => element.getClientRects().length > 0);
        if (!control && !target.hasAttribute("tabindex")) target.tabIndex = -1;
        (control ?? target).focus({ preventScroll: true });
      });
    }
    observer.observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "open"],
    });
    locate();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [revealed, revealRequest, section, notificationProjectPath, notificationSettingsRequest]);

  const onReveal = useCallback(
    (next: SettingsSectionId, settingId: string | null) => {
      if (next !== section) onSelectSection?.(next);
      setReveal({ id: settingId, section: next });
      setRevealRequest((request) => request + 1);
      // The page title is the meaningful target; the tabpanel itself is not a keyboard stop.
      if (!settingId)
        requestAnimationFrame(() =>
          panelRef.current?.querySelector<HTMLElement>(".settings-page-title")?.focus(),
        );
    },
    [onSelectSection, section],
  );

  const selectCategory = (next: SettingsSectionId) => {
    setReveal({ id: null, section });
    onSelectSection?.(next);
  };

  useEffect(() => {
    // An embedding overlay already owns Escape, ordering it after inner popups and dialogs.
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    // Let dialogs and other Settings controls handle Escape first.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);

  // One header row per page: identity on the left, 28px ghost icon actions on the right.
  const pageBar = (
    <header className="settings-page-bar bycoda-settings-toolbar">
      <div className="settings-page-bar-inner">
        <div className="bycoda-settings-category-picker">
          <SearchableSelect
            hideLabel
            label={t("Settings categories")}
            value={section}
            disabled={!onSelectSection}
            options={categories.map((category) => ({
              value: category.id,
              label: category.label,
              keywords: settingsSectionDescription(category.id),
            }))}
            onChange={(value) => onReveal(value as SettingsSectionId, null)}
          />
        </div>
        <h1 className="settings-page-title" tabIndex={-1}>
          {settingsSectionLabel(section)}
        </h1>
        <div className="bycoda-settings-toolbar-actions">
          <SidebarUpdateFooter />
          <SettingsSearch onReveal={onReveal} />
          {headerAction}
          {pageReset ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              iconOnly
              label={
                section === "appearance"
                  ? t("Reset all appearance settings")
                  : t("Restore defaults")
              }
              onClick={() =>
                void confirmPageReset({
                  title: t("Restore defaults"),
                  message:
                    section === "appearance"
                      ? t(
                          "Reset every Appearance setting to its default? Saved themes and your background image library are kept. Each tab also keeps its own reset buttons.",
                        )
                      : t(
                          "Restore this page's settings to their defaults? Other pages are not affected.",
                        ),
                  confirmLabel: t("Restore defaults"),
                  onConfirm: pageReset.run,
                })
              }
            >
              <RotateCcw aria-hidden="true" className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
          <SettingsPageHelp
            description={settingsSectionDescription(section)}
            automaticSave={AUTOMATIC_SAVE_SECTIONS.includes(section)}
          />
          {onToggleMaximize ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              iconOnly
              label={maximized ? t("Restore size") : t("Maximize")}
              onClick={onToggleMaximize}
            >
              {maximized ? (
                <Minimize2 aria-hidden="true" className="icon-sm" strokeWidth={1.75} />
              ) : (
                <Maximize2 aria-hidden="true" className="icon-sm" strokeWidth={1.75} />
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );

  return (
    <div
      role="region"
      aria-label={t("Settings")}
      data-app-settings
      data-settings-embedded={embedded || undefined}
      data-settings-maximized={maximized || undefined}
      className="bycoda-settings bycoda-settings-workbench flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {embedded ? null : (
        <PaneHeader
          className="bycoda-settings-titlebar shrink-0 select-none"
          dragRegion
          chromeInset={!besideRail}
          leading={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onClose}
              aria-label={t("Back to workspace")}
              tooltip={t("Back to workspace")}
              tooltipWhen="overflow"
            >
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              <span className="truncate">{t("Back to workspace")}</span>
            </Button>
          }
          title={section === "usage" ? t("Provider usage / This machine") : t("Settings")}
          titleAs="div"
          trailing={IS_MAC ? null : <WindowControls />}
        />
      )}

      <div className="bycoda-settings-body">
        <Tabs
          value={section}
          onValueChange={(next) => selectCategory(next as SettingsSectionId)}
          orientation={horizontalNavigation ? "horizontal" : "vertical"}
          variant="item"
          size="md"
          panels="shared"
          id={panelId}
        >
          <TabList
            ref={navigationRef}
            className="bycoda-settings-categories"
            label={t("Settings categories")}
          >
            <SettingsAccountRow section={section} panelId={panelId} onSelect={selectCategory} />
            {navigationGroups(categoryGroups).map((group) => (
              <div key={group.id} className="bycoda-settings-category-group" role="presentation">
                <span className="bycoda-settings-category-label" aria-hidden="true">
                  {group.label}
                </span>
                <div
                  className="bycoda-settings-category-tabs"
                  role="group"
                  aria-label={group.label}
                >
                  {group.sections.map((category) => {
                    const Icon = SETTINGS_SECTION_ICONS[category.id];
                    return (
                      <Tab
                        key={category.id}
                        value={category.id}
                        align="start"
                        fullWidth
                        tooltip={category.label}
                        tooltipWhen="overflow"
                        ref={(node) => {
                          if (node) categoryRefs.current.set(category.id, node);
                          else categoryRefs.current.delete(category.id);
                        }}
                        type="button"
                        controls={panelId}
                        disabled={!onSelectSection && category.id !== section}
                        data-category-group={category.group}
                        icon={<Icon aria-hidden className="icon-sm" strokeWidth={1.75} />}
                      >
                        {category.label}
                      </Tab>
                    );
                  })}
                </div>
              </div>
            ))}
          </TabList>

          <TabPanel
            ref={panelRef}
            id={panelId}
            labelledBy={section === "account" ? accountRowId(panelId) : undefined}
            tabIndex={undefined}
            data-settings-full={section === "skills" || undefined}
            className="bycoda-settings-panel"
          >
            {section === "skills" ? (
              <RevealedSetting.Provider value={revealed}>
                {pageBar}
                <SkillsPage
                  key={cwd}
                  cwd={cwd}
                  header={<span className="sr-only">{settingsSectionLabel(section)}</span>}
                />
              </RevealedSetting.Provider>
            ) : (
              <RevealedSetting.Provider value={revealed}>
                <PageAutomaticSaveHint.Provider value={AUTOMATIC_SAVE_SECTIONS.includes(section)}>
                  <SettingsPageResetRegistry.Provider value={setRegisteredReset}>
                    <div
                      key={section}
                      data-settings-scroller
                      ref={lockOverscroll}
                      className="@container/settings min-h-0 flex-1 overflow-y-auto overscroll-none [scrollbar-gutter:stable]"
                    >
                      {pageBar}
                      <div
                        data-settings-section={section}
                        className="bycoda-settings-content bycoda-settings-form min-w-0 w-full"
                      >
                        {section === "general" ? (
                          <GeneralPage onOpenWhatsNew={onOpenWhatsNew} />
                        ) : null}
                        {section === "crews" ? (
                          <div className="settings-topics">
                            <CrewsSettings
                              cwd={cwd}
                              onOpen={
                                onOpenBackgroundSession
                                  ? async (target) => {
                                      await onOpenBackgroundSession(target);
                                      onClose();
                                    }
                                  : undefined
                              }
                            />
                          </div>
                        ) : null}
                        {section === "connections" ? <ConnectionsSettings /> : null}
                        {section === "appearance" ? (
                          <AppearancePage appearance={appearance} revealRequest={revealRequest} />
                        ) : null}
                        {section === "workspace" ? (
                          <WorkspacePage>
                            <Group title={t("Explorer")} layout="full">
                              <Row
                                id="show-excluded-files"
                                label={t("Show excluded files")}
                                feedback={
                                  <AppearanceSaveFeedback settingIds={["show-excluded-files"]} />
                                }
                                description={t(
                                  "Show files and folders Git excludes, such as build output and dependencies, in the explorer.",
                                )}
                              >
                                <Toggle
                                  label={t("Show excluded files")}
                                  on={appearance.showExcludedFiles}
                                  onChange={appearance.onShowExcludedFiles}
                                />
                              </Row>
                            </Group>
                            <WorkspaceEditorSettings />
                          </WorkspacePage>
                        ) : null}
                        {section === "notifications" ? (
                          <div className="settings-topics">
                            <NotificationAlerts />
                            <div
                              id={settingDomId("project-notifications")}
                              data-setting-id="project-notifications"
                            >
                              <ProjectNotificationSettings
                                cwd={cwd}
                                recents={recents}
                                notificationProjectPath={notificationProjectPath}
                                notificationSettingsRequest={notificationSettingsRequest}
                                highlighted={notificationHighlight}
                              />
                            </div>
                          </div>
                        ) : null}
                        {section === "chat" ? <ChatPage appearance={appearance} /> : null}
                        {section === "voice" ? <VoicePage /> : null}
                        {section === "policies" ? <PoliciesSettings /> : null}
                        {section === "keybindings" ? <KeybindingsPage /> : null}
                        {section === "terminal" ? <TerminalPage /> : null}
                        {section === "mcp" ? <McpSettings cwd={cwd} recents={recents} /> : null}
                        {section === "providers" ? (
                          <ProvidersPageGate cwd={cwd} recents={recents} />
                        ) : null}
                        {section === "usage" ? <UsagePage /> : null}
                        {section === "limits" ? <UsagePage limitsOnly /> : null}
                        {section === "worktrees" ? (
                          <div className="settings-topics">
                            <SourceControlSettings />
                            <WorktreesPage
                              boundary
                              cwd={cwd}
                              recents={recents}
                              liveSessions={liveSessions}
                              onRemove={onRemoveWorktree}
                              onCheckRemove={onCheckWorktreeRemoval}
                              onDeleteSessions={onDeleteWorktreeSessions}
                            />
                          </div>
                        ) : null}
                        {section === "groupLock" ? (
                          <div className="group-privacy settings-topics">
                            <PrivacyStartupSettings />
                            <GroupLockSettings controls={{ Group, Row, Toggle, Select }} />
                          </div>
                        ) : null}
                        {section === "integrations" ? <IntegrationsPage /> : null}
                        {section === "account" ? <AccountScreen /> : null}
                        {section === "secrets" ? <SecretsSettings /> : null}
                        {section === "archive" ? (
                          <ArchivePage
                            cwd={cwd}
                            sessions={sessions}
                            sessionsStatus={sessionsStatus}
                            onOpenSession={onOpenSession}
                            onArchiveSession={onArchiveSession}
                            onDeleteSession={onDeleteSession}
                            onRestoreProject={onRestoreProject}
                            onDeleteProject={onDeleteProject}
                          />
                        ) : null}
                      </div>
                    </div>
                  </SettingsPageResetRegistry.Provider>
                </PageAutomaticSaveHint.Provider>
              </RevealedSetting.Provider>
            )}
          </TabPanel>
        </Tabs>
      </div>
      {pageResetDialog}
    </div>
  );
}

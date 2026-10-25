import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { CrewsSettings } from "../../crews/ui/CrewsSettings";
import { t, useLocale } from "../../../shared/i18n";
import { ConnectionsSettings } from "../../connections/ui/ConnectionsSettings";

import { ArrowLeft, RotateCcw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./BycodaSettings.css";

import { McpSettings } from "./McpSettings";
import { GroupLockSettings } from "../../group-lock/ui/GroupLockSettings";

import { WindowControls } from "../../../app/shell/WindowControls";
import { SETTINGS_SECTION_ICONS } from "../../../app/shell/SettingsRail";
import { SidebarUpdateFooter } from "../../../app/shell/SidebarUpdate";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

import { IS_MAC } from "../../../platform/tauri/platform";
import { type RecentProject } from "../../projects/model/recents";

import type { SessionSummary } from "../../sessions/data/sessionStore";

import {
  settingsSectionsByGroup,
  settingsSectionDescription,
  settingsSectionLabel,
  type CollapsedProjectRailMode,
  type SettingsSectionId,
} from "../model/settings";

import { SkillsPage } from "../../skills/ui/SkillsPage";

import { WorktreesPage } from "../../source-control/ui/WorktreesPage";
import { removeWorktree, type RemoveWorktree } from "../../source-control/model/worktrees";
import type { Session } from "../../sessions/model/session";
import {
  settingDomId,
  RevealedSetting,
  PageAutomaticSaveHint,
  PageHeader,
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
import { ChatPage } from "./ChatSettings";
import { InboxPage } from "./InboxSettings";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { AppearancePage } from "./AppearanceSettings";
import { KeybindingsPage } from "./ShortcutSettings";
import { TerminalPage } from "./TerminalSettings";
import { ProvidersPage } from "./ProviderSettings";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { ArchivePage } from "./ArchiveSettings";

const UsagePage = lazySurface(async () => ({
  default: (await import("../../usage/ui/UsagePage")).UsagePage,
}));

/**
 * The `data-setting-id` Settings should reveal when it opens: one of the ids in
 * `SETTINGS_INDEX`. Inbox integrations pass their provider id.
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
  onClose: () => void;
  /** Lets search jump to a setting that lives on another page. */
  onSelectSection?: (section: SettingsSectionId) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenBackgroundSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void | Promise<void>;
  onOpenWhatsNew: (version: string) => void;
  collapsedProjectRailMode?: CollapsedProjectRailMode;
  onCollapsedProjectRailModeChange?: (mode: CollapsedProjectRailMode) => void;
};

/** Pages that persist every change themselves; the header says so once. */
const AUTOMATIC_SAVE_SECTIONS: readonly string[] = [
  "general",
  "appearance",
  "workspace",
  "chat",
  "terminal",
];

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
  onClose,
  onSelectSection,
  onOpenSession,
  onOpenBackgroundSession,
  onArchiveSession,
  onDeleteSession,
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
  const categories = settingsSectionsByGroup().flatMap((group) => group.sections);
  const [horizontalNavigation, setHorizontalNavigation] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState<string | null>(anchor);
  const [revealRequest, setRevealRequest] = useState(0);
  const [notificationHighlight, setNotificationHighlight] = useState(false);
  const revealSection = useRef(section);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings(
    collapsedProjectRailMode,
    onCollapsedProjectRailModeChange,
  );

  useEffect(() => {
    revealSection.current = section;
    setRevealed(anchor);
    // Section changes alone must not reapply an old external anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, notificationSettingsRequest]);

  useEffect(() => {
    if (revealSection.current !== section) setRevealed(null);
  }, [section]);

  useEffect(() => {
    const active = section === "notifications" && revealed === "project-notifications";
    setNotificationHighlight(active);
    if (!active) return;
    const timer = setTimeout(() => setNotificationHighlight(false), 1800);
    return () => clearTimeout(timer);
  }, [section, revealed, revealRequest, notificationSettingsRequest]);

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
      revealSection.current = next;
      if (next !== section) onSelectSection?.(next);
      setRevealed(settingId);
      setRevealRequest((request) => request + 1);
      if (!settingId) requestAnimationFrame(() => panelRef.current?.focus());
    },
    [onSelectSection, section],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    // Let dialogs and other Settings controls handle Escape first.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="region"
      aria-label={t("Settings")}
      data-app-settings
      className="bycoda-settings bycoda-settings-workbench flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            aria-label={t("Back to workspace")}
            data-tauri-drag-region="false"
          >
            <ArrowLeft className="icon-sm shrink-0" aria-hidden="true" />
            <span className="truncate">{t("Back to workspace")}</span>
          </Button>
          <span className="min-w-0 truncate text-(--ui-text-secondary)">
            {section === "usage" ? t("Usage / This machine") : t("Settings")}
          </span>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <header className="bycoda-settings-toolbar">
        <div className="bycoda-settings-category-picker">
          <SearchableSelect
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
        <div className="bycoda-settings-toolbar-actions">
          <SidebarUpdateFooter />
          <SettingsSearch onReveal={onReveal} />
          <SettingsPageHelp
            className="bycoda-settings-mobile-help"
            description={settingsSectionDescription(section)}
            automaticSave={AUTOMATIC_SAVE_SECTIONS.includes(section)}
          />
          {section === "appearance" ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              iconOnly
              label={t("Restore defaults")}
              onClick={appearance.restoreDefaults}
            >
              <RotateCcw className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="bycoda-settings-body">
        <nav
          ref={navigationRef}
          className="bycoda-settings-categories"
          role="tablist"
          aria-orientation={horizontalNavigation ? "horizontal" : "vertical"}
          aria-label={t("Settings categories")}
        >
          {settingsSectionsByGroup().map((group) => (
            <div key={group.id} className="bycoda-settings-category-group">
              <span className="bycoda-settings-category-label">{group.label}</span>
              <div className="bycoda-settings-category-tabs">
                {group.sections.map((category) => {
                  const index = categories.findIndex((item) => item.id === category.id);
                  const Icon = SETTINGS_SECTION_ICONS[category.id];
                  return (
                    <Button
                      variant="item"
                      motion="none"
                      selected={category.id === section}
                      tooltip={category.label}
                      key={category.id}
                      ref={(node) => {
                        if (node) categoryRefs.current.set(category.id, node);
                        else categoryRefs.current.delete(category.id);
                      }}
                      type="button"
                      role="tab"
                      id={`${panelId}-${category.id}`}
                      aria-selected={category.id === section}
                      aria-controls={panelId}
                      tabIndex={category.id === section ? 0 : -1}
                      disabled={!onSelectSection && category.id !== section}
                      data-category-group={category.group}
                      onClick={() => {
                        setRevealed(null);
                        onSelectSection?.(category.id);
                      }}
                      onKeyDown={(event) => {
                        if (!onSelectSection) return;
                        let next = index;
                        if (event.key === (horizontalNavigation ? "ArrowRight" : "ArrowDown"))
                          next = (index + 1) % categories.length;
                        else if (event.key === (horizontalNavigation ? "ArrowLeft" : "ArrowUp"))
                          next = (index - 1 + categories.length) % categories.length;
                        else if (event.key === "Home") next = 0;
                        else if (event.key === "End") next = categories.length - 1;
                        else return;
                        event.preventDefault();
                        event.stopPropagation();
                        const target = categories[next]!;
                        setRevealed(null);
                        categoryRefs.current.get(target.id)?.focus();
                        onSelectSection(target.id);
                      }}
                    >
                      <Icon aria-hidden strokeWidth={1.75} />
                      <span>{category.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          ref={panelRef}
          id={panelId}
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${panelId}-${section}`}
          className="bycoda-settings-panel"
        >
          {section === "skills" ? (
            <RevealedSetting.Provider value={revealed}>
              <SkillsPage
                key={cwd}
                cwd={cwd}
                header={
                  <PageHeader
                    title={settingsSectionLabel(section)}
                    description={settingsSectionDescription(section)}
                  />
                }
              />
            </RevealedSetting.Provider>
          ) : (
            <RevealedSetting.Provider value={revealed}>
              <PageAutomaticSaveHint.Provider value={AUTOMATIC_SAVE_SECTIONS.includes(section)}>
                <div
                  key={section}
                  data-settings-scroller
                  ref={lockOverscroll}
                  className="@container/settings min-h-0 flex-1 overflow-y-auto overscroll-none [scrollbar-gutter:stable]"
                >
                  <div
                    data-settings-section={section}
                    className="bycoda-settings-content bycoda-settings-form mx-auto w-full px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8"
                  >
                    <PageHeader
                      title={settingsSectionLabel(section)}
                      description={settingsSectionDescription(section)}
                      automaticSave={AUTOMATIC_SAVE_SECTIONS.includes(section)}
                    />
                    {section === "general" ? <GeneralPage onOpenWhatsNew={onOpenWhatsNew} /> : null}
                    {section === "crews" ? (
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
                    ) : null}
                    {section === "connections" ? (
                      <>
                        <ConnectionsSettings />
                      </>
                    ) : null}
                    {section === "appearance" ? <AppearancePage appearance={appearance} /> : null}
                    {section === "workspace" ? (
                      <WorkspacePage>
                        <Group title={t("Explorer")} layout="full">
                          <Row
                            id="show-excluded-files"
                            label={t("Show excluded files")}
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
                      <>
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
                      </>
                    ) : null}
                    {section === "chat" ? <ChatPage appearance={appearance} /> : null}
                    {section === "policies" ? <PoliciesSettings /> : null}
                    {section === "keybindings" ? <KeybindingsPage /> : null}
                    {section === "terminal" ? <TerminalPage /> : null}
                    {section === "mcp" ? <McpSettings cwd={cwd} recents={recents} /> : null}
                    {section === "providers" ? <ProvidersPage cwd={cwd} recents={recents} /> : null}
                    {section === "usage" ? <UsagePage /> : null}
                    {section === "limits" ? <UsagePage limitsOnly /> : null}
                    {section === "worktrees" ? (
                      <>
                        <SourceControlSettings />
                        <Group title={t("Worktrees")} layout="full">
                          <WorktreesPage
                            cwd={cwd}
                            recents={recents}
                            liveSessions={liveSessions}
                            onRemove={onRemoveWorktree}
                            onCheckRemove={onCheckWorktreeRemoval}
                            onDeleteSessions={onDeleteWorktreeSessions}
                          />
                        </Group>
                      </>
                    ) : null}
                    {section === "groupLock" ? (
                      <div className="group-privacy">
                        <PrivacyStartupSettings />
                        <GroupLockSettings controls={{ Group, Row, Toggle, Select }} />
                      </div>
                    ) : null}
                    {section === "inbox" ? <InboxPage /> : null}
                    {section === "archive" ? (
                      <ArchivePage
                        cwd={cwd}
                        sessions={sessions}
                        onOpenSession={onOpenSession}
                        onArchiveSession={onArchiveSession}
                        onDeleteSession={onDeleteSession}
                        onRestoreProject={onRestoreProject}
                        onDeleteProject={onDeleteProject}
                      />
                    ) : null}
                  </div>
                </div>
              </PageAutomaticSaveHint.Provider>
            </RevealedSetting.Provider>
          )}
        </div>
      </div>
    </div>
  );
}

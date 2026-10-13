import { t, useLocale } from "../../../shared/i18n";
import { ConnectionsSettings } from "../../connections/ui/ConnectionsSettings";
import { TemplatesSettings } from "./TemplatesSettings";

import { ArrowLeft, RotateCcw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./BycodaSettings.css";

import { McpSettings } from "./McpSettings";
import { GroupLockSettings } from "../../group-lock/ui/GroupLockSettings";

import { WindowControls } from "../../../app/shell/WindowControls";
import { SETTINGS_SECTION_ICONS } from "../../../app/shell/SettingsRail";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

import { IS_MAC } from "../../../platform/tauri/platform";
import { type RecentProject } from "../../projects/model/recents";

import type { SessionSummary } from "../../sessions/data/sessionStore";

import {
  SETTINGS_SECTIONS,
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
  PageHeader,
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
import { ChatPage } from "./ChatSettings";
import { InboxPage } from "./InboxSettings";
import { useAppearanceSettings } from "./useAppearanceSettings";
import { AppearancePage } from "./AppearanceSettings";
import { KeybindingsPage } from "./ShortcutSettings";
import { TerminalPage } from "./TerminalSettings";
import { ProvidersPage } from "./ProviderSettings";
import { GenericAcpSettings } from "../../providers/ui/GenericAcpSettings";
import { UsagePage } from "../../usage/ui/UsagePage";
import { ArchivePage } from "./ArchiveSettings";
import { RemoteReconnectGroup } from "./ConnectionRecoverySettings";

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
  onArchiveSession: (sessionId: string, archived: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
  onRestoreProject?: (path: string) => void;
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
  onClose,
  onSelectSection,
  onOpenSession,
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
  const [revealed, setRevealed] = useState<string | null>(anchor);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appearance = useAppearanceSettings(
    collapsedProjectRailMode,
    onCollapsedProjectRailModeChange,
  );

  useEffect(() => setRevealed(anchor), [anchor, notificationSettingsRequest]);

  useEffect(() => {
    categoryRefs.current.get(section)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);

  // Section is a dependency so a search result on another page scrolls once
  // that page has mounted the row.
  useEffect(() => {
    if (!revealed) return;
    // A project quick action lets the project card focus itself after discovery.
    if (!(revealed === "project-notifications" && notificationProjectPath)) {
      document.getElementById(settingDomId(revealed))?.scrollIntoView?.({ block: "center" });
    }
    const timer = window.setTimeout(() => setRevealed(null), 1800);
    return () => window.clearTimeout(timer);
  }, [revealed, section, notificationProjectPath, notificationSettingsRequest]);

  const onReveal = useCallback(
    (next: SettingsSectionId, settingId: string | null) => {
      if (next !== section) onSelectSection?.(next);
      setRevealed(settingId);
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
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Back to workspace")}
            data-tauri-drag-region="false"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-content/70 hover:bg-content/10 hover:text-content"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span>{t("Back to workspace")}</span>
          </button>
          <span className="shrink-0 text-content/60">
            {section === "usage" ? t("Usage / This machine") : t("Settings")}
          </span>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <header className="bycoda-settings-toolbar">
        <div className="bycoda-settings-toolbar-title">
          <span>{section === "usage" ? t("Usage") : t("Workspace configuration")}</span>
          <p>
            {section === "usage"
              ? t("Provider limits and session activity")
              : t("Application, agents and project preferences")}
          </p>
        </div>
        <div className="bycoda-settings-toolbar-actions">
          <SettingsSearch onReveal={onReveal} />
          {section === "appearance" ? (
            <button
              type="button"
              onClick={appearance.restoreDefaults}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.75} />
              {t("Restore defaults")}
            </button>
          ) : null}
        </div>
      </header>

      <div className="bycoda-settings-body">
        <nav
          className="bycoda-settings-categories"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("Settings categories")}
        >
          {settingsSectionsByGroup().map((group) => (
            <div key={group.id} className="bycoda-settings-category-group">
              <span className="bycoda-settings-category-label">{group.label}</span>
              <div className="bycoda-settings-category-tabs">
                {group.sections.map((category) => {
                  const index = SETTINGS_SECTIONS.findIndex((item) => item.id === category.id);
                  const Icon = SETTINGS_SECTION_ICONS[category.id];
                  return (
                    <button
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
                      onClick={() => onSelectSection?.(category.id)}
                      onKeyDown={(event) => {
                        if (!onSelectSection) return;
                        let next = index;
                        if (event.key === "ArrowRight" || event.key === "ArrowDown")
                          next = (index + 1) % SETTINGS_SECTIONS.length;
                        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                          next = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
                        else if (event.key === "Home") next = 0;
                        else if (event.key === "End") next = SETTINGS_SECTIONS.length - 1;
                        else return;
                        event.preventDefault();
                        event.stopPropagation();
                        const target = SETTINGS_SECTIONS[next]!;
                        categoryRefs.current.get(target.id)?.focus();
                        onSelectSection(target.id);
                      }}
                    >
                      <Icon aria-hidden strokeWidth={1.75} />
                      <span>{category.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          id={panelId}
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${panelId}-${section}`}
          className="bycoda-settings-panel"
        >
          {section === "skills" ? (
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
          ) : (
            <RevealedSetting.Provider value={revealed}>
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
                  />
                  {section === "general" ? <GeneralPage onOpenWhatsNew={onOpenWhatsNew} /> : null}
                  {section === "connections" ? (
                    <>
                      <ConnectionsSettings />
                      <RemoteReconnectGroup />
                    </>
                  ) : null}
                  {section === "appearance" ? <AppearancePage appearance={appearance} /> : null}
                  {section === "workspace" ? (
                    <>
                      <WorkspacePage />
                      <WorkspaceEditorSettings />
                      <Group title={t("Explorer")}>
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
                    </>
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
                          highlighted={revealed === "project-notifications"}
                        />
                      </div>
                    </>
                  ) : null}
                  {section === "chat" ? <ChatPage /> : null}
                  {section === "policies" ? <PoliciesSettings /> : null}
                  {section === "chat" ? <TemplatesSettings /> : null}
                  {section === "keybindings" ? <KeybindingsPage /> : null}
                  {section === "terminal" ? <TerminalPage /> : null}
                  {section === "mcp" ? <McpSettings cwd={cwd} recents={recents} /> : null}
                  {section === "providers" ? (
                    <>
                      <ProvidersPage cwd={cwd} recents={recents} />
                      <GenericAcpSettings cwd={cwd} />
                    </>
                  ) : null}
                  {section === "usage" ? <UsagePage /> : null}
                  {section === "worktrees" ? (
                    <WorktreesPage
                      cwd={cwd}
                      recents={recents}
                      liveSessions={liveSessions}
                      onRemove={onRemoveWorktree}
                      onCheckRemove={onCheckWorktreeRemoval}
                      onDeleteSessions={onDeleteWorktreeSessions}
                    />
                  ) : null}
                  {section === "groupLock" ? (
                    <>
                      <PrivacyStartupSettings />
                      <GroupLockSettings controls={{ Group, Row, Toggle, Select }} />
                    </>
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
            </RevealedSetting.Provider>
          )}
        </div>
      </div>
    </div>
  );
}

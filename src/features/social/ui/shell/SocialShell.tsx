import { Text } from "../../../../shared/ui/Text";
import { t, useLocale } from "../../../../shared/i18n";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Bot, Globe } from "../../../../shared/ui/icons";
import { useState, type ComponentType, type ReactNode } from "react";
import { Button } from "../../../../shared/ui/Button";
import {
  SessionDiscussionPanel,
  type PanelSessionPortal,
  type PanelSessionScope,
} from "../../../sessions/public/SessionDiscussionPanel";
import { isLocalSyncMachine } from "../../../connections/public/localSync";
import { isRemoteProjectPath } from "../../../../shared/lib/paths";
import { remotePath, rememberRemoteProject } from "../../../connections/public/remoteProjects";
import { SocialNav } from "./SocialNav";
import { SocialShellBar } from "./SocialShellBar";
import { HostPanels } from "./HostPanels";
import { SocialModelTargetContext } from "./SocialModelSource";
import { START_PANEL, useSocialShell } from "./useSocialShell";
import { useSocialWorkspace } from "./useSocialWorkspace";
import { SocialFirstRun } from "./SocialFirstRun";
import { SocialChatLiveView } from "./SocialChatLiveView";
import "./social-shell.css";

/**
 * The app's window chrome for the header row: back and sidebar controls, tool navigation and
 * window controls. The app supplies it, so this feature never imports `app`.
 */
export type SocialHeaderProps = {
  besideRail: boolean;
  compactRail: boolean;
  onClose: () => void;
  onToggleSidebar: () => void;
  children: ReactNode;
};

/** Props of the Social surface. Same shape as the old SocialView, plus the app's header slot. */
export type SocialShellProps = {
  cwd: string;
  onClose: () => void;
  besideRail?: boolean;
  compactRail?: boolean;
  onToggleSidebar?: () => void;
  header: ComponentType<SocialHeaderProps>;
  onOpenSession?: (scope: PanelSessionScope) => Promise<string>;
  onSessionMount?: (portal: PanelSessionPortal | null) => void;
};

/** Redesigned Social workspace: one workspace selector, global AI stop, five sections. */
export function SocialShell({
  cwd,
  onClose,
  besideRail = false,
  compactRail = false,
  onToggleSidebar = () => {},
  header: Header,
  onOpenSession,
  onSessionMount,
}: SocialShellProps) {
  useLocale();
  const workspace = useSocialWorkspace(cwd);
  const sections = useSocialShell(workspace.machineId);
  const { machineId, client, shell, loaded } = workspace;
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem("bycoda.social.chatOpen") === "1";
    } catch {
      return false;
    }
  });
  const machine = workspace.machines.find((item) => item.id === machineId);
  const project = workspace.projects.find((item) => item.id === workspace.projectId);
  const sessionCwd = !machine
    ? ""
    : project
      ? !isLocalSyncMachine(machine)
        ? remotePath(machine.environmentId, project.cwd)
        : isRemoteProjectPath(project.cwd)
          ? ""
          : project.cwd
      : isLocalSyncMachine(machine) && !isRemoteProjectPath(cwd)
        ? cwd
        : "";
  const scope: PanelSessionScope = {
    key: JSON.stringify(["social", machineId, workspace.projectId ?? null, sessionCwd]),
    cwd: sessionCwd,
    title: t("Social Media"),
  };
  const setChat = (open: boolean) => {
    setChatOpen(open);
    try {
      localStorage.setItem("bycoda.social.chatOpen", open ? "1" : "0");
    } catch {
      /* The panel remains usable without preference storage. */
    }
  };
  // Hosts with retained sections stay mounted; the current Host is always included.
  const hostIds = [...new Set([machineId, ...Object.keys(sections.panels)])].filter(Boolean);
  const offline = loaded && !shell.hostOnline;
  return (
    <section className="social-shell" aria-label={t("Social Media")} data-app-social>
      <Header
        besideRail={besideRail}
        compactRail={compactRail}
        onClose={onClose}
        onToggleSidebar={onToggleSidebar}
      >
        <Text
          as="div"
          size="secondary"
          tone="inherit"
          className="flex min-w-0 flex-1 items-center gap-2 px-3"
        >
          <Globe className="icon-sm" tone="secondary" aria-hidden />
          <span>{t("Social Media")}</span>
        </Text>
      </Header>
      <SocialShellBar
        client={client}
        machines={workspace.machines}
        machineId={machineId}
        projects={workspace.projects}
        projectId={workspace.projectId}
        aiStopped={shell.aiStopped}
        hostOnline={shell.hostOnline}
        loading={!loaded}
        onWorkspaceChange={workspace.selectWorkspace}
        onAiStateChange={workspace.setAiStopped}
      />
      {workspace.error ? (
        <InlineError retry={{ onRetry: workspace.retry, label: t("Try again") }}>
          {workspace.error}
        </InlineError>
      ) : null}
      {!workspace.error && offline ? (
        <InlineMessage tone="warning" retry={{ onRetry: workspace.retry, label: t("Try again") }}>
          {shell.unreachable
            ? t("Could not reach this computer.")
            : t("Scheduling is offline. Scheduled posts and replies wait until the Host is back.")}
        </InlineMessage>
      ) : null}
      <SocialFirstRun machineId={machineId} />
      <div className="social-shell-navigation">
        <SocialNav active={sections.screen} onSelect={sections.navigate} />
        {onOpenSession && onSessionMount ? (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Bot className="icon-sm" aria-hidden />}
            aria-expanded={chatOpen}
            onClick={() => setChat(!chatOpen)}
          >
            {t("AI chat")}
          </Button>
        ) : null}
      </div>
      <div className="social-shell-workarea">
        <div className="social-shell-body">
          {hostIds.map((host) => {
            const panel = sections.panels[host] ?? START_PANEL;
            return (
              <SocialModelTargetContext.Provider
                key={host}
                value={{
                  machine: workspace.machines.find((item) => item.id === host),
                  cwd: host === machineId && project ? sessionCwd : "",
                }}
              >
                <HostPanels
                  machineId={host}
                  active={host === machineId}
                  screen={panel.screen}
                  target={panel.target}
                  visited={panel.visited}
                  projectId={workspace.projectFor(host)}
                  shellState={workspace.shellFor(host)}
                  onNavigate={sections.navigate}
                />
              </SocialModelTargetContext.Provider>
            );
          })}
        </div>
        {chatOpen && onOpenSession && onSessionMount ? (
          <SessionDiscussionPanel
            key={scope.key}
            scopeKey={scope.key}
            title={t("Social Media")}
            label={t("AI chat")}
            actions={
              client ? (
                <SocialChatLiveView
                  client={client}
                  machineId={machineId}
                  projectId={workspace.projectId}
                />
              ) : undefined
            }
            onOpen={() => {
              if (machine && project && !isLocalSyncMachine(machine))
                rememberRemoteProject(machine.environmentId, project);
              return onOpenSession(scope);
            }}
            onMount={onSessionMount}
            onClose={() => setChat(false)}
          />
        ) : null}
      </div>
    </section>
  );
}

import { Text } from "../../../../shared/ui/Text";
import { t, useLocale } from "../../../../shared/i18n";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Globe } from "../../../../shared/ui/icons";
import type { ComponentType, ReactNode } from "react";
import { SocialNav } from "./SocialNav";
import { SocialShellBar } from "./SocialShellBar";
import { HostPanels } from "./HostPanels";
import { START_PANEL, useSocialShell } from "./useSocialShell";
import { useSocialWorkspace } from "./useSocialWorkspace";
import { SocialFirstRun } from "./SocialFirstRun";
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
};

/** Redesigned Social workspace: one workspace selector, global AI stop, five sections. */
export function SocialShell({
  cwd,
  onClose,
  besideRail = false,
  compactRail = false,
  onToggleSidebar = () => {},
  header: Header,
}: SocialShellProps) {
  useLocale();
  const workspace = useSocialWorkspace(cwd);
  const sections = useSocialShell(workspace.machineId);
  const { machineId, client, shell, loaded } = workspace;
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
      <SocialNav active={sections.screen} onSelect={sections.navigate} />
      <div className="social-shell-body">
        {hostIds.map((host) => {
          const panel = sections.panels[host] ?? START_PANEL;
          return (
            <HostPanels
              key={host}
              machineId={host}
              active={host === machineId}
              screen={panel.screen}
              target={panel.target}
              visited={panel.visited}
              projectId={workspace.projectFor(host)}
              shellState={workspace.shellFor(host)}
              onNavigate={sections.navigate}
            />
          );
        })}
      </div>
    </section>
  );
}

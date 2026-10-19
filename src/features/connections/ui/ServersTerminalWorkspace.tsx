import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { TerminalView } from "../../terminal/ui/TerminalView";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { Button } from "../../../shared/ui/Button";
import { ArrowLeft, Terminal, X } from "../../../shared/ui/icons";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import type { ServerRecord, SshEndpoint } from "../model/serverInventory";
import { serverTerminalRestoreState } from "../model/serverTerminalRestoreState";
import { ServerTerminalRestoreControls } from "./ServerTerminalRestoreControls";
import { SshConfigurationConnectReview } from "./SshConfigurationConnectReview";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import { SshRunbookQueue } from "./SshRunbookQueue";
import { requestSshStartupReviews } from "../model/sshRunbookQueue";
import { ServerTerminalSession } from "./ServerTerminalSession";

type TerminalActions = {
  open: (server: ServerRecord) => void;
  forwardAgent: (server: ServerRecord, reviewId: string) => void;
  quick: (endpoint: SshEndpoint, name?: string) => void;
  generate: (path: string) => void;
};
const TerminalContext = createContext<TerminalActions | null>(null);
export const useOpenServerTerminal = () => useContext(TerminalContext)?.open;
export const useOpenAgentServerTerminal = () => useContext(TerminalContext)?.forwardAgent;
export const useGenerateSshKey = () => useContext(TerminalContext)?.generate;
export const useOpenQuickServerTerminal = () => useContext(TerminalContext)?.quick;

/** Window-lifetime tabs only: restoring inventory never starts a process or replays input. */
export function ServersTerminalWorkspace({
  children,
  visible = true,
}: {
  children: ReactNode;
  visible?: boolean;
}) {
  useLocale();
  const proxyApproval = useSshHttpProxyApproval();
  const startupNotified = useRef(new Set<string>());
  const [terminals, setTerminals] = useState<
    {
      id: string;
      restoreId: string;
      name: string;
      server?: ServerRecord;
      endpoint?: SshEndpoint;
      keyGenerationPath?: string;
      shellIntegration?: "bash" | "zsh" | "powershell";
      agentForwardingReviewId?: string;
      expectedConfigurationDigest?: string;
      httpProxyTicketId?: string;
      startupEligible?: boolean;
    }[]
  >([]);
  const [active, setActive] = useState<string | null>(null);
  const [reviewQueueRequest, setReviewQueueRequest] = useState(0);
  const [configurationReview, setConfigurationReview] = useState<{
    server: ServerRecord;
    replacingPendingId?: string;
    shellIntegration?: "bash" | "zsh" | "powershell";
    name?: string;
    startupEligible?: boolean;
  }>();
  const authorizeProxy = (
    id: string,
    server?: ServerRecord,
    endpoint?: SshEndpoint,
    shellIntegration?: "bash" | "zsh" | "powershell",
  ) => {
    const target = endpoint ?? server?.effectiveSshEndpoint ?? server?.sshEndpoint;
    return target?.httpProxy
      ? proxyApproval.request({
          connectionId: server?.id,
          endpoint: target,
          operation: { kind: "terminal", id, ...(shellIntegration ? { shellIntegration } : {}) },
        })
      : undefined;
  };
  const launch = async (
    server: ServerRecord,
    replacingPendingId?: string,
    expectedConfigurationDigest?: string,
    shellIntegration?: "bash" | "zsh" | "powershell",
    name = server.name,
    startupEligible = !replacingPendingId,
  ) => {
    const id = `ssh:${crypto.randomUUID()}`;
    const approval = authorizeProxy(id, server, undefined, shellIntegration);
    const httpProxyTicketId = approval ? await approval : undefined;
    if (httpProxyTicketId === null) return;
    const restoreId = crypto.randomUUID();
    setTerminals((previous) => [
      ...previous,
      {
        id,
        restoreId,
        name: shellIntegration
          ? `${name} · ${shellIntegration === "powershell" ? "PowerShell 7" : shellIntegration === "zsh" ? "Zsh" : "Bash"}`
          : name,
        server,
        expectedConfigurationDigest,
        shellIntegration,
        httpProxyTicketId,
        startupEligible,
      },
    ]);
    serverTerminalRestoreState.add({ tabId: restoreId, serverId: server.id }, replacingPendingId);
    setActive(id);
  };
  const open = (server: ServerRecord, replacingPendingId?: string) => {
    if (server.metadata.sshInheritance) setConfigurationReview({ server, replacingPendingId });
    else launch(server, replacingPendingId);
  };
  return (
    <TerminalContext.Provider
      value={{
        open,
        forwardAgent: async (server, reviewId) => {
          const id = `ssh-agent:${crypto.randomUUID()}`;
          const approval = authorizeProxy(id, server);
          const httpProxyTicketId = approval ? await approval : undefined;
          if (httpProxyTicketId === null) return;
          // Approval and this tab are ephemeral. Restore can only open an ordinary session.
          setTerminals((previous) => [
            ...previous,
            {
              id,
              restoreId: crypto.randomUUID(),
              name: server.name,
              server,
              agentForwardingReviewId: reviewId,
              startupEligible: true,
              httpProxyTicketId,
            },
          ]);
          setActive(id);
        },
        quick: async (endpoint, name) => {
          const id = `ssh-quick:${crypto.randomUUID()}`;
          const approval = authorizeProxy(id, undefined, endpoint);
          const httpProxyTicketId = approval ? await approval : undefined;
          if (httpProxyTicketId === null) return;
          setTerminals((previous) => [
            ...previous,
            {
              id,
              restoreId: crypto.randomUUID(),
              endpoint: { ...endpoint },
              httpProxyTicketId,
              name:
                name ||
                `${endpoint.user ? `${endpoint.user}@` : ""}${endpoint.host}:${endpoint.port}`,
            },
          ]);
          setActive(id);
        },
        generate: (path) => {
          const id = `ssh-keygen:${crypto.randomUUID()}`;
          setTerminals((previous) => [
            ...previous,
            {
              id,
              restoreId: crypto.randomUUID(),
              name: t("Generate SSH key"),
              keyGenerationPath: path,
            },
          ]);
          setActive(id);
        },
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {proxyApproval.dialog}
        <SshRunbookQueue openRequest={reviewQueueRequest} />
        <div
          className={active ? "hidden" : "flex min-h-0 min-w-0 flex-1 flex-col"}
          inert={active ? true : undefined}
        >
          {children}
        </div>
        {terminals.length ? (
          <section
            aria-label={t("SSH terminal")}
            className={active ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
            inert={!active ? true : undefined}
          >
            <div className="flex h-10 min-w-0 shrink-0 items-center border-b border-stroke">
              <Button variant="ghost" iconOnly label={t("Servers")} onClick={() => setActive(null)}>
                <ArrowLeft className="size-3.5" />
              </Button>
              <ToolHeader>
                <div className="flex min-w-0 items-center gap-2 px-3 text-sm">
                  <Terminal aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="truncate">
                    {terminals.find((terminal) => terminal.id === active)?.name ??
                      t("SSH terminal")}
                  </span>
                  <Badge tone="info" size="sm">
                    SSH
                  </Badge>
                </div>
              </ToolHeader>
              {!IS_MAC ? <WindowControls /> : null}
            </div>
            <div
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-stroke bg-(--ui-surface-raised) px-2 py-1"
              role="tablist"
              aria-label={t("SSH terminals")}
            >
              {terminals.map((terminal) => (
                <div
                  key={terminal.id}
                  data-server-terminal-tab
                  className="relative min-w-28 max-w-64 shrink-0"
                >
                  <Button
                    variant="tab"
                    tone={active === terminal.id ? "info" : "neutral"}
                    motion="none"
                    fullWidth
                    className="h-9 min-w-0 pe-9"
                    title={terminal.name}
                    role="tab"
                    id={`tab-${terminal.id}`}
                    aria-controls={`panel-${terminal.id}`}
                    aria-selected={active === terminal.id}
                    tabIndex={active === terminal.id ? 0 : -1}
                    onKeyDown={(event) => {
                      const index = terminals.findIndex((item) => item.id === terminal.id);
                      const next =
                        event.key === "Home"
                          ? terminals[0]
                          : event.key === "End"
                            ? terminals[terminals.length - 1]
                            : event.key === "ArrowRight"
                              ? terminals[(index + 1) % terminals.length]
                              : event.key === "ArrowLeft"
                                ? terminals[(index + terminals.length - 1) % terminals.length]
                                : undefined;
                      if (!next) return;
                      event.preventDefault();
                      setActive(next.id);
                      serverTerminalRestoreState.activate(next.restoreId);
                      document.getElementById(`tab-${next.id}`)?.focus();
                    }}
                    onClick={() => {
                      setActive(terminal.id);
                      serverTerminalRestoreState.activate(terminal.restoreId);
                    }}
                  >
                    <Terminal aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{terminal.name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    motion="none"
                    className="absolute end-1 inset-bs-1"
                    label={`${t("Close terminal")}: ${terminal.name}`}
                    onClick={() => {
                      serverTerminalRestoreState.remove(terminal.restoreId);
                      setTerminals((previous) =>
                        previous.filter((item) => item.id !== terminal.id),
                      );
                      if (active === terminal.id) setActive(null);
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                role="tabpanel"
                id={`panel-${terminal.id}`}
                aria-labelledby={`tab-${terminal.id}`}
                className={
                  active === terminal.id ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"
                }
              >
                {terminal.keyGenerationPath ? (
                  <p className="shrink-0 break-all px-3 py-2 text-xs text-(--ui-text-muted)">
                    {t("Identity file")}: {terminal.keyGenerationPath}
                  </p>
                ) : null}
                <ServerTerminalSession
                  keyGenerationPath={terminal.keyGenerationPath}
                  target={terminal.server?.machine?.ssh?.target}
                  port={terminal.server?.machine?.ssh?.port}
                  identityFile={terminal.server?.machine?.ssh?.identityFile}
                  endpoint={
                    terminal.endpoint ??
                    terminal.server?.effectiveSshEndpoint ??
                    terminal.server?.sshEndpoint
                  }
                >
                  {(fontSize, onFontSizeChange, lineHeight) => (
                    <TerminalView
                      fontSize={fontSize}
                      onFontSizeChange={onFontSizeChange}
                      lineHeight={lineHeight}
                      id={terminal.id}
                      cwd=""
                      onReturnToServers={() => setActive(null)}
                      sshConnectionId={terminal.server?.id}
                      sshEndpoint={terminal.endpoint}
                      shellIntegration={terminal.shellIntegration}
                      agentForwardingReviewId={terminal.agentForwardingReviewId}
                      expectedConfigurationDigest={terminal.expectedConfigurationDigest}
                      httpProxyTicketId={terminal.httpProxyTicketId}
                      onStartupReview={
                        terminal.server
                          ? async () => {
                              await requestSshStartupReviews(terminal.server!.id);
                              setReviewQueueRequest((value) => value + 1);
                            }
                          : undefined
                      }
                      onSshPromptReady={
                        terminal.server && terminal.startupEligible
                          ? () => {
                              if (startupNotified.current.has(terminal.id)) return;
                              startupNotified.current.add(terminal.id);
                              void requestSshStartupReviews(terminal.server!.id);
                            }
                          : undefined
                      }
                      onEnableShellIntegration={
                        !terminal.keyGenerationPath && !terminal.shellIntegration
                          ? async (shell = "bash") => {
                              if (terminal.server?.metadata.sshInheritance) {
                                setConfigurationReview({
                                  server: terminal.server,
                                  shellIntegration: shell,
                                  startupEligible: terminal.startupEligible,
                                  name: terminal.name,
                                });
                                return;
                              }
                              const id = `ssh-${shell}:${crypto.randomUUID()}`;
                              const approval = authorizeProxy(
                                id,
                                terminal.server,
                                terminal.endpoint,
                                shell,
                              );
                              const httpProxyTicketId = approval ? await approval : undefined;
                              if (httpProxyTicketId === null) return;
                              const restoreId = crypto.randomUUID();
                              if (terminal.server)
                                serverTerminalRestoreState.add({
                                  tabId: restoreId,
                                  serverId: terminal.server.id,
                                });
                              setTerminals((previous) => [
                                ...previous,
                                {
                                  id,
                                  restoreId,
                                  name: `${terminal.name} · ${shell === "powershell" ? "PowerShell 7" : shell === "zsh" ? "Zsh" : "Bash"}`,
                                  server: terminal.server,
                                  endpoint: terminal.endpoint
                                    ? { ...terminal.endpoint }
                                    : undefined,
                                  shellIntegration: shell,
                                  httpProxyTicketId,
                                  startupEligible: terminal.startupEligible,
                                },
                              ]);
                              setActive(id);
                            }
                          : undefined
                      }
                      keyGenerationPath={terminal.keyGenerationPath}
                      active={visible && active === terminal.id}
                    />
                  )}
                </ServerTerminalSession>
              </div>
            ))}
          </section>
        ) : null}
        {configurationReview ? (
          <SshConfigurationConnectReview
            server={configurationReview.server}
            onClose={() => setConfigurationReview(undefined)}
            onConnect={(digest) => {
              launch(
                configurationReview.server,
                configurationReview.replacingPendingId,
                digest,
                configurationReview.shellIntegration,
                configurationReview.name,
                configurationReview.startupEligible,
              );
              setConfigurationReview(undefined);
            }}
          />
        ) : null}
        <ServerTerminalRestoreControls
          openTabs={terminals.flatMap((terminal) =>
            terminal.server ? [{ tabId: terminal.restoreId, serverId: terminal.server.id }] : [],
          )}
          onConnect={open}
        />
      </div>
    </TerminalContext.Provider>
  );
}

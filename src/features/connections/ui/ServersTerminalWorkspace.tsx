import { Text } from "../../../shared/ui/Text";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  registerSshWorkspaceUi,
  type SshWorkspaceUiOwner,
  type SshWorkspaceStatus,
} from "../model/sshMobileWorkspaceControl";
import { invoke } from "@tauri-apps/api/core";
import { TerminalView } from "../../terminal/ui/TerminalView";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { Button } from "../../../shared/ui/Button";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { confirmCloseTerminal } from "../../terminal/model/terminalClose";
import { ArrowLeft, Terminal, X } from "../../../shared/ui/icons";
import { Badge, StatusBadge } from "../../../shared/ui/Badge";
import { InlineError } from "../../../shared/ui/InlineError";
import { t, useLocale } from "../../../shared/i18n";
import type { ServerRecord, SshEndpoint } from "../model/serverInventory";
import { serverTerminalRestoreState } from "../model/serverTerminalRestoreState";
import { ServerTerminalRestoreControls } from "./ServerTerminalRestoreControls";
import { SshConfigurationConnectReview } from "./SshConfigurationConnectReview";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import { SshRunbookQueue } from "./SshRunbookQueue";
import { requestSshStartupReviews } from "../model/sshRunbookQueue";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ServerTerminalSession } from "./ServerTerminalSession";
import { TerminalContext } from "./serversTerminalContext";

export {
  useGenerateSshKey,
  useOpenAgentServerTerminal,
  useOpenQuickServerTerminal,
  useOpenServerTerminal,
  useServerInventoryVisible,
} from "./serversTerminalContext";

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
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [terminals, setTerminals] = useState<
    {
      id: string;
      restoreId: string;
      lifecycle?: "opened-on-computer" | "exited" | "failed" | "closed";
      name: string;
      server?: ServerRecord;
      endpoint?: SshEndpoint;
      keyGenerationPath?: string;
      shellIntegration?: "auto" | "bash" | "zsh" | "powershell";
      agentForwardingReviewId?: string;
      expectedConfigurationDigest?: string;
      httpProxyTicketId?: string;
      startupEligible?: boolean;
      mobileValid?: () => boolean;
      mobileAuthorize?: () => Promise<boolean>;
    }[]
  >([]);
  const [active, setActive] = useState<string | null>(null);
  const closingRef = useRef(new Set<string>());
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [closeError, setCloseError] = useState("");
  const removeTerminal = (id: string) => {
    const snapshot = terminalSnapshot.current;
    const index = snapshot.findIndex((value) => value.id === id);
    if (index < 0) return;
    const terminal = snapshot[index];
    const remaining = snapshot.filter((value) => value.id !== id);
    // Close confirmations can settle together before React renders again.
    terminalSnapshot.current = remaining;
    serverTerminalRestoreState.remove(terminal.restoreId);
    setTerminals((previous) => previous.filter((value) => value.id !== id));
    setActive((current) => {
      const survivors = terminalSnapshot.current;
      if (current !== id && (current === null || survivors.some((value) => value.id === current)))
        return current;
      const next = survivors[Math.min(index, survivors.length - 1)];
      if (next) serverTerminalRestoreState.activate(next.restoreId);
      requestAnimationFrame(() =>
        document.getElementById(next ? `tab-${next.id}` : "servers-inventory-content")?.focus(),
      );
      return next?.id ?? null;
    });
  };
  const requestClose = async (id: string) => {
    if (closingRef.current.has(id)) return;
    const terminal = terminalSnapshot.current.find((value) => value.id === id);
    if (!terminal) return;
    closingRef.current.add(id);
    setClosing(new Set(closingRef.current));
    setCloseError("");
    try {
      const ended = terminal.lifecycle === "exited" || terminal.lifecycle === "closed";
      if (
        !ended &&
        !(await confirmCloseTerminal({ id, path: terminal.name, cwd: "", terminal: true }))
      )
        return;
      removeTerminal(id);
    } catch (reason) {
      setCloseError(String(reason));
    } finally {
      closingRef.current.delete(id);
      setClosing(new Set(closingRef.current));
    }
  };
  const [reviewQueueRequest, setReviewQueueRequest] = useState(0);
  const [configurationReview, setConfigurationReview] = useState<{
    server: ServerRecord;
    replacingPendingId?: string;
    shellIntegration?: "auto" | "bash" | "zsh" | "powershell";
    name?: string;
    startupEligible?: boolean;
    mobile?: {
      resourceId: string;
      digest: string;
      valid: () => boolean;
      authorize: () => Promise<boolean>;
      resolve: (opened: boolean) => void;
    };
  }>();
  const configurationRef = useRef(configurationReview);
  configurationRef.current = configurationReview;
  const mobileReviewBusy = useRef(false);
  // Never replace an open review: a mobile one owns the phone's resolve callback and busy lock.
  const requestConfigurationReview = (next: NonNullable<typeof configurationReview>) => {
    if (configurationRef.current || mobileReviewBusy.current)
      return setCloseError(t("Finish the open SSH review first."));
    setConfigurationReview((configurationRef.current = next));
  };
  const mobileResources = useRef(
    new Map<
      string,
      {
        state: SshWorkspaceStatus["state"];
        notify: (state: SshWorkspaceStatus["state"]) => void;
        closed?: () => void;
        closeFailed?: () => void;
        finishOpen?: (opened: boolean) => void;
      }
    >(),
  );
  const terminalSnapshot = useRef(terminals);
  terminalSnapshot.current = terminals;
  const mobileApi = useRef<SshWorkspaceUiOwner>(null!);
  mobileApi.current = {
    open: (resourceId, server, digest, valid, notify, authorize) => {
      if (
        configurationRef.current ||
        mobileReviewBusy.current ||
        mobileResources.current.has(resourceId) ||
        !resourceId.startsWith("ssh-mobile:") ||
        !valid()
      )
        return Promise.resolve(false);
      mobileReviewBusy.current = true;
      mobileResources.current.set(resourceId, { state: "opening", notify });
      return new Promise<boolean>((resolve) => {
        mobileResources.current.get(resourceId)!.finishOpen = resolve;
        setConfigurationReview({
          server,
          startupEligible: false,
          mobile: {
            resourceId,
            digest,
            valid,
            authorize,
            resolve: (opened) => {
              mobileReviewBusy.current = false;
              if (!opened) {
                const entry = mobileResources.current.get(resourceId);
                if (entry) {
                  entry.state = "failed";
                  entry.notify("failed");
                  entry.finishOpen?.(false);
                  entry.finishOpen = undefined;
                }
              }
              // Keep native/host Pending alive until the final pre-spawn authority check settles.
            },
          },
        });
      });
    },
    impact: (resourceId) => {
      const entry = mobileResources.current.get(resourceId);
      if (!entry) throw new Error("Terminal was not created by this mobile workspace");
      return {
        state: entry.state,
        count: terminalSnapshot.current.some((terminal) => terminal.id === resourceId) ? 1 : 0,
      };
    },
    close: async (resourceId) => {
      const entry = mobileResources.current.get(resourceId);
      if (!entry) throw new Error("Terminal was not created by this mobile workspace");
      if (entry.state === "closed") return;
      const terminal = terminalSnapshot.current.find((value) => value.id === resourceId);
      if (!terminal) throw new Error("Owned terminal is not mounted");
      const closed = new Promise<void>((resolve, reject) => {
        entry.closed = resolve;
        entry.closeFailed = () => reject(new Error("Owned terminal close did not complete"));
      });
      // TerminalView cleanup waits for its own spawn and kills only this exact PTY.
      removeTerminal(resourceId);
      await closed;
    },
  };
  useLayoutEffect(
    () =>
      registerSshWorkspaceUi({
        open: (...args) => mobileApi.current.open(...args),
        close: (...args) => mobileApi.current.close(...args),
        impact: (...args) => mobileApi.current.impact(...args),
      }),
    [],
  );
  const authorizeProxy = (
    id: string,
    server?: ServerRecord,
    endpoint?: SshEndpoint,
    shellIntegration?: "auto" | "bash" | "zsh" | "powershell",
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
    shellIntegration: "auto" | "bash" | "zsh" | "powershell" = "auto",
    name = server.name,
    startupEligible = !replacingPendingId,
    mobile?: { resourceId: string; valid: () => boolean; authorize: () => Promise<boolean> },
  ) => {
    const id = mobile?.resourceId ?? `ssh:${crypto.randomUUID()}`;
    const approval = authorizeProxy(id, server, undefined, shellIntegration);
    const httpProxyTicketId = approval ? await approval : undefined;
    if (httpProxyTicketId === null) return false;
    if (mobile && !mobile.valid()) throw new Error("Reviewed mobile SSH source changed");
    const restoreId = crypto.randomUUID();
    setTerminals((previous) => [
      ...previous,
      {
        id,
        restoreId,
        name:
          shellIntegration && shellIntegration !== "auto"
            ? `${name} · ${shellIntegration === "powershell" ? "PowerShell 7" : shellIntegration === "zsh" ? "Zsh" : "Bash"}`
            : name,
        server,
        expectedConfigurationDigest,
        shellIntegration,
        httpProxyTicketId,
        startupEligible,
        ...(mobile ? { mobileValid: mobile.valid, mobileAuthorize: mobile.authorize } : {}),
      },
    ]);
    serverTerminalRestoreState.add({ tabId: restoreId, serverId: server.id }, replacingPendingId);
    setActive(id);
    return true;
  };
  const open = async (server: ServerRecord, replacingPendingId?: string) => {
    if (mobileReviewBusy.current) return;
    if (server.metadata.sshInheritance) requestConfigurationReview({ server, replacingPendingId });
    else {
      setCloseError("");
      try {
        await launch(server, replacingPendingId);
      } catch (reason) {
        setCloseError(String(reason));
        // Restore owns its initiating Connect control and retains its row on failure.
        if (replacingPendingId) throw reason;
      }
    }
  };
  return (
    <TerminalContext.Provider
      value={{
        inventoryVisible: visible && !active,
        open,
        forwardAgent: async (server, reviewId) => {
          const id = `ssh-agent:${crypto.randomUUID()}`;
          const approval = authorizeProxy(id, server, undefined, "auto");
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
              shellIntegration: "auto",
              startupEligible: true,
              httpProxyTicketId,
            },
          ]);
          setActive(id);
        },
        quick: async (endpoint, name) => {
          const id = `ssh-quick:${crypto.randomUUID()}`;
          const approval = authorizeProxy(id, undefined, endpoint, "auto");
          const httpProxyTicketId = approval ? await approval : undefined;
          if (httpProxyTicketId === null) return;
          setTerminals((previous) => [
            ...previous,
            {
              id,
              restoreId: crypto.randomUUID(),
              endpoint: { ...endpoint },
              shellIntegration: "auto",
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
        {closeError ? <InlineError className="px-3 py-1">{closeError}</InlineError> : null}
        <div
          id="servers-inventory-content"
          tabIndex={-1}
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
            <div
              {...surfaceAttributes(
                { frame: "stroke", edge: "bottom" },
                "flex h-10 min-w-0 shrink-0 items-center",
              )}
            >
              <Button
                id="servers-inventory-return"
                variant="ghost"
                iconOnly
                label={t("Servers")}
                onClick={() => setActive(null)}
              >
                <ArrowLeft className="icon-sm" />
              </Button>
              <ToolHeader>
                <Text
                  as="div"
                  size="body"
                  tone="inherit"
                  className="flex min-w-0 items-center gap-2 px-3"
                >
                  <Terminal aria-hidden className="icon-sm shrink-0" tone="secondary" />
                  <Text size="inherit" tone="inherit" truncate>
                    {terminals.find((terminal) => terminal.id === active)?.name ??
                      t("SSH terminal")}
                  </Text>
                  <Badge tone="neutral" size="sm">
                    SSH
                  </Badge>
                </Text>
              </ToolHeader>
              {!IS_MAC ? <WindowControls /> : null}
            </div>
            <Tabs
              value={active ?? ""}
              onValueChange={(id) => {
                const next = terminals.find((item) => item.id === id);
                if (!next) return;
                setActive(next.id);
                serverTerminalRestoreState.activate(next.restoreId);
              }}
            >
              <TabList
                {...surfaceAttributes(
                  { frame: "stroke", edge: "bottom", variant: "workspace-panel" },
                  "flex shrink-0 gap-1 overflow-x-auto px-2 py-1",
                )}
                label={t("SSH terminals")}
              >
                {terminals.map((terminal) => (
                  <ActionHost
                    key={terminal.id}
                    selected={active === terminal.id}
                    data-server-terminal-tab
                    className="flex min-w-28 max-w-64 shrink-0 items-center"
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      void requestClose(terminal.id);
                    }}
                  >
                    <Tab
                      value={terminal.id}
                      tone="neutral"
                      fullWidth
                      className="min-w-0 flex-1"
                      tooltip={terminal.name}
                      tooltipWhen="overflow"
                      id={`tab-${terminal.id}`}
                      controls={`panel-${terminal.id}`}
                      onKeyDown={(event) => {
                        if (event.key !== "Delete") return;
                        event.preventDefault();
                        void requestClose(terminal.id);
                      }}
                    >
                      <Terminal aria-hidden className="icon-sm shrink-0" />
                      <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                        {terminal.name}
                      </Text>
                      {!terminal.lifecycle ? (
                        <WorkingIndicator label={t("Opening…")} />
                      ) : terminal.lifecycle === "failed" ? (
                        <StatusBadge status="failed" size="xs" />
                      ) : (
                        <Text tone="muted">
                          {t(
                            terminal.lifecycle === "opened-on-computer"
                              ? "Running"
                              : terminal.lifecycle === "exited"
                                ? "Terminal closed"
                                : "Closed",
                          )}
                        </Text>
                      )}
                    </Tab>
                    <InlineAction
                      reveal="always"
                      motion="none"
                      loading={closing.has(terminal.id)}
                      label={`${t("Close terminal")}: ${terminal.name}`}
                      onClick={() => void requestClose(terminal.id)}
                      onAuxClick={(event) => {
                        if (event.button === 1) {
                          event.preventDefault();
                          void requestClose(terminal.id);
                        }
                      }}
                    >
                      <X className="icon-xs" />
                    </InlineAction>
                  </ActionHost>
                ))}
              </TabList>
            </Tabs>
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
                  <Text as="p" tone="muted" className="shrink-0 break-all px-3 py-2">
                    {t("Identity file")}: {terminal.keyGenerationPath}
                  </Text>
                ) : null}
                <ServerTerminalSession
                  name={terminal.name}
                  lifecycle={terminal.lifecycle}
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
                      onReconnect={
                        terminal.server && !terminal.agentForwardingReviewId
                          ? async () => {
                              // Resolve current policy and request fresh approvals. A reconnect
                              // creates a raw PTY, never reuses input, tickets or startup scripts.
                              const servers = await invoke<ServerRecord[]>("server_inventory_list");
                              const server = servers.find(
                                (item) => item.id === terminal.server!.id,
                              );
                              if (!server) throw new Error(t("Server not found"));
                              if (server.metadata.sshInheritance)
                                requestConfigurationReview({ server, startupEligible: false });
                              else
                                await launch(
                                  server,
                                  undefined,
                                  undefined,
                                  undefined,
                                  server.name,
                                  false,
                                );
                            }
                          : terminal.endpoint
                            ? async () => {
                                const id = `ssh-quick:${crypto.randomUUID()}`;
                                const endpoint = { ...terminal.endpoint! };
                                const approval = authorizeProxy(
                                  id,
                                  undefined,
                                  endpoint,
                                  terminal.shellIntegration,
                                );
                                const httpProxyTicketId = approval ? await approval : undefined;
                                if (httpProxyTicketId === null) return;
                                setTerminals((previous) => [
                                  ...previous,
                                  {
                                    id,
                                    restoreId: crypto.randomUUID(),
                                    name: terminal.name,
                                    endpoint,
                                    shellIntegration: terminal.shellIntegration,
                                    httpProxyTicketId,
                                  },
                                ]);
                                setActive(id);
                              }
                            : undefined
                      }
                      sshConnectionId={terminal.server?.id}
                      canStart={terminal.mobileValid}
                      authorizeStart={terminal.mobileAuthorize}
                      onLifecycle={(state) => {
                        if (mounted.current)
                          setTerminals((previous) =>
                            previous.map((value) =>
                              value.id === terminal.id ? { ...value, lifecycle: state } : value,
                            ),
                          );
                        const entry = mobileResources.current.get(terminal.id);
                        if (!entry) return;
                        entry.state = state;
                        entry.notify(state);
                        if (
                          state === "opened-on-computer" ||
                          state === "failed" ||
                          state === "closed"
                        ) {
                          entry.finishOpen?.(state === "opened-on-computer");
                          entry.finishOpen = undefined;
                        }
                        if (state === "closed") entry.closed?.();
                        if (state === "failed") entry.closeFailed?.();
                      }}
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
                        !terminal.keyGenerationPath &&
                        (!terminal.shellIntegration || terminal.shellIntegration === "auto")
                          ? async (shell = "bash") => {
                              if (terminal.server?.metadata.sshInheritance) {
                                requestConfigurationReview({
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
            onClose={() => {
              configurationReview.mobile?.resolve(false);
              setConfigurationReview(undefined);
            }}
            onConnect={(digest) => {
              const mobile = configurationReview.mobile;
              if (mobile && (digest !== mobile.digest || !mobile.valid())) {
                mobile.resolve(false);
                setConfigurationReview(undefined);
                return;
              }
              void launch(
                configurationReview.server,
                configurationReview.replacingPendingId,
                digest,
                configurationReview.shellIntegration,
                configurationReview.name,
                configurationReview.startupEligible,
                mobile,
              ).then(
                (opened) => mobile?.resolve(opened === true),
                () => mobile?.resolve(false),
              );
              setConfigurationReview(undefined);
            }}
          />
        ) : null}
        <ServerTerminalRestoreControls
          compact={!!active}
          openTabs={terminals.flatMap((terminal) =>
            terminal.server ? [{ tabId: terminal.restoreId, serverId: terminal.server.id }] : [],
          )}
          onConnect={open}
        />
      </div>
    </TerminalContext.Provider>
  );
}

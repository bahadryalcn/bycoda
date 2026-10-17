import { Alert } from "../../shared/ui/Alert";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { t, useLocale } from "../../shared/i18n/technical";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  hostFeatureRequest,
  hostToolRequest,
  listHostToolMachines,
} from "../connections/model/hostFeatureClient";
import {
  hostToolTargetKey,
  targetIsProjectHost,
  type HostToolTarget,
} from "../connections/model/hostToolTarget";
import { isLocalSyncMachine } from "../connections/model/localSync";
import { parseRemotePath } from "../connections/model/remoteProjects";
import type { RemoteMachine } from "../connections/model/protocol";
import { lazySurface } from "../../shared/ui/lazySurface";
import type { DevicePanelApi } from "../devices/types";
import { attachDeviceToComposer } from "../devices/deviceComposer";
import { Gauge, Globe, AppWindow, Terminal, Wrench, RefreshCw } from "../../shared/ui/icons";
import { Popover, type PopoverDismissReason } from "../../shared/ui/Popover";
import { Button } from "../../shared/ui/Button";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import type { OpenFileFn } from "../search/model/search";
import "./host-tools.css";
import { dockHostTools, openHostToolsWindow } from "./ToolsWorkspace";
import { useDockedTools } from "./toolPaneState";
import type { ToolsTab } from "./toolsUiControl";

const DevicePanel = lazySurface(async () => ({
  default: (await import("../devices/DevicePanel")).DevicePanel,
}));
const BrowserPanel = lazySurface(async () => ({
  default: (await import("./BrowserPanel")).BrowserPanel,
}));
const DiagnosticsPanel = lazySurface(async () => ({
  default: (await import("./DiagnosticsPanel")).DiagnosticsPanel,
}));
const DevServersPanel = lazySurface(async () => ({
  default: (await import("./DevServersPanel")).DevServersPanel,
}));
const RuntimeLogsPanel = lazySurface(async () => ({
  default: (await import("./RuntimeLogsPanel")).RuntimeLogsPanel,
}));

type Tab = ToolsTab;
export type ConversationTools = {
  cwd: string;
  sessionId: string;
  title: string;
  composerSessionId?: string;
  composerWindow?: string;
  onOpenFile?: OpenFileFn;
  onlyTab?: "logs";
  onExpand?: () => void;
  hidePresentation?: boolean;
  hideHeading?: boolean;
  initialMachine?: string;
  initialTab?: ToolsTab;
  viewRequest?: { id: string; tab?: ToolsTab; machine?: string };
  onViewChange?: (view: { tab: ToolsTab; machine: string }) => void;
  initialUrl?: string;
  onPresented?: () => void;
};

/** Status bar entry: the panel opens above the button and mounts only while open. */
export function ConversationToolsButton({ tools }: { tools: ConversationTools }) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const docked = useDockedTools(tools);
  const active = open || docked;
  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        ref={trigger}
        type="button"

        aria-label={t("Conversation tools")}
        aria-pressed={active}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("Conversation tools")}
        onClick={() => setOpen((value) => !value)}
      >
        <Wrench className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span className="@max-[40rem]/usage:hidden">{t("Conversation tools")}</span>
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="end"
          gap={7}
          width={expanded ? Math.min(1200, window.innerWidth - 24) : 720}
          maxHeight={expanded ? window.innerHeight - 70 : 680}
          onDismiss={dismiss}
          ignore="select, option, [data-dialog-popover]"
          role="dialog"
          aria-label={t("Conversation tools")}
          className={`flex flex-col text-content ${expanded ? "h-[calc(100dvh-70px)]" : "h-[min(680px,80dvh)]"}`}
        >
          <SessionHostTools
            key={`${tools.cwd}:${tools.sessionId}`}
            {...tools}
            onExpand={() => setExpanded((value) => !value)}
            onPresented={() => setOpen(false)}
          />
        </Popover>
      ) : null}
    </>
  );
}

/** Only the visible tool mounts: closed panes do not own polling or background work. */
export function SessionHostTools(props: ConversationTools) {
  return <ConversationHostTools key={JSON.stringify([props.cwd, props.sessionId])} {...props} />;
}

function ConversationHostTools({
  cwd,
  sessionId,
  title,
  composerSessionId,
  composerWindow,
  onOpenFile,
  onlyTab,
  onExpand,
  hidePresentation,
  hideHeading,
  initialMachine,
  initialTab,
  initialUrl,
  viewRequest,
  onViewChange,
  onPresented,
}: ConversationTools) {
  useLocale();
  const panelId = useId();
  const [tab, setTab] = useState<Tab>(onlyTab ?? initialTab ?? "devices");
  const [presentationError, setPresentationError] = useState("");
  const [placementOpen, setPlacementOpen] = useState(false);
  const placementTrigger = useRef<HTMLButtonElement>(null);
  const hostScoped =
    tab === "devices" || tab === "browser" || tab === "logs" || tab === "resources";
  const conversationKey = JSON.stringify([cwd, sessionId]);
  const [targetValue, setTargetValue] = useState(initialMachine ?? "project");
  useEffect(() => {
    if (!viewRequest) return;
    if (viewRequest.tab !== undefined) setTab(onlyTab ?? viewRequest.tab);
    if (viewRequest.machine !== undefined) setTargetValue(viewRequest.machine);
  }, [viewRequest, onlyTab]);
  useEffect(() => {
    onViewChange?.({ tab, machine: targetValue });
  }, [tab, targetValue, onViewChange]);
  const tools = {
    cwd,
    sessionId,
    title,
    composerSessionId,
    composerWindow,
    onOpenFile,
    initialMachine: targetValue,
    initialTab: tab,
    initialUrl,
  };
  const target = useMemo<HostToolTarget>(
    () =>
      targetValue === "local"
        ? { kind: "local" }
        : targetValue.startsWith("machine:")
          ? { kind: "machine", machineId: targetValue.slice("machine:".length) }
          : { kind: "project" },
    [targetValue],
  );
  const targetKey = hostToolTargetKey(target);
  const present = async (mode: "layout" | "window", logsOnly?: "logs") => {
    setPresentationError("");
    setPlacementOpen(false);
    try {
      if (mode === "layout") dockHostTools(tools, logsOnly);
      else await openHostToolsWindow(tools, logsOnly);
      onPresented?.();
    } catch (cause) {
      setPresentationError(String(cause));
    }
  };
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [machinesError, setMachinesError] = useState("");
  const [machinesRefresh, setMachinesRefresh] = useState(0);
  useEffect(() => {
    if (!hostScoped) return;
    let active = true;
    setMachinesLoading(true);
    setMachinesError("");
    void listHostToolMachines()
      .then(
        (values) => {
          if (active) setMachines(values);
        },
        (cause) => {
          if (active) setMachinesError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        if (active) setMachinesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hostScoped, conversationKey, machinesRefresh]);
  const remote = parseRemotePath(cwd);
  const projectMachine = machines.find((machine) =>
    remote ? machine.environmentId === remote.environmentId : isLocalSyncMachine(machine),
  );
  const ownerLabel = !remote ? t("This computer") : (projectMachine?.name ?? remote.environmentId);
  const selectedMachine =
    target.kind === "machine"
      ? machines.find((machine) => machine.id === target.machineId)
      : undefined;
  const hostLabel =
    target.kind === "project"
      ? ownerLabel
      : target.kind === "local"
        ? t("This computer")
        : (selectedMachine?.name ?? t("Selected machine unavailable"));
  const annotationsAllowed = targetIsProjectHost(cwd, target, machines);
  const api = useMemo<DevicePanelApi>(() => {
    const request = <T,>(method: string, params: Record<string, unknown> = {}) =>
      target.kind === "project"
        ? hostFeatureRequest<T>(cwd, "device.host", `devices.${method}`, params)
        : hostToolRequest<T>(cwd, "device.host", `devices.${method}`, params, target);
    return {
      status: () => request("status"),
      setup: (agentAccess) => request("setup", { agentAccess }),
      start: () => request("start"),
      stop: () => request("stop"),
      list: () => request("list"),
      boot: (deviceId) => request("boot", { deviceId }),
      capture: (deviceId) => request("capture", { deviceId }),
      action: (deviceId, action) => request("action", { deviceId, action }),
    };
  }, [cwd, target]);
  return (
    <div className="host-tools host-tools-docked font-sans" data-active-tool={tab}>
      <section aria-label={t("Conversation tools")} className="host-tools-section">
        <div className="host-tools-topbar">
          {!hideHeading ? (
            <header className="host-tools-heading">
              <Wrench className="size-4 shrink-0" aria-hidden />
              <strong>{onlyTab ? t("Logs") : t("Conversation tools")}</strong>
              <span className="host-tools-context" title={`${title}\n${cwd}`}>
                {title}
              </span>
              {!hidePresentation ? (
                <Button
                  variant="ghost"
                  ref={placementTrigger}
                  type="button"
                  className="host-tools-placement-trigger"
                  aria-haspopup="menu"
                  aria-expanded={placementOpen}
                  onClick={() => setPlacementOpen((value) => !value)}
                >
                  {t("Panel placement")}
                </Button>
              ) : null}
            </header>
          ) : null}
          {placementOpen && !hidePresentation ? (
            <DropdownMenu
              anchor={placementTrigger}
              label={t("Panel placement")}
              returnFocusRef={placementTrigger}
              align="end"
              width={250}
              onClose={() => setPlacementOpen(false)}
              onPick={(id) => {
                if (id === "expand") onExpand?.();
                else if (id === "layout") void present("layout", onlyTab);
                else if (id === "layout-logs") void present("layout", "logs");
                else if (id === "window") void present("window", onlyTab);
                else if (id === "window-logs") void present("window", "logs");
              }}
              items={[
                ...(onExpand
                  ? [{ kind: "item" as const, id: "expand", label: t("Expand / restore") }]
                  : []),
                { kind: "item", id: "layout", label: t("Place in layout") },
                ...(tab === "logs" && !onlyTab
                  ? [{ kind: "item" as const, id: "layout-logs", label: t("Separate Logs panel") }]
                  : []),
                { kind: "item", id: "window", label: t("Open in new window") },
                ...(tab === "logs" && !onlyTab
                  ? [{ kind: "item" as const, id: "window-logs", label: t("Logs in new window") }]
                  : []),
              ]}
            />
          ) : null}
          {presentationError ? (
            <Alert tone="danger" role="alert">
              {presentationError}
            </Alert>
          ) : null}
          {!onlyTab ? (
            <nav
              role="tablist"
              aria-label={t("Conversation tool selection")}
              className="host-tools-tabs"
            >
              {(onlyTab
                ? [onlyTab]
                : (["devices", "browser", "servers", "logs", "resources"] as const)
              ).map((id, index, tabs) => {
                const Icon = {
                  devices: AppWindow,
                  browser: Globe,
                  servers: Wrench,
                  logs: Terminal,
                  resources: Gauge,
                }[id];
                return (
                  <Button
                    variant="tab"
                    motion="none"
                    key={id}
                    id={`${panelId}-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    title={t(
                      {
                        devices: "Devices",
                        browser: "Host browser",
                        servers: "Development servers",
                        logs: "Logs",
                        resources: "Resource usage",
                      }[id],
                    )}
                    aria-controls={`${panelId}-panel`}
                    tabIndex={tab === id ? 0 : -1}
                    onClick={() => setTab(id)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % tabs.length
                          : event.key === "ArrowLeft"
                            ? (index + tabs.length - 1) % tabs.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? tabs.length - 1
                                : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      setTab(tabs[next]);
                      document.getElementById(`${panelId}-${tabs[next]}`)?.focus();
                    }}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="host-tools-tab-label">
                      {t(
                        {
                          devices: "Devices",
                          browser: "Host browser",
                          servers: "Development servers",
                          logs: "Logs",
                          resources: "Resource usage",
                        }[id],
                      )}
                    </span>
                  </Button>
                );
              })}
            </nav>
          ) : null}
          {hostScoped ? (
            <div className="host-tools-machine" aria-busy={machinesLoading}>
              <div className="host-tool-toolbar host-tools-machine-toolbar">
                <div className="host-tool-field host-tools-machine-field">
                  <span>{t("Tool machine")}</span>
                  <SearchableSelect
                    label={t("Tool machine")}
                    value={targetValue}
                    onChange={setTargetValue}
                    searchable={machines.length > 5}
                    options={[
                      { value: "project", label: `${t("Project host")} · ${ownerLabel}` },
                      { value: "local", label: t("This computer") },
                      ...machines
                        .filter((machine) => !isLocalSyncMachine(machine))
                        .map((machine) => ({
                          value: `machine:${machine.id}`,
                          label: machine.name,
                        })),
                      ...(target.kind === "machine" && !selectedMachine
                        ? [
                            {
                              value: targetValue,
                              label: `${t("Selected machine unavailable")} · ${target.machineId}`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <Button
                  variant="ghost"
                  iconOnly
                  label={machinesError ? t("Retry") : t("Refresh")}
                  className="host-tools-machine-refresh"
                  disabled={machinesLoading}
                  onClick={() => setMachinesRefresh((value) => value + 1)}
                >
                  <RefreshCw size={16} aria-hidden />
                </Button>
              </div>
              {machinesError ? (
                <Alert tone="danger" role="alert">
                  {machinesError}
                </Alert>
              ) : null}
              {target.kind === "machine" && !selectedMachine && !machinesLoading ? (
                <Alert tone="danger" role="alert">
                  {t("Selected machine unavailable")}
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
        <div
          id={`${panelId}-panel`}
          role="tabpanel"
          aria-labelledby={onlyTab ? undefined : `${panelId}-${tab}`}
          aria-label={onlyTab ? t("Logs") : undefined}
          className={`host-tools-content${tab === "devices" ? " host-tools-content-devices" : tab === "browser" ? " host-tools-content-browser" : ""}`}
          tabIndex={0}
        >
          {tab === "devices" ? (
            <DevicePanel
              key={JSON.stringify([cwd, sessionId, targetKey])}
              api={api}
              hostLabel={hostLabel}
              onAddDevice={(device) =>
                attachDeviceToComposer(
                  cwd,
                  composerSessionId ?? sessionId,
                  device,
                  { label: hostLabel, target },
                  composerWindow,
                )
              }
            />
          ) : null}
          {tab === "browser" ? (
            <BrowserPanel
              cwd={cwd}
              initialUrl={target.kind === "project" ? initialUrl : undefined}
              sessionId={sessionId}
              composerSessionId={composerSessionId ?? sessionId}
              composerWindow={composerWindow}
              hostTarget={target}
              annotationsAllowed={annotationsAllowed && !!sessionId}
              hostLabel={hostLabel}
            />
          ) : null}
          {tab === "servers" ? <DevServersPanel key={cwd} cwd={cwd} /> : null}
          {tab === "logs" ? (
            <RuntimeLogsPanel
              key={JSON.stringify([cwd, sessionId, targetKey])}
              cwd={cwd}
              sessionId={sessionId}
              composerSessionId={composerSessionId ?? sessionId}
              target={target}
              composerWindow={composerWindow}
              hostLabel={hostLabel}
              onOpenFile={target.kind === "project" ? onOpenFile : undefined}
            />
          ) : null}
          {tab === "resources" ? (
            <DiagnosticsPanel cwd={cwd} hostTarget={target} hostLabel={hostLabel} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

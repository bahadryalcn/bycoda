import { Alert } from "../../shared/ui/Alert";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { t, useLocale } from "../../shared/i18n/technical";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
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
import { attachDeviceImageAcrossWindows } from "../devices/deviceImageComposer";
import {
  Gauge,
  Globe,
  AppWindow,
  Terminal,
  Server,
  PanelRight,
  RefreshCw,
  Folder,
  ChevronDown,
} from "../../shared/ui/icons";
import { Button } from "../../shared/ui/Button";
import { Tab, TabList, Tabs } from "../../shared/ui/Tabs";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import type { OpenFileFn } from "../search/model/search";
import "./host-tools.css";
import { dockHostTools, openHostToolsWindow } from "./ToolsWorkspace";
import type { ToolsTab } from "./toolsUiControl";

function ToolMounted({ onMounted }: { onMounted?: () => void }) {
  useEffect(() => {
    onMounted?.();
  }, [onMounted]);
  return null;
}
function toolSurface<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>) {
  return lazySurface(async () => {
    const { default: Panel } = await load();
    return {
      default: ({ onMounted, ...props }: Props & { onMounted?: () => void }) => (
        <>
          <Panel {...(props as Props)} />
          <ToolMounted onMounted={onMounted} />
        </>
      ),
    };
  });
}

const DevicePanel = toolSurface(async () => ({
  default: (await import("../devices/DevicePanel")).DevicePanel,
}));
const BrowserPanel = toolSurface(async () => ({
  default: (await import("./BrowserPanel")).BrowserPanel,
}));
const DiagnosticsPanel = toolSurface(async () => ({
  default: (await import("./DiagnosticsPanel")).DiagnosticsPanel,
}));
const DevServersPanel = toolSurface(async () => ({
  default: (await import("./DevServersPanel")).DevServersPanel,
}));
const RuntimeLogsPanel = toolSurface(async () => ({
  default: (await import("./RuntimeLogsPanel")).RuntimeLogsPanel,
}));

type Tab = ToolsTab;
export type ConversationTools = {
  cwd: string;
  sessionId: string;
  title: string;
  projectName?: string;
  branch?: string;
  worktreeCwd?: string;
  model?: string;
  status?: string;
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
  /** Presentation visibility, independent of retained component/draft ownership. */
  active?: boolean;
  onMounted?: (view: { tab: ToolsTab; machine: string }) => void;
};

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
  active = true,
  onMounted,
}: ConversationTools) {
  useLocale();
  const panelId = useId();
  const [tab, setTab] = useState<Tab>(onlyTab ?? initialTab ?? "devices");
  const [visited, setVisited] = useState<Tab[]>([onlyTab ?? initialTab ?? "devices"]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  const [presentationError, setPresentationError] = useState("");
  const [placementOpen, setPlacementOpen] = useState(false);
  const placementTrigger = useRef<HTMLButtonElement>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const toolMenuTrigger = useRef<HTMLButtonElement>(null);
  const toolLabels = {
    devices: "Devices",
    browser: "Host browser",
    servers: "Development servers",
    logs: "Logs",
    resources: "Resource usage",
  } as const;
  const toolIcons = {
    devices: AppWindow,
    browser: Globe,
    servers: Server,
    logs: Terminal,
    resources: Gauge,
  } as const;
  const toolOrder = ["devices", "browser", "servers", "logs", "resources"] as const;
  const hostScoped =
    tab === "devices" || tab === "browser" || tab === "logs" || tab === "resources";
  const conversationKey = JSON.stringify([cwd, sessionId]);
  const [targetValue, setTargetValue] = useState(initialMachine ?? "project");
  // The parent keeps the last view it was told about, so tell it after user choices
  // (here) and after a view request or the first render (effect below).
  const selectTab = (next: Tab) => {
    setTab(next);
    onViewChange?.({ tab: next, machine: targetValue });
  };
  const selectTarget = (next: string) => {
    setTargetValue(next);
    onViewChange?.({ tab, machine: next });
  };
  const [appliedRequest, setAppliedRequest] = useState<string>();
  if (viewRequest && viewRequest.id !== appliedRequest) {
    setAppliedRequest(viewRequest.id);
    if (viewRequest.tab !== undefined) setTab(onlyTab ?? viewRequest.tab);
    if (viewRequest.machine !== undefined) setTargetValue(viewRequest.machine);
  }
  useEffect(() => {
    onViewChange?.({ tab, machine: targetValue });
    // Reports the starting view and each applied request; user choices report themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRequest]);
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
  const transferScope = useMemo(
    () => ({ cwd, sessionId, targetValue: targetKey }),
    [cwd, sessionId, targetKey],
  );
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
    if (!hostScoped || !active) return;
    let alive = true;
    setMachinesLoading(true);
    setMachinesError("");
    void listHostToolMachines()
      .then(
        (values) => {
          if (alive) setMachines(values);
        },
        (cause) => {
          if (alive) setMachinesError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        if (alive) setMachinesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hostScoped, conversationKey, machinesRefresh, active]);
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
      controlStatus: (deviceId) => request("control.status", { deviceId }),
      claimControl: (deviceId, requestId) => request("control.claim", { deviceId, requestId }),
      releaseControl: (deviceId, leaseId) => request("control.release", { deviceId, leaseId }),
      renewControl: (deviceId, leaseId) => request("control.renew", { deviceId, leaseId }),
      inspect: (deviceId, leaseId) => request("inspect", { deviceId, leaseId }),
      action: (deviceId, action, leaseId) =>
        request("action", { deviceId, action, leaseId, requestId: crypto.randomUUID() }),
    };
  }, [cwd, target]);
  return (
    <div className="host-tools host-tools-docked font-sans" data-active-tool={tab}>
      <section aria-label={t("Conversation tools")} className="host-tools-section">
        <div className="host-tools-topbar">
          {!onlyTab ? (
            <Tabs
              value={tab}
              onValueChange={(next) => selectTab(next as Tab)}
              id={panelId}
              panels="shared"
            >
              <TabList label={t("Conversation tool selection")} className="host-tools-nav">
                {toolOrder.map((id) => {
                  const Icon = toolIcons[id];
                  return (
                    <Tab
                      key={id}
                      value={id}
                      aria-label={t(toolLabels[id])}
                      tooltip={t(toolLabels[id])}
                      tooltipWhen="overflow"
                      icon={<Icon className="icon-sm" aria-hidden />}
                      className="host-tools-nav-tab"
                    >
                      {t(toolLabels[id])}
                    </Tab>
                  );
                })}
              </TabList>
            </Tabs>
          ) : (
            <span className="host-tools-current-tool">{t("Logs")}</span>
          )}
          {!onlyTab ? (
            // Narrow panes swap the tab strip for one named selector that shows the
            // current tool; the tablist above returns when the pane has room.
            <div className="host-tools-compact-selector">
              <Button
                ref={toolMenuTrigger}
                variant="ghost"
                size="sm"
                label={t("Conversation tool selection")}
                tooltip={t("Conversation tool selection")}
                aria-haspopup="menu"
                aria-expanded={toolMenuOpen}
                className="host-tools-compact-trigger"
                onClick={() => setToolMenuOpen((value) => !value)}
              >
                {(() => {
                  const Icon = toolIcons[tab];
                  return <Icon className="icon-sm" aria-hidden />;
                })()}
                <span className="host-tools-nav-label">{t(toolLabels[tab])}</span>
                <ChevronDown className="icon-sm" aria-hidden />
              </Button>
              {toolMenuOpen ? (
                <DropdownMenu
                  anchor={toolMenuTrigger}
                  label={t("Conversation tool selection")}
                  returnFocusRef={toolMenuTrigger}
                  align="start"
                  width={240}
                  onClose={() => setToolMenuOpen(false)}
                  onPick={(id) => {
                    selectTab(id as Tab);
                    setToolMenuOpen(false);
                  }}
                  items={toolOrder.map((id) => {
                    const Icon = toolIcons[id];
                    return {
                      kind: "item" as const,
                      id,
                      label: t(toolLabels[id]),
                      icon: <Icon className="icon-sm" aria-hidden />,
                      checked: id === tab,
                      selectionRole: "radio" as const,
                    };
                  })}
                />
              ) : null}
            </div>
          ) : null}
          {/* Stable context: which computer the tool talks to and which
              workspace it belongs to, in the tab row's trailing slot. */}
          <div className="host-tools-contextbar" data-target-kind={target.kind}>
            {hostScoped ? (
              <div className="host-tools-machine" aria-busy={machinesLoading}>
                <div className="host-tool-toolbar host-tools-machine-toolbar">
                  <div className="host-tool-field host-tools-machine-field">
                    <SearchableSelect
                      label={t("Tool machine")}
                      variant="row"
                      triggerProps={{ title: `${hostLabel}\n${title}\n${cwd}` }}
                      value={targetValue}
                      onChange={selectTarget}
                      searchable={machines.length > 5}
                      options={[
                        { value: "project", label: ownerLabel, description: t("Project host") },
                        {
                          value: "local",
                          label: t("This computer"),
                          description: remote ? undefined : t("Local app"),
                        },
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
                    size="sm"
                    iconOnly
                    label={machinesError ? t("Retry") : t("Refresh")}
                    tooltip={machinesError ? t("Retry") : t("Refresh")}
                    className="host-tools-machine-refresh"
                    loading={machinesLoading}
                    disabled={machinesLoading}
                    onClick={() => setMachinesRefresh((value) => value + 1)}
                  >
                    <RefreshCw className="icon-sm" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : (
              <span className="host-tools-host" title={`${ownerLabel}\n${cwd}`}>
                <Server className="icon-sm" aria-hidden />
                <span className="host-tools-host-name">{ownerLabel}</span>
                <span className="host-tools-host-role">{t("Project host")}</span>
              </span>
            )}
            {!hideHeading ? (
              <span className="host-tools-context" title={`${title}\n${cwd}`}>
                <Folder className="icon-sm" aria-hidden />
                <span className="host-tools-context-name">{title}</span>
              </span>
            ) : null}
          </div>
          {!hidePresentation ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              label={t("Panel placement")}
              tooltip={t("Panel placement")}
              ref={placementTrigger}
              className="host-tools-placement-trigger"
              aria-haspopup="menu"
              aria-expanded={placementOpen}
              onClick={() => setPlacementOpen((value) => !value)}
            >
              <PanelRight className="icon-sm" aria-hidden />
            </Button>
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
        </div>
        {presentationError ? (
          <Alert tone="danger" role="alert">
            {presentationError}
          </Alert>
        ) : null}
        {hostScoped && machinesError ? (
          <Alert tone="danger" role="alert">
            {machinesError}
          </Alert>
        ) : null}
        {hostScoped && target.kind === "machine" && !selectedMachine && !machinesLoading ? (
          <Alert tone="danger" role="alert">
            {t("Selected machine unavailable")}
          </Alert>
        ) : null}
        <div
          id={`${panelId}-panel`}
          role="tabpanel"
          aria-labelledby={onlyTab ? undefined : `${panelId}-tab-${tab}`}
          aria-label={onlyTab ? t(toolLabels[tab]) : undefined}
          className={`host-tools-content host-tools-content-${tab}`}
          tabIndex={0}
        >
          {visited.includes("devices") ? (
            <div style={{ display: tab === "devices" ? "contents" : "none" }}>
              <DevicePanel
                transferScope={transferScope}
                onMounted={() => onMounted?.({ tab: "devices", machine: targetValue })}
                active={active && tab === "devices"}
                draftScope={JSON.stringify([cwd, composerSessionId ?? sessionId, targetKey])}
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
                onAddImage={(device, frame, comment, operation) =>
                  attachDeviceImageAcrossWindows(
                    cwd,
                    composerSessionId ?? sessionId,
                    { device, computer: { label: hostLabel, target }, frame, comment },
                    composerWindow,
                    operation,
                  )
                }
              />
            </div>
          ) : null}
          {visited.includes("browser") ? (
            <div style={{ display: tab === "browser" ? "contents" : "none" }}>
              <BrowserPanel
                onMounted={() => onMounted?.({ tab: "browser", machine: targetValue })}
                active={active && tab === "browser"}
                cwd={cwd}
                initialUrl={target.kind === "project" ? initialUrl : undefined}
                sessionId={sessionId}
                composerSessionId={composerSessionId ?? sessionId}
                composerWindow={composerWindow}
                hostTarget={target}
                annotationsAllowed={annotationsAllowed && !!sessionId}
                hostLabel={hostLabel}
              />
            </div>
          ) : null}
          {visited.includes("servers") ? (
            <div style={{ display: tab === "servers" ? "contents" : "none" }}>
              <DevServersPanel
                transferScope={transferScope}
                onMounted={() => onMounted?.({ tab: "servers", machine: targetValue })}
                active={active && tab === "servers"}
                key={cwd}
                cwd={cwd}
              />
            </div>
          ) : null}
          {visited.includes("logs") ? (
            <div style={{ display: tab === "logs" ? "contents" : "none" }}>
              <RuntimeLogsPanel
                transferScope={transferScope}
                onMounted={() => onMounted?.({ tab: "logs", machine: targetValue })}
                active={active && tab === "logs"}
                key={JSON.stringify([cwd, sessionId, targetKey])}
                cwd={cwd}
                sessionId={sessionId}
                composerSessionId={composerSessionId ?? sessionId}
                target={target}
                composerWindow={composerWindow}
                hostLabel={hostLabel}
                onOpenFile={target.kind === "project" ? onOpenFile : undefined}
              />
            </div>
          ) : null}
          {visited.includes("resources") ? (
            <div style={{ display: tab === "resources" ? "contents" : "none" }}>
              <DiagnosticsPanel
                transferScope={transferScope}
                onMounted={() => onMounted?.({ tab: "resources", machine: targetValue })}
                active={active && tab === "resources"}
                cwd={cwd}
                hostTarget={target}
                hostLabel={hostLabel}
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

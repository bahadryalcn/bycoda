import { errorText } from "../../shared/lib/errors";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Alert } from "../../shared/ui/Alert";
import { useConnectionErrorShownCentrally } from "../../shared/ui/connectionErrorGate";
import { Text } from "../../shared/ui/Text";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { t, useLocale } from "../../shared/i18n/technical";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import {
  hostFeatureRequest,
  hostToolRequest,
  listHostToolMachines,
  subscribeDeviceVideo,
  deviceTouchAvailable,
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
import type { DeviceHostStatus, DevicePanelApi } from "../devices/types";
import { attachDeviceToComposer } from "../devices/deviceComposer";
import { attachDeviceImageAcrossWindows } from "../devices/deviceImageComposer";
import {
  Gauge,
  Globe,
  AppWindow,
  Terminal,
  Server,
  Laptop,
  PanelRight,
  RefreshCw,
  Folder,
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
  /** Immutable presentation request; `url` navigates the project Host Browser once. */
  viewRequest?: { id: string; tab?: ToolsTab; machine?: string; url?: string };
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
  const [navigation, setNavigation] = useState<{ id: string; url: string }>();
  if (viewRequest && viewRequest.id !== appliedRequest) {
    setAppliedRequest(viewRequest.id);
    if (viewRequest.tab !== undefined) setTab(onlyTab ?? viewRequest.tab);
    if (viewRequest.machine !== undefined) setTargetValue(viewRequest.machine);
    if (viewRequest.url !== undefined) setNavigation({ id: viewRequest.id, url: viewRequest.url });
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
  const machinesShownCentrally = useConnectionErrorShownCentrally(machinesError);
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
          if (alive) setMachinesError(errorText(cause));
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
    const statusWithTouch = async (method: string, params?: Record<string, unknown>) => {
      const status = await request<DeviceHostStatus>(method, params);
      if (
        status.running &&
        ["win32", "darwin"].includes(status.platform) &&
        status.platforms.some((entry) => entry.platform === "android" && entry.available) &&
        (await deviceTouchAvailable(cwd, target).catch(() => false))
      )
        return { ...status, touchProtocol: 1 as const };
      return status;
    };
    return {
      environmentId:
        target.kind === "machine" ? target.machineId : parseRemotePath(cwd)?.environmentId,
      status: () => statusWithTouch("status"),
      setup: (agentAccess) => statusWithTouch("setup", { agentAccess }),
      start: () => statusWithTouch("start"),
      stop: () => statusWithTouch("stop"),
      list: () => request("list"),
      boot: (deviceId) => request("boot", { deviceId }),
      capture: (deviceId) => request("capture", { deviceId }),
      stream: (deviceId, cursor) =>
        request("stream", cursor === undefined ? { deviceId } : { deviceId, cursor }),
      subscribeStream: (deviceId, onChunk, onError) =>
        subscribeDeviceVideo(cwd, target, deviceId, onChunk, onError),
      touch: async (deviceId, touch, leaseId) => {
        await request("touch", { deviceId, touch, leaseId });
      },
      controlStatus: (deviceId) => request("control.status", { deviceId }),
      claimControl: (deviceId, requestId) => request("control.claim", { deviceId, requestId }),
      releaseControl: (deviceId, leaseId) => request("control.release", { deviceId, leaseId }),
      renewControl: (deviceId, leaseId) => request("control.renew", { deviceId, leaseId }),
      inspect: (deviceId, leaseId) => request("inspect", { deviceId, leaseId }),
      action: (deviceId, action, leaseId) =>
        request("action", { deviceId, action, leaseId, requestId: crypto.randomUUID() }),
    };
  }, [cwd, target]);
  // Keep an explicitly opened local view on its original target.
  const explicitLocalProjectView = !remote && target.kind === "local";
  const renderMachinePicker = (inSetup = false) => (
    <SearchableSelect
      hideLabel
      label={t("Tool machine")}
      tooltip={{ label: hostLabel, details: [title, cwd], wide: true }}
      value={targetValue}
      onChange={selectTarget}
      searchable={machines.length > 5}
      align="end"
      renderTrigger={({ props, open, selectedLabel }) => (
        <Button
          {...props}
          variant={inSetup ? "secondary" : "ghost"}
          size="sm"
          className={inSetup ? undefined : "host-tools-machine-trigger"}
          expanded={open}
          startIcon={
            target.kind === "local" || (target.kind === "project" && !remote) ? (
              <Laptop className="icon-sm" aria-hidden />
            ) : (
              <Server className="icon-sm" aria-hidden />
            )
          }
        >
          <Text size="inherit" tone="inherit" leading="inherit" truncate>
            {selectedLabel ?? hostLabel}
          </Text>
        </Button>
      )}
      footer={
        <Button
          variant="ghost"
          size="sm"
          startIcon={<RefreshCw className="icon-sm" aria-hidden />}
          loading={machinesLoading}
          disabled={machinesLoading}
          onClick={() => setMachinesRefresh((value) => value + 1)}
        >
          {machinesError && !machinesShownCentrally ? t("Retry") : t("Refresh machines")}
        </Button>
      }
      options={[
        {
          value: explicitLocalProjectView ? "local" : "project",
          label: ownerLabel,
          description: explicitLocalProjectView ? undefined : t("Project host"),
        },
        ...(remote ? [{ value: "local", label: t("This computer") }] : []),
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
  );
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
            <Text
              size="secondary"
              tone="inherit"
              weight="medium"
              leading="inherit"
              truncate
              className="host-tools-current-tool"
            >
              {t("Logs")}
            </Text>
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
                expanded={toolMenuOpen}
                className="host-tools-compact-trigger"
                onClick={() => setToolMenuOpen((value) => !value)}
              >
                {(() => {
                  const Icon = toolIcons[tab];
                  return <Icon className="icon-sm" aria-hidden />;
                })()}
                <Text
                  size="inherit"
                  tone="inherit"
                  leading="inherit"
                  truncate
                  className="host-tools-nav-label"
                >
                  {t(toolLabels[tab])}
                </Text>
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
          <Text
            size="caption"
            tone="secondary"
            leading="inherit"
            as="div"
            className="host-tools-contextbar"
            data-target-kind={target.kind}
          >
            {hostScoped ? (
              <div className="host-tools-machine" aria-busy={machinesLoading}>
                {/* A ghost trigger like the tool tabs beside it; refreshing the machine list
                    lives in the menu instead of a second loose icon in the row. */}
                {renderMachinePicker()}
              </div>
            ) : (
              <Tooltip label={`${ownerLabel}\n${cwd}`} asChild>
                <span className="host-tools-host">
                  <Server className="icon-sm" aria-hidden />
                  <Text size="inherit" tone="primary" truncate className="host-tools-host-name">
                    {ownerLabel}
                  </Text>
                  <Text size="inherit" className="host-tools-host-role">
                    {t("Project host")}
                  </Text>
                </span>
              </Tooltip>
            )}
            {!hideHeading ? (
              <Tooltip label={`${title}\n${cwd}`} asChild>
                <span className="host-tools-context">
                  <Folder className="icon-sm" aria-hidden />
                  <Text size="inherit" tone="primary" truncate className="host-tools-context-name">
                    {title}
                  </Text>
                </span>
              </Tooltip>
            ) : null}
          </Text>
          {!hidePresentation ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              label={t("Panel placement")}
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
        {presentationError ? <Alert tone="danger">{presentationError}</Alert> : null}
        {hostScoped && machinesError && !machinesShownCentrally ? (
          <Alert tone="danger">{machinesError}</Alert>
        ) : null}
        {hostScoped && target.kind === "machine" && !selectedMachine && !machinesLoading ? (
          <Alert tone="danger">{t("Selected machine unavailable")}</Alert>
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
            <div className={tab === "devices" ? "contents" : "hidden"}>
              <DevicePanel
                transferScope={transferScope}
                onMounted={() => onMounted?.({ tab: "devices", machine: targetValue })}
                active={active && tab === "devices"}
                draftScope={JSON.stringify([cwd, composerSessionId ?? sessionId, targetKey])}
                key={JSON.stringify([cwd, sessionId, targetKey])}
                api={api}
                hostLabel={hostLabel}
                machinePicker={renderMachinePicker(true)}
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
            <div className={tab === "browser" ? "contents" : "hidden"}>
              <BrowserPanel
                onMounted={() => onMounted?.({ tab: "browser", machine: targetValue })}
                active={active && tab === "browser"}
                cwd={cwd}
                initialUrl={target.kind === "project" ? initialUrl : undefined}
                navigation={target.kind === "project" ? navigation : undefined}
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
            <div className={tab === "servers" ? "contents" : "hidden"}>
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
            <div className={tab === "logs" ? "contents" : "hidden"}>
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
            <div className={tab === "resources" ? "contents" : "hidden"}>
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

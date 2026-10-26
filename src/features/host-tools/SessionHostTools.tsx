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
import { attachDeviceImageAcrossWindows } from "../devices/deviceImageComposer";
import {
  Gauge,
  Globe,
  AppWindow,
  Terminal,
  ChevronDown,
  Server,
  PanelRight,
  RefreshCw,
} from "../../shared/ui/icons";
import { Button } from "../../shared/ui/Button";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import type { OpenFileFn } from "../search/model/search";
import "./host-tools.css";
import { dockHostTools, openHostToolsWindow } from "./ToolsWorkspace";
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
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const toolMenuTrigger = useRef<HTMLButtonElement>(null);
  const toolLabels = {
    devices: "Devices",
    browser: "Host browser",
    servers: "Development servers",
    logs: "Logs",
    resources: "Resource usage",
  } as const;
  const ToolIcon = {
    devices: AppWindow,
    browser: Globe,
    servers: Server,
    logs: Terminal,
    resources: Gauge,
  }[tab];
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
          {hostScoped ? (
            <div className="host-tools-machine" aria-busy={machinesLoading}>
              <div className="host-tool-toolbar host-tools-machine-toolbar">
                <div className="host-tool-field host-tools-machine-field">
                  <SearchableSelect
                    label={t("Tool machine")}
                    variant="transparent"
                    triggerProps={{ title: `${hostLabel}\n${title}\n${cwd}` }}
                    value={targetValue}
                    onChange={setTargetValue}
                    searchable={machines.length > 5}
                    options={[
                      { value: "project", label: ownerLabel, description: t("Project host") },
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
                  tooltip={machinesError ? t("Retry") : t("Refresh")}
                  className="host-tools-machine-refresh"
                  loading={machinesLoading}
                  disabled={machinesLoading}
                  onClick={() => setMachinesRefresh((value) => value + 1)}
                >
                  <RefreshCw className="icon-md" aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <span className="host-tools-context" title={`${title}\n${cwd}`}>
              {!hideHeading ? title : null}
            </span>
          )}
          {!onlyTab ? (
            <>
              <Button
                variant="ghost"
                ref={toolMenuTrigger}
                className="host-tools-tool-picker"
                aria-label={t("Conversation tool selection")}
                tooltip={`${t("Conversation tool selection")}: ${t(toolLabels[tab])}`}
                aria-haspopup="menu"
                aria-expanded={toolMenuOpen}
                onClick={() => setToolMenuOpen((value) => !value)}
              >
                <ToolIcon className="icon-md" aria-hidden />
                <span className="host-tools-current-tool">{t(toolLabels[tab])}</span>
                <ChevronDown className="icon-sm" aria-hidden />
              </Button>
              {toolMenuOpen ? (
                <DropdownMenu
                  anchor={toolMenuTrigger}
                  label={t("Conversation tool selection")}
                  returnFocusRef={toolMenuTrigger}
                  align="end"
                  onClose={() => setToolMenuOpen(false)}
                  onPick={(id) => {
                    setToolMenuOpen(false);
                    setTab(id as Tab);
                  }}
                  items={(["devices", "browser", "servers", "logs", "resources"] as const).map(
                    (id) => ({
                      kind: "item" as const,
                      id,
                      label: t(toolLabels[id]),
                      checked: id === tab,
                      selectionRole: "radio" as const,
                    }),
                  )}
                />
              ) : null}
            </>
          ) : (
            <span className="host-tools-current-tool">{t("Logs")}</span>
          )}
          {!hidePresentation ? (
            <Button
              variant="ghost"
              iconOnly
              label={t("Panel placement")}
              tooltip={t("Panel placement")}
              ref={placementTrigger}
              className="host-tools-placement-trigger"
              aria-haspopup="menu"
              aria-expanded={placementOpen}
              onClick={() => setPlacementOpen((value) => !value)}
            >
              <PanelRight className="icon-md" aria-hidden />
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
          aria-label={t(toolLabels[tab])}
          className={`host-tools-content${tab === "devices" ? " host-tools-content-devices" : tab === "browser" ? " host-tools-content-browser" : ""}`}
          tabIndex={0}
        >
          {tab === "devices" ? (
            <DevicePanel
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
              onAddImage={(device, frame, comment) =>
                attachDeviceImageAcrossWindows(
                  cwd,
                  composerSessionId ?? sessionId,
                  { device, computer: { label: hostLabel, target }, frame, comment },
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

import { invoke } from "@tauri-apps/api/core";
import { backgroundMachineFor, hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { remoteRequest } from "./connections";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";
import type { RemoteMachine } from "./protocol";
import {
  dedupeHostToolMachines,
  hostToolTargetKey,
  targetIsProjectHost,
  type HostToolTarget,
} from "./hostToolTarget";

type ResolvedHost = { machine: RemoteMachine; projectId: string };

/** Resolving a local project may spawn the host launcher, so one answer per
 * project is shared by every tool request. Failures are never kept. */
const resolved = new Map<string, Promise<ResolvedHost>>();
const toolHosts = new Map<string, Promise<RemoteMachine>>();

export function invalidateFeatureHosts() {
  resolved.clear();
  toolHosts.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("bycoda:remote-machines", invalidateFeatureHosts);
  subscribeRemoteRecovered(invalidateFeatureHosts);
}

async function resolveHost(cwd: string): Promise<ResolvedHost> {
  // A local project belongs to the host running on this computer now; an older
  // saved local link may point at a previous host that lacks newer features.
  let machine = parseRemotePath(cwd)
    ? undefined
    : ((await invoke<RemoteMachine | null>("local_host_connect").catch(() => null)) ?? undefined);
  if (!machine) {
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    machine = backgroundMachineFor(machines, cwd);
  }
  if (!machine) throw new Error("This project's machine is not connected.");
  const project = await hostProjectFor(machine, cwd);
  return { machine, projectId: project.id };
}

/** Resolve only the owning machine. Missing remote access must never fall back locally. */
export async function featureHost(cwd: string, capability: string) {
  if (!cwd.trim()) throw new Error("Choose a project before opening host tools.");
  let pending = resolved.get(cwd);
  if (!pending) {
    pending = resolveHost(cwd);
    resolved.set(cwd, pending);
    pending.catch(() => {
      if (resolved.get(cwd) === pending) resolved.delete(cwd);
    });
  }
  const host = await pending;
  const capabilities = await machineCapabilities(host.machine);
  if (!capabilities.includes(capability))
    throw new Error("Update bycoda Host on this project's machine to use this feature.");
  return host;
}

export async function hostFeatureRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { machine, projectId } = await featureHost(cwd, capability);
  try {
    return await remoteRequest<T>(machine.id, method, { ...params, projectId });
  } catch (error) {
    // A removed project or replaced machine must be resolved again next time.
    resolved.delete(cwd);
    throw error;
  }
}

/** The current desktop host and saved remote hosts, without opening a project. */
export async function listHostToolMachines(): Promise<RemoteMachine[]> {
  const [local, saved] = await Promise.all([
    invoke<RemoteMachine | null>("local_host_connect").catch(() => null),
    invoke<RemoteMachine[]>("remote_machines"),
  ]);
  return dedupeHostToolMachines(local, Array.isArray(saved) ? saved : []);
}

async function explicitToolHost(target: Exclude<HostToolTarget, { kind: "project" }>) {
  const key = hostToolTargetKey(target);
  let pending = toolHosts.get(key);
  if (!pending) {
    pending = (async () => {
      if (target.kind === "local") {
        const machine = await invoke<RemoteMachine | null>("local_host_connect");
        if (!machine) throw new Error("This computer's bycoda Host is not connected.");
        return { ...machine, localHost: true };
      }
      const machines = await invoke<RemoteMachine[]>("remote_machines");
      const machine = machines.find((entry) => entry.id === target.machineId);
      if (!machine) throw new Error("The selected computer is no longer connected.");
      return machine;
    })();
    toolHosts.set(key, pending);
    pending.catch(() => {
      if (toolHosts.get(key) === pending) toolHosts.delete(key);
    });
  }
  return pending;
}

const HOST_SCOPED_TOOL_METHODS = new Set([
  "voice.local.start",
  "voice.local.inspect",
  "voice.local.speak",
  "voice.local.speechNext",
  "voice.local.speechCancel",
  "voice.local.transcribe",
  "voice.local.keepAlive",
  "voice.local.release",
  "runtimeLogs.read",
  "runtimeLogs.sources",
  "browser.status",
  "browser.claim",
  "browser.release",
  "browser.open",
  "browser.frame",
  "browser.input",
  "browser.close",
  "browser.setup",
  "devices.status",
  "devices.setup",
  "devices.start",
  "devices.stop",
  "devices.list",
  "devices.boot",
  "devices.capture",
  "devices.action",
  "resources.read",
]);
const PROJECT_BROWSER_METHODS = new Set([
  "browser.annotation.start",
  "browser.annotation.hover",
  "browser.annotation.select",
  "browser.annotation.clear",
  "browser.annotation.read",
  "browser.annotation.cancel",
]);

/** Browser/device/resource operations may use an explicitly selected paired host.
 * Other tools keep their conversation project and cannot be retargeted here. */
export async function hostToolRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown> = {},
  target: HostToolTarget = { kind: "project" },
): Promise<T> {
  if (target.kind === "project") return hostFeatureRequest<T>(cwd, capability, method, params);
  const annotation = PROJECT_BROWSER_METHODS.has(method);
  if (!HOST_SCOPED_TOOL_METHODS.has(method) && !annotation)
    throw new Error(
      "This tool follows the conversation's project and cannot use another computer.",
    );
  const key = hostToolTargetKey(target);
  const machine = await explicitToolHost(target);
  if (annotation && !targetIsProjectHost(cwd, target, [machine]))
    throw new Error("Browser annotations are available only on this project's computer.");
  if (annotation) return hostFeatureRequest<T>(cwd, capability, method, params);
  const capabilities = await machineCapabilities(machine);
  if (!capabilities.includes(capability))
    throw new Error("Update bycoda Host on the selected computer to use this feature.");
  if (
    (method.startsWith("devices.") || method === "browser.setup") &&
    !capabilities.includes("host.tools.machine-targets")
  )
    throw new Error("Update bycoda Host on the selected computer to use machine selection.");
  try {
    // A project/session ID from the conversation has no meaning on another host.
    const { projectId: _projectId, sessionId: _sessionId, ...hostParams } = params;
    return await remoteRequest<T>(machine.id, method, hostParams);
  } catch (error) {
    toolHosts.delete(key);
    throw error;
  }
}

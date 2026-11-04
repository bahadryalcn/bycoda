import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
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
    pending = withTimeout(resolveHost(cwd), 20_000, "Host discovery");
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
    pending = withTimeout(
      (async () => {
        if (target.kind === "local") {
          const machine = await invoke<RemoteMachine | null>("local_host_connect");
          if (!machine) throw new Error("This computer's bycoda Host is not connected.");
          return { ...machine, localHost: true };
        }
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        const machine = machines.find((entry) => entry.id === target.machineId);
        if (!machine) throw new Error("The selected computer is no longer connected.");
        return machine;
      })(),
      20_000,
      "Host discovery",
    );
    toolHosts.set(key, pending);
    pending.catch(() => {
      if (toolHosts.get(key) === pending) toolHosts.delete(key);
    });
  }
  return pending;
}

const HOST_SCOPED_TOOL_METHODS = new Set([
  "voice.local.setup",
  "voice.local.setupStatus",
  "voice.local.start",
  "voice.local.inspect",
  "voice.local.speak",
  "voice.local.speechNext",
  "voice.local.speechCancel",
  "voice.local.transcribe",
  "voice.local.keepAlive",
  "voice.local.release",
  "voice.realtime.secret",
  "voice.cloud.status",
  "voice.cloud.setKey",
  "runtimeLogs.read",
  "runtimeLogs.sources",
  "browser.status",
  "browser.claim",
  "browser.release",
  "browser.open",
  "browser.resize",
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
  "devices.control.status",
  "devices.control.claim",
  "devices.control.release",
  "devices.control.renew",
  "devices.inspect",
  "devices.action",
  "resources.read",
]);
const PROJECT_BROWSER_METHODS = new Set([
  "browser.annotation.start",
  "browser.annotation.hover",
  "browser.annotation.select",
  "browser.annotation.parent",
  "browser.annotation.traverse",
  "browser.annotation.clear",
  "browser.annotation.read",
  "browser.annotation.cancel",
]);
const OWNER_HOST_METHOD_CAPABILITIES: Readonly<Record<string, string>> = {
  "assistant.request": "assistant.v1",
  "voice.tools.list": "voice.tools.v1",
  "voice.tools.call": "voice.tools.v1",
  "desktop.request": "desktop.control.v1",
  "desktop.helper.request": "desktop.control.v1",
};
async function ownerToolMachine(
  target: Exclude<HostToolTarget, { kind: "project" }>,
  expectedEnvironmentId?: string,
) {
  const machine =
    target.kind === "local"
      ? await invoke<RemoteMachine | null>("local_host_connect")
      : (await invoke<RemoteMachine[]>("remote_machines")).find(
          (value) => value.id === target.machineId,
        );
  if (
    !machine ||
    !machine.environmentId ||
    (expectedEnvironmentId && machine.environmentId !== expectedEnvironmentId)
  )
    throw new Error("The captured Host is no longer available. Retry its original connection.");
  return structuredClone(machine);
}

/** Global assistant authority belongs to this exact Host, independent of a project. */
export async function captureVoiceToolHost(expectedEnvironmentId?: string) {
  const target = { kind: "local" } as const;
  const machine = await withTimeout(
    ownerToolMachine(target, expectedEnvironmentId),
    20_000,
    "Host discovery",
  );
  return {
    machine,
    request: <T>(
      method: "voice.tools.list" | "voice.tools.call",
      params: Record<string, unknown>,
    ) => hostToolRequest<T>("", "voice.tools.v1", method, params, target, machine.environmentId),
  };
}

/** Browser/device/resource operations may use an explicitly selected paired host.
 * Other tools keep their conversation project and cannot be retargeted here. */
export async function hostToolRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown> = {},
  target: HostToolTarget = { kind: "project" },
  expectedEnvironmentId?: string,
): Promise<T> {
  const ownerCapability = OWNER_HOST_METHOD_CAPABILITIES[method];
  if (ownerCapability) {
    if (capability !== ownerCapability || target.kind === "project")
      throw new Error("This owner operation requires its explicit computer and capability.");
    const machine = await ownerToolMachine(target, expectedEnvironmentId),
      environmentId = expectedEnvironmentId ?? machine.environmentId;
    const capabilities = await machineCapabilities(machine);
    if (!capabilities.includes(ownerCapability))
      throw new Error("Update bycoda Host on the selected computer to use this feature.");
    const current = await ownerToolMachine(target, environmentId);
    const route = (value: RemoteMachine) =>
      JSON.stringify([value.id, value.environmentId, value.endpoint, value.ssh ?? null]);
    if (route(current) !== route(machine))
      throw new Error("The captured Host connection changed. Retry its original connection.");
    // Owner requests carry canonical IDs already verified on this exact Host.
    // The Native expected-environment guard also fences endpoint resolution/disclosure.
    const result = await remoteRequest<T>(machine.id, method, params, false, false, environmentId);
    if (route(await ownerToolMachine(target, environmentId)) !== route(machine))
      throw new Error(
        "The Host connection changed before its reply. The outcome is unknown; retry the original request.",
      );
    return result;
  }
  if (expectedEnvironmentId)
    throw new Error("This tool does not support a captured owner Host target.");
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

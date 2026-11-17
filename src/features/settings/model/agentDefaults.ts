import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteMachine } from "../../connections";
import {
  HOST_BEHAVIOR_DEFAULTS,
  parseAgentDefaults,
  type AgentDefaults,
  type AgentDefaultsRecord,
} from "../../tasks/public/agentDefaults";
import { toast } from "../../../shared/ui/ToastRegion";
import { t } from "../../../shared/i18n/core";
import {
  acceptAgentDefaults,
  agentDefaultsSnapshot,
  legacyAgentDefaults,
  notifyAgentDefaults,
  registerAgentDefaultsSync,
} from "./agentDefaultsStore";

// Desktop sync of the Host-owned agent defaults. Readers use `agentDefaultsStore.ts`, which
// stays loadable by the headless Host; loading this module (app startup) registers the sync.
export {
  legacyAgentDefaults,
  loadAgentDefault,
  saveAgentDefault,
  subscribeAgentDefaults,
} from "./agentDefaultsStore";

// connections.ts loads settings/public at module load; a static import back would form a cycle
// that breaks mocks and evaluation order, so these two load on first use.
const remoteRequest: typeof import("../../connections/public/connections").remoteRequest = async (
  ...args
) => (await import("../../connections/public/connections")).remoteRequest(...args);
const machineCapabilities = async (target: RemoteMachine) =>
  (await import("../../automations/public/hostMachines")).machineCapabilities(target);

let queue = Promise.resolve();
let reading = false;

async function machine() {
  const target = await invoke<RemoteMachine | null>("local_host_connect");
  if (!target) throw new Error("Host agent defaults unavailable");
  if (!(await machineCapabilities(target)).includes(HOST_BEHAVIOR_DEFAULTS))
    throw new Error("Host agent defaults unavailable");
  return target;
}
async function refresh() {
  if (!isTauri() || reading) return;
  reading = true;
  try {
    const target = await machine();
    const result = await remoteRequest<{ agentDefaults: AgentDefaultsRecord }>(
      target.id,
      "host.settings.get",
      {},
      false,
      true,
    );
    const record = parseAgentDefaults(result.agentDefaults);
    if (record.version === 0) {
      acceptAgentDefaults(
        await remoteRequest(
          target.id,
          "host.settings.save",
          {
            settings: {
              agentDefaults: legacyAgentDefaults(),
              migrateAgentDefaults: true,
              expectedAgentDefaultsVersion: 0,
            },
          },
          false,
          true,
        ),
      );
    } else acceptAgentDefaults(result);
  } finally {
    reading = false;
  }
}
/** Startup recovery must await this before reading automatic-continuation defaults. */
export function initializeAgentDefaults(): Promise<void> {
  const operation = queue.then(refresh);
  queue = operation.catch(() => {});
  return operation;
}

/** Await this from settings UI so pending work is never reported as a failed/saved local write. */
export function saveAgentDefaultConfirmed<K extends keyof AgentDefaults>(
  key: K,
  value: AgentDefaults[K],
): Promise<boolean> {
  const operation = queue.then(async () => {
    await refresh();
    const snapshot = agentDefaultsSnapshot();
    if (!snapshot) throw new Error("Host agent defaults unavailable");
    const target = await machine();
    acceptAgentDefaults(
      await remoteRequest(
        target.id,
        "host.settings.save",
        {
          settings: {
            agentDefaults: { [key]: value },
            expectedAgentDefaultsVersion: snapshot.version,
          },
        },
        false,
        true,
      ),
    );
  });
  queue = operation.catch(() => {
    notifyAgentDefaults();
    toast.show({ title: t("Could not save changes"), tone: "danger" });
  });
  return operation.then(
    () => true,
    () => false,
  );
}

registerAgentDefaultsSync({
  start() {
    if (typeof window === "undefined" || !isTauri()) return () => {};
    queue = queue.then(refresh).catch(() => {});
    const timer = setInterval(() => {
      queue = queue.then(refresh).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  },
  save: saveAgentDefaultConfirmed,
});

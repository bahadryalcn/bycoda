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

const POLL_MS = 5000;
const MAX_IDLE_POLL_MS = 30_000;
const MAX_FAILED_POLL_MS = 60_000;

/** Delay before the next poll: grows while the Host version is unchanged or unreachable. */
function nextAgentDefaultsPollDelay(unchanged: number, failures: number): number {
  if (failures) return Math.min(POLL_MS * 2 ** Math.min(failures, 16), MAX_FAILED_POLL_MS);
  return Math.min(POLL_MS * 2 ** Math.min(unchanged, 16), MAX_IDLE_POLL_MS);
}

registerAgentDefaultsSync({
  /**
   * Runs only while something subscribes. Initial hydration runs at once, polling pauses while
   * the window is hidden, backs off while idle or failing, and a window that becomes visible or
   * focused catches up immediately.
   */
  start() {
    if (typeof window === "undefined" || !isTauri()) return () => {};
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unchanged = 0;
    let failures = 0;
    const plan = () => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || document.hidden) return;
      // A window hidden after this timer was planned skips the read; `catchUp` resumes it.
      timer = setTimeout(
        () => {
          if (!document.hidden) void poll();
        },
        nextAgentDefaultsPollDelay(unchanged, failures),
      );
    };
    const poll = async () => {
      clearTimeout(timer);
      timer = undefined;
      const before = agentDefaultsSnapshot()?.version;
      const run = queue.then(refresh);
      queue = run.catch(() => {});
      try {
        await run;
        failures = 0;
        unchanged = agentDefaultsSnapshot()?.version === before ? unchanged + 1 : 0;
      } catch {
        // Unreachable or incapable Host: back off; saves and initialization still report.
        failures++;
      }
      plan();
    };
    const catchUp = () => {
      if (stopped || document.hidden) return;
      unchanged = 0;
      failures = 0;
      void poll();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  },
  save: saveAgentDefaultConfirmed,
});

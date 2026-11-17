import {
  HOST_BEHAVIOR_DEFAULTS,
  parseAgentDefaults,
  DEFAULT_AGENT_DEFAULTS,
  type AgentDefaultsRecord,
} from "../../../src/features/tasks/public/agentDefaults";

const STORAGE_KEY = "fixture-host-agent-defaults";
const machine = {
  id: "fixture-agent-defaults-host",
  name: "This computer",
  localHost: true,
  endpoint: "http://127.0.0.1:9998",
  environmentId: "fixture-agent-defaults-host",
};

function read(): AgentDefaultsRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseAgentDefaults(JSON.parse(raw));
  } catch {
    /* Storage unavailable: the fixture Host starts from defaults. */
  }
  return { ...DEFAULT_AGENT_DEFAULTS, version: 1 };
}

/**
 * Synthetic Host that owns the agent defaults (keep awake, auto-continue, resume at reset,
 * streaming mode) for browser fixtures. Persists in localStorage so reloads keep the values,
 * as the real Host would. Returns undefined for commands it does not handle.
 */
export function agentDefaultsFixtureCommand(
  command: string,
  args: Record<string, unknown> | undefined,
): unknown {
  if (command === "local_host_connect") return machine;
  if (command !== "remote_request" || args?.machineId !== machine.id) return undefined;
  if (args.method === "environment.describe")
    return { environmentId: machine.environmentId, capabilities: [HOST_BEHAVIOR_DEFAULTS] };
  if (args.method === "host.settings.get") return { agentDefaults: read() };
  if (args.method === "host.settings.save") {
    const settings = (args.params as { settings: Record<string, unknown> }).settings;
    const current = read();
    const patch = settings.agentDefaults as Record<string, unknown>;
    if (
      settings.expectedAgentDefaultsVersion !== undefined &&
      settings.expectedAgentDefaultsVersion !== current.version &&
      !settings.migrateAgentDefaults
    )
      throw new Error("Fixture agent defaults changed");
    const next = parseAgentDefaults({ ...patch, version: current.version + 1 }, current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { agentDefaults: next };
  }
  return undefined;
}

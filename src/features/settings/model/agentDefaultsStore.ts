import {
  DEFAULT_AGENT_DEFAULTS,
  parseAgentDefaults,
  type AgentDefaults,
  type AgentDefaultsRecord,
} from "../../tasks/public/agentDefaults";

/**
 * The agent defaults snapshot and its readers. This module stays free of Tauri, Host
 * transport and UI so the headless Host can load `settings.ts`; the desktop sync in
 * `agentDefaults.ts` registers itself here when the app loads it.
 */
let snapshot: AgentDefaultsRecord | undefined;
const listeners = new Set<() => void>();

export type AgentDefaultsSync = {
  /** Starts periodic refresh while someone listens; returns the stop function. */
  start(): () => void;
  save<K extends keyof AgentDefaults>(key: K, value: AgentDefaults[K]): Promise<boolean>;
};
let sync: AgentDefaultsSync | undefined;
let stop: (() => void) | undefined;

export function registerAgentDefaultsSync(next: AgentDefaultsSync): void {
  sync = next;
  if (listeners.size && !stop) stop = sync.start();
}

export function notifyAgentDefaults(): void {
  for (const listener of listeners) listener();
}

/** Accepts a Host defaults record (`{ agentDefaults }`) as the new snapshot. */
export function acceptAgentDefaults(raw: unknown): void {
  const record = (raw as { agentDefaults?: unknown })?.agentDefaults;
  if (
    !record ||
    typeof record !== "object" ||
    !("version" in record) ||
    !("schemaVersion" in record)
  )
    throw new Error("Invalid Host agent defaults");
  snapshot = parseAgentDefaults(record);
  notifyAgentDefaults();
}

export function agentDefaultsSnapshot(): AgentDefaultsRecord | undefined {
  return snapshot;
}

/** Legacy storage is read only until this Host accepts its first defaults record. */
export function legacyAgentDefaults(): AgentDefaultsRecord {
  const value = { ...DEFAULT_AGENT_DEFAULTS };
  try {
    for (const key of [
      "keepAwakeWhileAgentsWork",
      "autoContinueInterrupted",
      "resumeAtReset",
    ] as const) {
      const raw = localStorage.getItem(`bycoda.${key}`);
      if (raw !== null) value[key] = raw === "1" || raw === "true";
    }
    const hold = localStorage.getItem("bycoda.keepAwakeHoldAfter");
    if (hold !== null) {
      try {
        value.keepAwakeHoldAfter = parseAgentDefaults({
          keepAwakeHoldAfter: hold,
        }).keepAwakeHoldAfter;
      } catch {
        /* Invalid legacy value retains default. */
      }
    }
    value.streamingTextMode =
      localStorage.getItem("bycoda.streamingTextMode") === "adaptive" ? "adaptive" : "paced";
  } catch {
    /* Storage unavailable; Host still receives valid defaults. */
  }
  return value;
}

export function loadAgentDefault<K extends keyof AgentDefaults>(key: K): AgentDefaults[K] {
  return (snapshot ?? legacyAgentDefaults())[key];
}

export function subscribeAgentDefaults(listener: () => void): () => void {
  listeners.add(listener);
  if (sync && !stop) stop = sync.start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && stop) {
      stop();
      stop = undefined;
    }
  };
}

/** Compatibility for existing synchronous callers; the display changes only after Host ACK. */
export function saveAgentDefault<K extends keyof AgentDefaults>(
  key: K,
  value: AgentDefaults[K],
): boolean {
  if (sync) void sync.save(key, value);
  // Do not tell synchronous callers an unacknowledged remote write is durable.
  return snapshot?.[key] === value;
}

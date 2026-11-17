import {
  DEFAULT_AGENT_DEFAULTS,
  parseHostSettings,
  type AgentDefaultsRecord,
} from "../../src/features/tasks/model/hostSettings";
import type { HostStore } from "../store";

/** Same durable record as HostLimits; engine defaults need no scheduler instance. */
export async function readHostAgentDefaults(store: HostStore): Promise<AgentDefaultsRecord> {
  await store.ready;
  return store.db.scope(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const row = await store.db
      .prepare("SELECT value FROM host_settings WHERE key='settings'")
      .get();
    if (!row) return { ...DEFAULT_AGENT_DEFAULTS };
    return (
      parseHostSettings(JSON.parse(String(row.value))).agentDefaults ?? {
        ...DEFAULT_AGENT_DEFAULTS,
      }
    );
  });
}

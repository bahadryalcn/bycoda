import type { HostStore } from "../store";

const SETTING_KEY = "agentDevices";
type SettingsStore = Pick<HostStore, "ready" | "db">;

function settingsTable(store: SettingsStore) {
  return store.db.exec(
    "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
}

/** The owner's "Agents can use devices" switch; on until the desktop publishes a choice. */
export async function readAgentDevicesEnabled(store: SettingsStore): Promise<boolean> {
  await store.ready;
  return store.db.scope(async () => {
    await settingsTable(store);
    const row = await store.db
      .prepare("SELECT value FROM host_settings WHERE key=?")
      .get(SETTING_KEY);
    return row?.value !== "false";
  });
}

export async function saveAgentDevicesEnabled(
  store: SettingsStore,
  raw: unknown,
): Promise<boolean> {
  if (typeof raw !== "boolean") throw new Error("agentDevices must be true or false.");
  await store.ready;
  await store.db.scope(async () => {
    await settingsTable(store);
    await store.db
      .prepare(
        "INSERT INTO host_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(SETTING_KEY, String(raw));
  });
  return raw;
}

/** Agent and assistant device tools stop here while the owner's switch is off. */
export async function assertAgentDevicesEnabled(store: SettingsStore): Promise<void> {
  if (!(await readAgentDevicesEnabled(store)))
    throw new Error(
      "DEVICES_AGENT_ACCESS_OFF: The owner turned off agent device use in Settings > Conversation tools > Devices.",
    );
}

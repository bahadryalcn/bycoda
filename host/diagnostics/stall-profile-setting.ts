import type { HostStore } from "../store";
import { setStallProfilesEnabled } from "./loop-stall";

const SETTING_KEY = "stallProfiles";
type SettingsStore = Pick<HostStore, "ready" | "db">;

function settingsTable(store: SettingsStore) {
  return store.db.exec(
    "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
}

/** The owner's "Host CPU profiles" switch; off until the owner turns it on. */
export async function readStallProfilesEnabled(store: SettingsStore): Promise<boolean> {
  await store.ready;
  return store.db.scope(async () => {
    await settingsTable(store);
    const row = await store.db
      .prepare("SELECT value FROM host_settings WHERE key=?")
      .get(SETTING_KEY);
    return row?.value === "true";
  });
}

/** Stores the switch and applies it to the running stall watcher. */
export async function saveStallProfilesEnabled(store: SettingsStore, raw: unknown) {
  if (typeof raw !== "boolean") throw new Error("stallProfiles must be true or false.");
  await store.ready;
  await store.db.scope(async () => {
    await settingsTable(store);
    await store.db
      .prepare(
        "INSERT INTO host_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(SETTING_KEY, String(raw));
  });
  setStallProfilesEnabled(raw);
  return raw;
}

/** Applies the stored switch once the Host database is open. */
export async function applyStoredStallProfiles(store: SettingsStore) {
  setStallProfilesEnabled(await readStallProfilesEnabled(store));
}

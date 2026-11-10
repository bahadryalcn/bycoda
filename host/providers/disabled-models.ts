import type { HostStore } from "../store";

const KEY = "disabledModels";
const MAX_IDS = 2000;

export function parseDisabledModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200),
    ),
  ].slice(0, MAX_IDS);
}

/** `undefined` until the desktop has published a list, so an unconfigured Host serves everything. */
export async function readDisabledModels(
  store: Pick<HostStore, "ready" | "db">,
): Promise<string[] | undefined> {
  await store.ready;
  return store.db.scope(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const row = await store.db.prepare("SELECT value FROM host_settings WHERE key=?").get(KEY);
    try {
      return row ? parseDisabledModels(JSON.parse(String(row.value))) : undefined;
    } catch {
      return undefined;
    }
  });
}

export async function saveDisabledModels(
  store: Pick<HostStore, "ready" | "db">,
  raw: unknown,
): Promise<string[]> {
  const next = parseDisabledModels(raw);
  await store.ready;
  await store.db.scope(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await store.db
      .prepare(
        "INSERT INTO host_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(KEY, JSON.stringify(next));
  });
  return next;
}

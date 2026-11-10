import type { HostStore } from "../store";

const KEY = "disabledModels";
const MAX_IDS = 2000;

/** Same equivalence the desktop uses: Claude ids appear dotted and CLI-style. */
function preferenceKey(value: string): string {
  return value.startsWith("claude:")
    ? value.replace(/^claude:claude-/, "claude:").replace(/\./g, "-")
    : value;
}

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

/**
 * Drops the models the owner turned off in the desktop. A provider whose every model is off keeps
 * its list (an empty list reads as "no catalog yet"), matching the desktop picker.
 */
export function applyDisabledModels<T extends object>(
  catalog: T,
  disabled: readonly string[] | undefined,
): T {
  const models = (catalog as { models?: Record<string, Array<{ id?: string }>> }).models;
  if (!disabled?.length || !models || typeof models !== "object") return catalog;
  const off = new Set(disabled.map(preferenceKey));
  return {
    ...catalog,
    models: Object.fromEntries(
      Object.entries(models).map(([provider, list]) => {
        if (!Array.isArray(list)) return [provider, list];
        const kept = list.filter((model) => !model.id || !off.has(preferenceKey(model.id)));
        return [provider, kept.length > 0 ? kept : list];
      }),
    ),
  };
}

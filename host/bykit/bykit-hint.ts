import { resolveOnPath } from "../mcp/hub/launch";
import type { HostStore } from "../store";
import { bundledBykitPath } from "./bykit-path";

/** Agent instruction block from the bykit contract (SPEC.md); keep it short, it costs tokens per session. */
export const BYKIT_HINT = [
  "Never write Python/Node/shell scripts or heredocs that write files (they change line endings); edit with your edit tool or `bykit edit`/`bykit replace`.",
  "Use bykit for many-result searches (`bykit find`), big files (`bykit read --outline, --symbol, --lines A:B`),",
  "locale keys (`bykit json DIR --has KEY`, `--missing-in`), SQLite (`bykit sql`), long output (`bykit run -- cmd`),",
  "long diffs (`bykit diff`), PNGs (`bykit shot A --compare B`).",
  "Read-only scripts only when no bykit command fits; name the gap in your report.",
  "Output is paged: narrow by path first, then `--page N`.",
].join("\n");

const LOOKUP_DEADLINE_MS = 1_500;
const CACHE_MS = 60_000;
const SETTING_KEY = "bykitInstructions";

type Lookup = (command: string) => Promise<string | undefined>;
type SettingsStore = Pick<HostStore, "ready" | "db">;
let cached: { at: number; found: boolean } | undefined;

function settingsTable(store: SettingsStore) {
  return store.db.exec(
    "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
}

/** The owner's Settings switch; on until the desktop publishes a choice. */
export async function readBykitEnabled(store: SettingsStore): Promise<boolean> {
  await store.ready;
  return store.db.scope(async () => {
    await settingsTable(store);
    const row = await store.db
      .prepare("SELECT value FROM host_settings WHERE key=?")
      .get(SETTING_KEY);
    return row?.value !== "false";
  });
}

export async function saveBykitEnabled(store: SettingsStore, raw: unknown): Promise<boolean> {
  if (typeof raw !== "boolean") throw new Error("bykitInstructions must be true or false.");
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

/**
 * Whether bykit is usable: the binary bundled with the Host, or one that resolves on PATH.
 * The PATH lookup has a deadline (a slow or
 * hung PATH entry counts as absent) and the answer is reused for a minute.
 */
export async function bykitAvailable(
  lookup: Lookup = (command) => resolveOnPath(command),
  now: () => number = Date.now,
  bundled: () => string | undefined = () => bundledBykitPath(),
): Promise<boolean> {
  if (bundled()) return true;
  if (cached && now() - cached.at < CACHE_MS) return cached.found;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), LOOKUP_DEADLINE_MS);
  });
  const found = await Promise.race([lookup("bykit").catch(() => undefined), deadline]).finally(() =>
    clearTimeout(timer),
  );
  cached = { at: now(), found: !!found };
  return cached.found;
}

/** The instruction block when the owner's switch is on and bykit is installed, otherwise "". */
export async function bykitHint(
  store: SettingsStore,
  lookup?: Lookup,
  now?: () => number,
  bundled?: () => string | undefined,
): Promise<string> {
  // An unreadable setting must not block the turn; the switch defaults to on.
  const enabled = await readBykitEnabled(store).catch(() => true);
  return enabled && (await bykitAvailable(lookup, now, bundled)) ? BYKIT_HINT : "";
}

export function resetBykitCache() {
  cached = undefined;
}

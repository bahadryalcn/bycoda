import { resolveOnPath } from "../mcp/hub/launch";
import type { HostStore } from "../store";

/** Agent instruction block from the bykit contract (SPEC.md); keep it short, it costs tokens per session. */
export const BYKIT_HINT = [
  "Use bykit when available and suitable for the operation.",
  "Otherwise use a suitable tool, including read-only Python, Node or shell commands.",
  "For authorized edits, patches and scoped scripts (including heredocs) are fine.",
  "Preserve encoding, line endings and unrelated edits, and review the diff after writing.",
  "`bykit read` for big files,",
  "`bykit diff` for long diffs, `bykit run -- <cmd>` for long command output,",
  "`bykit find` for searches that may return many results (usage counts,",
  "repo-wide scans, before a bulk change), `bykit edit`/`replace` for multi-place",
  "edits, `bykit json` for JSON (`--has` checks keys across locale files), `bykit sql` for SQLite, `bykit shot` for screenshots.",
  "Output is paged: narrow by path first, then",
  "`--page N`; `--all` only when the task needs every result.",
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
 * Whether a `bykit` executable resolves on PATH. The lookup has a deadline (a slow or
 * hung PATH entry counts as absent) and the answer is reused for a minute.
 */
export async function bykitAvailable(
  lookup: Lookup = (command) => resolveOnPath(command),
  now: () => number = Date.now,
): Promise<boolean> {
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
): Promise<string> {
  // An unreadable setting must not block the turn; the switch defaults to on.
  const enabled = await readBykitEnabled(store).catch(() => true);
  return enabled && (await bykitAvailable(lookup, now)) ? BYKIT_HINT : "";
}

export function resetBykitCache() {
  cached = undefined;
}

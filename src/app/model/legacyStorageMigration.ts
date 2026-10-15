import { pathKey } from "../../shared/lib/paths";

/** Builds before the bycoda rename kept their state under `monocode.` and
 * `monocode:`. Their projects, groups and remote-project records are merged
 * into the current keys once (current values win), then every legacy key is
 * removed so this never runs again. Other legacy settings are dropped. */
const LEGACY_PREFIXES = ["monocode.", "monocode:"] as const;

type Merge = (current: unknown, legacy: unknown) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `[{ path, openedAt }]`: legacy entries for paths the current list lacks are appended. */
const mergeByPath: Merge = (current, legacy) => {
  const out = list(current).filter((item) => isRecord(item) && typeof item.path === "string");
  const seen = new Set(out.map((item) => pathKey((item as { path: string }).path)));
  for (const item of list(legacy)) {
    if (!isRecord(item) || typeof item.path !== "string") continue;
    const key = pathKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

/** `[path]` lists. */
const mergePaths: Merge = (current, legacy) => {
  const out = list(current).filter((item): item is string => typeof item === "string");
  const seen = new Set(out.map(pathKey));
  for (const item of list(legacy)) {
    if (typeof item !== "string" || seen.has(pathKey(item))) continue;
    seen.add(pathKey(item));
    out.push(item);
  }
  return out;
};

/** `[id]` sets. */
const mergeStrings: Merge = (current, legacy) => [
  ...new Set([...list(current), ...list(legacy)].filter((item) => typeof item === "string")),
];

/** `[{ id, … }]`: legacy entries with an id the current list lacks are appended. */
const mergeById: Merge = (current, legacy) => {
  const out = list(current).filter(isRecord);
  const ids = new Set(out.map((item) => item.id));
  for (const item of list(legacy)) if (isRecord(item) && !ids.has(item.id)) out.push(item);
  return out;
};

/** Keyed maps: current keys win. */
const mergeMap: Merge = (current, legacy) => ({
  ...(isRecord(legacy) ? legacy : {}),
  ...(isRecord(current) ? current : {}),
});

/** Current key name (without prefix) → how its legacy value is merged in. */
const MERGES: Record<string, Merge> = {
  recentProjects: mergeByPath,
  archivedProjects: mergeByPath,
  projectRailOrder: mergePaths,
  projectRailPinned: mergePaths,
  projectGroups: mergeById,
  projectGroupAssignments: mergeMap,
  "remote-projects.v2": mergeMap,
  "remote-tabs.v2": mergeMap,
  "sync.dismissedRemoteProjects.v2": mergeStrings,
  "tab-group:colors": mergeMap,
  "tab-group:custom-colors": mergeMap,
  "tab-group:labels": mergeMap,
  "tab-group:auto-labels": mergeMap,
  "tab-group:logos": mergeMap,
  "tab-group:mascots": mergeMap,
};

/** Per-project history is copied when the current one has none. */
const COPY_PREFIXES = ["remote-history.v2:"];

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Assignments to groups that do not exist would be dropped by the rail anyway. */
function pruneAssignments(store: Storage): void {
  const groups = parse(store.getItem("bycoda.projectGroups"));
  const assignments = parse(store.getItem("bycoda.projectGroupAssignments"));
  if (!isRecord(assignments)) return;
  const ids = new Set(
    list(groups)
      .filter(isRecord)
      .map((group) => group.id),
  );
  const kept = Object.fromEntries(Object.entries(assignments).filter(([, id]) => ids.has(id)));
  store.setItem("bycoda.projectGroupAssignments", JSON.stringify(kept));
}

export function migrateLegacyStorage(store: Storage = localStorage): boolean {
  const legacyKeys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) legacyKeys.push(key);
  }
  if (legacyKeys.length === 0) return false;
  for (const legacyKey of legacyKeys) {
    const prefix = LEGACY_PREFIXES.find((candidate) => legacyKey.startsWith(candidate))!;
    const name = legacyKey.slice(prefix.length);
    const currentKey = `bycoda${prefix.slice("monocode".length)}${name}`;
    const merge = MERGES[name];
    if (merge) {
      const legacy = parse(store.getItem(legacyKey));
      if (legacy === undefined) continue;
      const current = parse(store.getItem(currentKey));
      store.setItem(
        currentKey,
        JSON.stringify(current === undefined ? legacy : merge(current, legacy)),
      );
    } else if (
      COPY_PREFIXES.some((copy) => name.startsWith(copy)) &&
      store.getItem(currentKey) === null
    ) {
      store.setItem(currentKey, store.getItem(legacyKey)!);
    }
  }
  pruneAssignments(store);
  for (const key of legacyKeys) store.removeItem(key);
  return true;
}

try {
  migrateLegacyStorage();
} catch {
  // Storage unavailable: nothing to migrate.
}

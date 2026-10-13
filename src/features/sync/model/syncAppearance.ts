import {
  TAB_GROUP_COLORS,
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadCustomTabGroupLabels,
  loadTabGroupMascots,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { localPathKeyForProjectId } from "./syncProjects";
import { knownRecordValue, queueLocalChange } from "./syncPeerState";
import type { SyncAppearanceValue, SyncRecord } from "./syncProtocol";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TEXT = 200;

type Appearance = Omit<SyncAppearanceValue, "projectId">;

const seenKey = (machineId: string) => `bycoda.sync.seenAppearance.v2:${machineId}`;

/** projectId -> the path key under which this machine applied or captured that
 * project's appearance. Only such a project may be tombstoned: one merely
 * without a look here may carry another machine's rename. Bound to the path
 * key so a project that moved (remote project replaced by a local folder)
 * takes the host's look over instead of deleting it. */
function loadSeen(machineId: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(machineId)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveSeen(machineId: string, seen: Record<string, string>): void {
  try {
    const json = JSON.stringify(seen);
    if (localStorage.getItem(seenKey(machineId)) !== json)
      localStorage.setItem(seenKey(machineId), json);
  } catch {
    // ignored; re-learned on the next capture
  }
}

type Stores = {
  labels: Record<string, string>;
  colors: Record<string, number>;
  customColors: Record<string, string>;
  mascots: Record<string, string>;
};

function loadStores(): Stores {
  return {
    labels: loadCustomTabGroupLabels(),
    colors: loadTabGroupColors(),
    customColors: loadTabGroupCustomColors(),
    mascots: loadTabGroupMascots(),
  };
}

/** The appearance stores are keyed by `projectKey(path)`, which is the same
 * path key the project id map uses, for local and `remote://` projects alike. */
function localAppearance(stores: Stores, key: string): Appearance {
  const label = stores.labels[key]?.trim();
  const customColor = stores.customColors[key];
  const colorIndex = stores.colors[key];
  const mascot = stores.mascots[key];
  return {
    ...(label ? { label } : {}),
    ...(customColor ? { customColor } : colorIndex != null ? { colorIndex } : {}),
    ...(mascot ? { mascot } : {}),
  };
}

/** Keeps only the fields this build understands and can store. */
function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const label = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_TEXT) : "";
  const customColor =
    typeof raw.customColor === "string" && HEX_COLOR_RE.test(raw.customColor)
      ? raw.customColor.toLowerCase()
      : "";
  const colorIndex =
    Number.isInteger(raw.colorIndex) &&
    (raw.colorIndex as number) >= 0 &&
    (raw.colorIndex as number) < TAB_GROUP_COLORS.length
      ? (raw.colorIndex as number)
      : undefined;
  const mascot = typeof raw.mascot === "string" && raw.mascot.length <= MAX_TEXT ? raw.mascot : "";
  return {
    ...(label ? { label } : {}),
    ...(customColor ? { customColor } : colorIndex != null ? { colorIndex } : {}),
    ...(mascot ? { mascot } : {}),
  };
}

const isEmpty = (appearance: Appearance) => Object.keys(appearance).length === 0;

/** Makes the project look exactly like `target`, touching only what differs. */
function writeAppearance(key: string, target: Appearance): void {
  const current = localAppearance(loadStores(), key);
  if ((current.label ?? "") !== (target.label ?? "")) saveTabGroupLabel(key, target.label ?? "");
  if (current.customColor !== target.customColor || current.colorIndex !== target.colorIndex) {
    if (target.customColor) saveTabGroupCustomColor(key, target.customColor);
    else saveTabGroupColor(key, target.colorIndex ?? null);
  }
  if ((current.mascot ?? "") !== (target.mascot ?? ""))
    saveTabGroupMascot(key, target.mascot ?? null);
}

/** Queues the appearance of every project this machine can resolve to a sync
 * id. A project without a custom look queues nothing, unless this machine
 * applied or pushed a look for it earlier: then the reset is a tombstone. A
 * host look this machine could not apply when it was pulled (the project was
 * not on its rail yet) is applied here first, so it is not read as a reset. */
export function captureLocalAppearanceChanges(
  machineId: string,
  pathToProjectId: Record<string, string> = {},
): void {
  const previous = loadSeen(machineId);
  // Rebuilt from the projects on the rail now: a project that left it and
  // comes back later must take the host's look, not delete it.
  const seen: Record<string, string> = {};
  let stores = loadStores();
  for (const [key, projectId] of Object.entries(pathToProjectId)) {
    let local = localAppearance(stores, key);
    const wasSeen = previous[projectId] === key;
    if (isEmpty(local) && !wasSeen) {
      const host = parseAppearance(knownRecordValue(machineId, "appearance", projectId));
      if (isEmpty(host)) continue;
      writeAppearance(key, host);
      stores = loadStores();
      local = localAppearance(stores, key);
      if (isEmpty(local)) continue;
    }
    if (isEmpty(local)) {
      queueLocalChange(machineId, "appearance", projectId, null);
      continue;
    }
    const value: SyncAppearanceValue = { projectId, ...local };
    queueLocalChange(machineId, "appearance", projectId, value);
    seen[projectId] = key;
  }
  saveSeen(machineId, seen);
}

/** Applies incoming appearance records through the regular save functions,
 * so the rail repaints. A record for a project this machine does not have is
 * skipped; the next capture applies it once the project is here. A tombstone
 * clears label, color and mascot (never the logo), and only for a project
 * whose look this machine has synced before. */
export function applyRemoteAppearanceRecords(
  machineId: string,
  records: readonly SyncRecord[],
): void {
  const appearanceRecords = records.filter((record) => record.table === "appearance");
  if (appearanceRecords.length === 0) return;
  const seen = loadSeen(machineId);
  for (const record of appearanceRecords) {
    const key = localPathKeyForProjectId(record.id);
    if (!key) continue;
    const target = parseAppearance(record.value);
    if (isEmpty(target)) {
      if (seen[record.id] !== key) continue;
      writeAppearance(key, {});
      delete seen[record.id];
    } else {
      writeAppearance(key, target);
      seen[record.id] = key;
    }
  }
  saveSeen(machineId, seen);
}

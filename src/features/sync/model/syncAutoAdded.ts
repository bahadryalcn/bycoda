import { pathKey } from "../../../shared/lib/paths";
import { loadArchivedProjects, loadRecents } from "../../projects/model/recents";

const AUTO_ADDED_KEY = "bycoda.sync.autoAddedRemoteProjects.v2";
const DISMISSED_KEY = "bycoda.sync.dismissedRemoteProjects.v2";

/** Synced project id → the rail path sync added for it: a `remote://` path,
 * or a local folder another desktop had opened through this machine's host. */
export function loadAutoAdded(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(AUTO_ADDED_KEY) ?? "{}");
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

function loadStoredDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignored; the project is offered again next cycle
  }
}

export function markAutoAdded(projectId: string, remoteKey: string): void {
  write(AUTO_ADDED_KEY, { ...loadAutoAdded(), [projectId]: remoteKey });
}

/** Remembers projects that left this machine's rail, so sync does not put them back. */
export function dismissProjectIds(ids: readonly string[]): void {
  const stored = loadStoredDismissed();
  const known = new Set(stored);
  const fresh = ids.filter((id) => !known.has(id));
  if (fresh.length > 0) write(DISMISSED_KEY, [...stored, ...new Set(fresh)]);
}

function railPathKeys(): Set<string> {
  return new Set([...loadRecents(), ...loadArchivedProjects()].map((item) => pathKey(item.path)));
}

/** Projects sync must not add again: the user removed the remote project it
 * had added. Includes removals not yet written by `persistDismissed`. */
export function dismissedProjectIds(): Set<string> {
  const dismissed = new Set(loadStoredDismissed());
  const added = Object.entries(loadAutoAdded());
  if (added.length === 0) return dismissed;
  const present = railPathKeys();
  for (const [projectId, key] of added) if (!present.has(pathKey(key))) dismissed.add(projectId);
  return dismissed;
}

/** Moves auto-added projects the user has since removed into the dismissed set. */
export function persistDismissed(): void {
  const added = loadAutoAdded();
  const present = railPathKeys();
  const gone = Object.entries(added).filter(([, key]) => !present.has(pathKey(key)));
  if (gone.length === 0) return;
  write(DISMISSED_KEY, [
    ...new Set([...loadStoredDismissed(), ...gone.map(([projectId]) => projectId)]),
  ]);
  write(
    AUTO_ADDED_KEY,
    Object.fromEntries(Object.entries(added).filter(([, key]) => present.has(pathKey(key)))),
  );
}

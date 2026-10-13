import {
  resolveProjectLocation,
  revokeFileAccess,
  type ProjectLocation,
} from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { isLocalProject, normalizeProjectPath, sameProjectPath } from "./recents";

import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";

const KEY = "bycoda.projectLocations";
const LOCATION_TTL_MS = 2_000;
const validatedLocations = new Map<
  string,
  { value: ProjectLocationSync; expires: number; identity?: string }
>();

/** Call after an access error or a filesystem/project change before retrying. */
export function invalidateProjectLocation(path?: string): void {
  if (path) validatedLocations.delete(pathKey(normalizeProjectPath(path)));
  else validatedLocations.clear();
}

type StoredProjectLocation = {
  path: string;
  identity: string;
};

export type ProjectLocationSync = ProjectLocation & {
  moved: boolean;
};

function read(): Record<string, StoredProjectLocation> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const locations: Record<string, StoredProjectLocation> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<StoredProjectLocation>;
      if (
        typeof candidate.path !== "string" ||
        !candidate.path ||
        typeof candidate.identity !== "string" ||
        !candidate.identity
      ) {
        continue;
      }
      locations[key] = {
        path: normalizeProjectPath(candidate.path),
        identity: candidate.identity,
      };
    }
    return locations;
  } catch {
    return {};
  }
}

function write(locations: Record<string, StoredProjectLocation>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(locations));
  } catch {
    // private mode / quota
  }
}

function remember(locations: Record<string, StoredProjectLocation>, location: ProjectLocation) {
  const path = normalizeProjectPath(location.path);
  locations[pathKey(path)] = { path, identity: location.identity };
  write(locations);
}

/** Capture an identity without searching for a moved folder. */
export async function rememberProjectLocation(path: string): Promise<void> {
  const normalized = normalizeProjectPath(path);
  if (!isLocalProject(normalized)) return;
  invalidateProjectLocation(normalized);
  const location = await resolveProjectLocation(normalized);
  if (!location) return;
  remember(read(), location);
}

/** Resolve a missing project among its former siblings and persist the result. */
export async function synchronizeProjectLocation(
  path: string,
): Promise<ProjectLocationSync | null> {
  const normalized = normalizeProjectPath(path);
  if (!isLocalProject(normalized)) {
    return { path: normalized, identity: "", moved: false };
  }
  const locations = read();
  const oldKey = pathKey(normalized);
  const identity = locations[oldKey]?.identity;
  const cached = validatedLocations.get(oldKey);
  if (cached && cached.expires > Date.now() && cached.identity === identity) {
    return { ...cached.value };
  }
  validatedLocations.delete(oldKey);
  const finishLocation = startPerformanceSpan("project-location");
  let location: ProjectLocation | null;
  try {
    location = await resolveProjectLocation(normalized, locations[oldKey]?.identity);
  } finally {
    finishLocation();
  }
  if (!location) return null;

  const resolved = normalizeProjectPath(location.path);
  const moved = !sameProjectPath(normalized, resolved);
  if (moved) delete locations[oldKey];
  remember(locations, { ...location, path: resolved });
  const value = { ...location, path: resolved, moved };
  // Moved locations must trigger App's project migration, never replay a
  // cached migration. Missing/error results are deliberately not cached.
  if (!moved)
    validatedLocations.set(oldKey, {
      value,
      expires: Date.now() + LOCATION_TTL_MS,
      identity: location.identity,
    });
  return value;
}

export function forgetProjectLocation(path: string): void {
  if (isLocalProject(path)) {
    void revokeFileAccess(normalizeProjectPath(path)).catch((error) =>
      console.warn("Could not revoke project file access", error),
    );
  }
  invalidateProjectLocation(path);
  const locations = read();
  const key = pathKey(normalizeProjectPath(path));
  if (!(key in locations)) return;
  delete locations[key];
  write(locations);
}

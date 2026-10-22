/** The one spelling of a folder path every desktop computes, whatever OS it
 * runs on: forward slashes, no trailing slash, and lower case for a Windows
 * drive path only (its file system ignores case; others do not). */
export function canonicalHostPath(path: string): string {
  const trimmed = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return /^[A-Za-z]:\//.test(`${trimmed}/`) ? trimmed.toLowerCase() : trimmed;
}

const PREFIX = "loc:";

/** A synced project is its folder: the host serving the machine it is on, plus its path there. */
export function hostProjectId(hostEnvironmentId: string, path: string): string {
  return `${PREFIX}${hostEnvironmentId}:${canonicalHostPath(path)}`;
}

/** What the ids of folders on a desktop without a host of its own start with. */
export function machineProjectIdPrefix(machineId: string): string {
  return `${PREFIX}machine:${machineId}:`;
}

export function machineProjectId(machineId: string, path: string): string {
  return `${machineProjectIdPrefix(machineId)}${canonicalHostPath(path)}`;
}

/** False for ids of the older name-based scheme, which no longer resolve to anything. */
export function isLocationProjectId(id: string): boolean {
  return id.startsWith(PREFIX);
}

export function folderName(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || path;
}

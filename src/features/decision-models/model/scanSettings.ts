/** Limits mirror the Host contract (DecisionDiscoverySettingsSchema). */
export const MAX_EXTRA_PORTS = 16;
export const MAX_EXTRA_FOLDERS = 32;

export type PortError = "invalid" | "count";
export type FolderError = "relative" | "count";

export type ParseResult<E extends string, V> = { ok: true; value: V } | { ok: false; error: E };

/** Comma-separated ports. Each must be a whole number from 1 to 65535; duplicates are dropped. */
export function parsePorts(text: string): ParseResult<PortError, number[]> {
  const ports: number[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const port = /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!(port >= 1 && port <= 65535)) return { ok: false, error: "invalid" };
    if (!ports.includes(port)) ports.push(port);
  }
  if (ports.length > MAX_EXTRA_PORTS) return { ok: false, error: "count" };
  return { ok: true, value: ports };
}

/**
 * One folder per line. The Host stores only absolute paths, so a relative entry is refused here
 * with a message instead of a round trip; duplicates are dropped.
 */
export function parseFolders(text: string): ParseResult<FolderError, string[]> {
  const folders: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!isAbsolutePath(trimmed)) return { ok: false, error: "relative" };
    if (!folders.includes(trimmed)) folders.push(trimmed);
  }
  if (folders.length > MAX_EXTRA_FOLDERS) return { ok: false, error: "count" };
  return { ok: true, value: folders };
}

/** Windows drive (`D:\`, `D:/`), UNC (`\\server`) or POSIX (`/`) absolute paths. */
export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

export function formatPorts(ports: readonly number[]): string {
  return ports.join(", ");
}

export function formatFolders(folders: readonly string[]): string {
  return folders.join("\n");
}

import { isEqualOrInside, rebasePath, slash } from "./paths";

const KEY = "bycoda.remote-explorer-paths.v1";
export type ExplorerMapping = { remoteRoot: string; localRoot: string };

function valid(mapping: ExplorerMapping): boolean {
  return (
    /^remote:\/\/[^/]+\//.test(mapping.remoteRoot) &&
    /^(?:\/(?:[^/]|$)|[A-Za-z]:\/|\/\/[^/]+\/[^/]+)/.test(slash(mapping.localRoot)) &&
    !/[\x00-\x1f"]/.test(mapping.remoteRoot + mapping.localRoot) &&
    !slash(mapping.remoteRoot)
      .split("/")
      .some((part) => part === ".." || part === ".") &&
    !slash(mapping.localRoot)
      .split("/")
      .some((part) => part === ".." || part === ".")
  );
}

export function explorerMappings(): ExplorerMapping[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is ExplorerMapping =>
            !!item &&
            typeof item.remoteRoot === "string" &&
            typeof item.localRoot === "string" &&
            valid(item),
        )
      : [];
  } catch {
    return [];
  }
}

export function explorerMappingFor(path: string): ExplorerMapping | undefined {
  return explorerMappings()
    .filter((mapping) => isEqualOrInside(path, mapping.remoteRoot))
    .sort((a, b) => b.remoteRoot.length - a.remoteRoot.length)[0];
}

/** An explicit share/mount mapping on this computer, never an inferred SSH path. */
export function localExplorerPath(path: string): string | undefined {
  const mapping = explorerMappingFor(path);
  if (!mapping || !valid({ remoteRoot: path, localRoot: mapping.localRoot })) return undefined;
  const result = rebasePath(path, mapping.remoteRoot, mapping.localRoot);
  return mapping.localRoot === "/" ? result.replace(/^\/+/, "/") : result;
}

const listeners = new Set<() => void>();

/** Subscribe to saved-mapping changes (also other windows), for `useLocalExplorerPath`. */
export function subscribeMappings(listener: () => void): () => void {
  listeners.add(listener);
  // Another window saving a mapping arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The raw stored mappings: a primitive, so it is stable until a mapping is saved. */
export function mappingsSnapshot(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveExplorerMapping(remoteRoot: string, localRoot: string): void {
  const mapping = {
    remoteRoot:
      slash(remoteRoot).replace(/\/+$/, "") + (/^remote:\/\/[^/]+\/$/.test(remoteRoot) ? "/" : ""),
    localRoot: slash(localRoot.trim()),
  };
  if (!valid(mapping))
    throw new Error(
      "Enter an absolute shared or mounted folder path, such as \\\\MacBook\\share\\projects.",
    );
  localStorage.setItem(
    KEY,
    JSON.stringify([
      ...explorerMappings().filter((item) => item.remoteRoot !== mapping.remoteRoot),
      mapping,
    ]),
  );
  for (const notify of listeners) notify();
}

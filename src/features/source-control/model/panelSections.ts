import { useSyncExternalStore } from "react";

/** Optional Source Control sections the owner can hide from the panel's context menu. */
export type GitPanelSection = "stashes" | "graph";
export type GitPanelSections = Readonly<Record<GitPanelSection, boolean>>;

const KEY = "bycoda.gitPanelSections";
const listeners = new Set<() => void>();
let cached: GitPanelSections | null = null;

/** Missing, malformed or unknown values keep every section visible. */
export function parseGitPanelSections(raw: string | null): GitPanelSections {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { stashes: saved.stashes !== false, graph: saved.graph !== false };
}

export function loadGitPanelSections(): GitPanelSections {
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable: defaults apply */
  }
  cached = parseGitPanelSections(raw);
  return cached;
}

export function saveGitPanelSection(section: GitPanelSection, shown: boolean): void {
  cached = { ...loadGitPanelSections(), [section]: shown };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    /* storage unavailable: the choice lasts for this window only */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every open Source Control panel follows the same visibility choice. */
export function useGitPanelSections(): GitPanelSections {
  return useSyncExternalStore(subscribe, loadGitPanelSections, loadGitPanelSections);
}

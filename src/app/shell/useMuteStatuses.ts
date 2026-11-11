import { useMemo } from "react";
import { useLocale } from "../../shared/i18n";
import { pathKey } from "../../shared/lib/paths";
import { notificationMuteStatus } from "../../features/notifications/ui/notificationMuteActions";

/**
 * Mute label per project path. The label text comes from the module `t` and the clock, which
 * React Compiler cannot see change, so the labels are built here on every render (locale
 * subscription included; the preferences hook already re-renders on mute expiry) and the Map
 * keeps its identity while the text is unchanged.
 */
export function useMuteStatuses(
  projects: readonly { id: string; paths: readonly string[] }[],
  preferences: Record<string, Parameters<typeof notificationMuteStatus>[0]>,
): ReadonlyMap<string, string | null> {
  useLocale();
  const entries: [string, string | null][] = [];
  for (const project of projects) {
    const status = notificationMuteStatus(preferences[project.id]);
    for (const path of project.paths) entries.push([pathKey(path), status]);
  }
  const key = JSON.stringify(entries);
  // oxlint-disable-next-line bycoda/compiler-owns-memo -- the compiler guard opts this hook out (labels read the module `t` and the clock), so the Map identity is held by hand
  return useMemo(() => new Map(JSON.parse(key) as [string, string | null][]), [key]);
}

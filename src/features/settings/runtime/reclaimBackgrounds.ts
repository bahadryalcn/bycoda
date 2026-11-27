import { invoke } from "@tauri-apps/api/core";
import { listProjectChatBackgroundPaths } from "../../projects/public/projectChatBackground";
import { readChatBackgroundPathStrict } from "../model/appearance";
import { listAllBackgroundHistoryPaths } from "../model/backgroundHistory";
import { listBackgroundLibrary, type BackgroundLibraryImage } from "../model/backgroundLibrary";
import { loadSavedThemes, type SavedTheme } from "../model/savedThemes";
import { generatorSessionStrings } from "../ui/appearance/controls/themeGeneratorSession";

type ReclaimSources = {
  library: readonly BackgroundLibraryImage[];
  themes: readonly SavedTheme[];
  globalPath: string | null;
  projectPaths: readonly string[];
  historyPaths: readonly string[];
  /** Strings held by the open design/theme generator (drafts, chips, in-flight drawings). */
  sessionStrings: readonly string[];
};

const MAX_PATH = 4096;

/** Every stored file path the app can still reach. Pure so the rule set stays testable. */
export function buildBackgroundKeepSet(sources: ReclaimSources): string[] {
  const keep = new Set<string>();
  const add = (path: string | null | undefined) => {
    if (path && path.length <= MAX_PATH && !path.includes("\n")) keep.add(path);
  };
  for (const image of sources.library) add(image.path);
  // A theme's image is a library entry; resolve it so a stale library listing cannot orphan it.
  const byId = new Map(sources.library.map((image) => [image.id, image.path]));
  for (const theme of sources.themes) {
    if (theme.imageId) add(byId.get(theme.imageId));
    for (const path of theme.backgroundPaths ?? []) add(path);
  }
  add(sources.globalPath);
  sources.projectPaths.forEach(add);
  sources.historyPaths.forEach(add);
  sources.sessionStrings.forEach(add);
  return [...keep];
}

/** The keep set, or `null` when any reference source cannot be read (never sweep on a guess). */
export async function collectBackgroundKeepSet(): Promise<string[] | null> {
  try {
    return buildBackgroundKeepSet({
      library: await listBackgroundLibrary(),
      themes: loadSavedThemes(),
      globalPath: readChatBackgroundPathStrict(),
      projectPaths: listProjectChatBackgroundPaths(),
      historyPaths: listAllBackgroundHistoryPaths(),
      sessionStrings: generatorSessionStrings(),
    });
  } catch (error) {
    console.warn("[backgrounds] reclaim skipped: references unreadable", error);
    return null;
  }
}

let running: Promise<void> | null = null;

/**
 * Removes stored backgrounds nothing references. Fails closed: an unreadable reference source skips
 * the sweep. Concurrent calls share one run; failures are logged, never surfaced.
 */
export function reclaimUnreferencedBackgrounds(): Promise<void> {
  running ??= (async () => {
    const keep = await collectBackgroundKeepSet();
    if (!keep) return;
    const result = await invoke<{ count: number; bytes: number }>("chat_background_reclaim", {
      keep,
    });
    if (result.count > 0) console.info("[backgrounds] reclaimed", result);
  })()
    .catch((error: unknown) => console.warn("[backgrounds] reclaim failed", error))
    .finally(() => {
      running = null;
    });
  return running;
}

/** One sweep a while after startup, once the first screens have settled. */
export function scheduleBackgroundReclaim(delayMs = 45_000): void {
  window.setTimeout(() => void reclaimUnreferencedBackgrounds(), delayMs);
}

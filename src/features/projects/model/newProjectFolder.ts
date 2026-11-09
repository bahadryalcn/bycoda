import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { isRemoteProjectPath } from "./recents";

const KEY = "bycoda.newProjectFolder";
const EVENT = "bycoda:new-project-folder-change";

/** Where new projects are created; `null` lets bycoda choose (see `newProjectParent`). */
export const newProjectFolderSetting = createStoredSetting<string | null>({
  key: KEY,
  fallback: null,
  event: EVENT,
  storageEvents: true,
  parse: (raw) => raw.trim() || null,
  serialize: (value) => value ?? "",
});

const trimSlash = (path: string) => path.replace(/[\\/]+$/, "");
const parentOf = (path: string) => {
  const clean = trimSlash(path.replace(/\\/g, "/"));
  const index = clean.lastIndexOf("/");
  return index > 0 ? clean.slice(0, index) : null;
};

/**
 * The parent folder for a new project: the owner's saved choice, else the folder most of
 * the local projects already share, else `<home>/Projects`. Remote projects never count.
 */
export function newProjectParent(
  chosen: string | null,
  projectPaths: readonly string[],
  home: string,
): string {
  if (chosen?.trim()) return trimSlash(chosen.trim());
  const counts = new Map<string, { path: string; count: number }>();
  for (const path of projectPaths) {
    if (isRemoteProjectPath(path)) continue;
    const parent = parentOf(path);
    if (!parent) continue;
    const key = parent.toLowerCase();
    const entry = counts.get(key) ?? { path: parent, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { path: string; count: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best && best.count > 1 ? best.path : `${trimSlash(home.replace(/\\/g, "/"))}/Projects`;
}

/** "Snake Game!" -> "snake-game". Letters of any language are kept; separators collapse. */
export function projectFolderName(name: string): string {
  const folder = name
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    // oxlint-disable-next-line no-control-regex -- control characters are invalid in folder names
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)
    .replace(/[-.]+$/g, "");
  if (!folder || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(folder))
    throw new Error("Choose a project name with letters or numbers.");
  return folder;
}

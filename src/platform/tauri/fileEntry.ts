import { invoke, isTauri } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";
import { REMOTE_PATH_PREFIX } from "../../shared/lib/remotePaths";

/** Preserve native entry spelling; normalization alone cannot prove file identity. */
export async function resolveFileEntrySpelling(path: string): Promise<string> {
  if (!IS_MAC || !isTauri() || path.startsWith(REMOTE_PATH_PREFIX) || !/\P{ASCII}/u.test(path))
    return path;
  return invoke<string>("resolve_file_entry_spelling", { path });
}

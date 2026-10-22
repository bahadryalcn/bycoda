import { invoke, isTauri } from "@tauri-apps/api/core";
import { getLocale } from "../../shared/i18n";

export type FileAccessMode = "unconfigured" | "all-files" | "selected-folders";

export function getFileAccessMode(): Promise<FileAccessMode> {
  return isTauri()
    ? invoke<FileAccessMode>("get_file_access_mode")
    : Promise.resolve("selected-folders");
}

export function configureFileAccess(review = false): Promise<FileAccessMode> {
  return isTauri()
    ? invoke<FileAccessMode>("configure_file_access", { review, language: getLocale() })
    : Promise.resolve("selected-folders");
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";

export async function pickAndSaveChatBackground(): Promise<string | null> {
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: t("Choose background"),
    filters: [
      {
        name: t("Backgrounds"),
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "html", "htm"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  return saveChatBackgroundFrom(sourcePath);
}

/** Copies an image the user dropped or picked into the app store; the Host validates the file. */
export function saveChatBackgroundFrom(sourcePath: string): Promise<string> {
  return invoke<string>("save_chat_background", { sourcePath });
}

export function removeChatBackground(): Promise<void> {
  return invoke<void>("remove_chat_background");
}

export async function pickAndSaveProjectChatBackground(project: string): Promise<string | null> {
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: t("Choose background"),
    filters: [
      {
        name: t("Backgrounds"),
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "html", "htm"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  return invoke<string>("save_project_chat_background", {
    project,
    sourcePath,
  });
}

export function clearProjectChatBackground(project: string): Promise<void> {
  return invoke<void>("remove_project_chat_background", { project });
}

export function projectChatBackgroundSrc(path: string, revision: number): string {
  return `${convertFileSrc(path)}?v=${revision}`;
}

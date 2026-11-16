import { convertFileSrc } from "@tauri-apps/api/core";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import { t } from "../../../shared/i18n";

/** Probe the actual WebView codec before committing a selection. No playback or retained decoder. */
export async function validateChatBackgroundMedia(path: string): Promise<void> {
  const kind = chatBackgroundKind(path);
  if (kind === "html") return; // Native import bounds UTF-8; code runs only in the offline sandbox.
  const video = kind === "video" ? document.createElement("video") : null;
  const media = video ?? new Image();
  await new Promise<void>((resolve, reject) => {
    const readyEvent = video ? "loadeddata" : "load";
    const cleanup = () => {
      clearTimeout(timeout);
      media.removeEventListener(readyEvent, ready);
      media.removeEventListener("error", failed);
      video?.pause();
      media.removeAttribute("src");
      video?.load();
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error(t("Background could not be loaded. Choose another file.")));
    };
    const timeout = window.setTimeout(failed, 10_000);
    media.addEventListener(readyEvent, ready, { once: true });
    media.addEventListener("error", failed, { once: true });
    if (video) {
      video.muted = true;
      video.preload = "auto";
    }
    media.src = convertFileSrc(path);
  });
}

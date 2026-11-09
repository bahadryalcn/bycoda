import { t } from "../../../../shared/i18n";
import type { MediaProbe } from "./contentDraft";

/**
 * Reads duration and pixel size from a local video file. The file never leaves the browser here;
 * the Host receives only the values the platform fields need. Frame rate is not readable in the
 * browser, so the owner enters it (see FacebookReelFields).
 */
export function probeVideo(file: File): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (result: MediaProbe | Error) => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish({
        durationSeconds:
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    video.onerror = () => finish(new Error(t("The video could not be read.")));
    video.src = url;
  });
}

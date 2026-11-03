import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens a link in the system browser without leaving a rejected promise behind.
 * Failures are logged; callers that can show an error pass `onError`.
 */
export function openUrlSafely(url: string, onError?: (error: unknown) => void): void {
  void openUrl(url).catch((error: unknown) => {
    console.error("Failed to open web link:", error);
    onError?.(error);
  });
}

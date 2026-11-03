import { t } from "../../../shared/i18n";
import { IS_MAC } from "../../../platform/tauri/platform";

/** The operating system or browser refused microphone capture. */
const BLOCKED_NAMES = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);

/**
 * Copy for a blocked microphone. On macOS the grant lives in System Settings and
 * is attributed to the app, so the message names the exact pane.
 */
export function microphoneBlockedMessage(): string {
  return IS_MAC
    ? t(
        "Microphone access is blocked. Allow bycoda in System Settings > Privacy & Security > Microphone, then try again.",
      )
    : t(
        "Microphone access is blocked. Allow it in your system or browser settings, then try again.",
      );
}

/** Whether a surfaced error is the blocked-microphone message on macOS. */
export function isMacMicrophoneBlocked(message: string): boolean {
  return IS_MAC && message === microphoneBlockedMessage();
}

/**
 * Opens the microphone and turns a refusal into an actionable error. The error
 * keeps the `NotAllowedError` name so reconnect logic still treats it as an
 * owner action rather than a transient failure.
 */
export async function openMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (!BLOCKED_NAMES.has(name)) throw cause;
    const error = new Error(microphoneBlockedMessage());
    error.name = "NotAllowedError";
    throw error;
  }
}

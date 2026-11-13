import { systemPermissionsStatus } from "../../../platform/tauri/systemPermissions";
import { t } from "../../../shared/i18n";
import { isTauri } from "@tauri-apps/api/core";
import { IS_LINUX, IS_MAC, IS_WIN } from "../../../platform/tauri/platform";

/** The operating system or browser refused microphone capture. */
const BLOCKED_NAMES = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);

/**
 * Capture permission belongs to the OS/browser, separately from feature toggles.
 * A settings launch never establishes that the owner granted permission.
 */
export function microphoneBlockedMessage(): string {
  if (!isTauri())
    return t(
      "Microphone access is blocked. Allow this site in your browser's microphone permissions, check system microphone access, then try again.",
    );
  if (IS_MAC)
    return t(
      "Microphone access is blocked. Allow bycoda in System Settings > Privacy & Security > Microphone, then try again.",
    );
  if (IS_WIN)
    return t(
      "Microphone access is blocked. In Windows Settings > Privacy & security > Microphone, allow microphone access and desktop apps, then try again.",
    );
  if (IS_LINUX)
    return t(
      "Microphone access is blocked. Check your system sound input and app or sandbox microphone permissions, then try again.",
    );
  return t(
    "Microphone access is blocked. Allow it in your system or browser settings, then try again.",
  );
}

/** Only native macOS/Windows have an allowlisted microphone settings route. */
export function canOpenMicrophoneSettings(): boolean {
  return isTauri() && (IS_MAC || IS_WIN);
}

export function webviewMicrophoneBlockedMessage(): string {
  return t(
    "The operating system allows the microphone, but the app webview blocked it. Check again to retry microphone capture.",
  );
}

export function isMicrophoneBlocked(message: string): boolean {
  return message === microphoneBlockedMessage();
}

/** Whether a surfaced error is the blocked-microphone message on macOS. */
export function isMacMicrophoneBlocked(message: string): boolean {
  return IS_MAC && isMicrophoneBlocked(message);
}

/**
 * Opens the microphone and turns a refusal into an actionable error. The error
 * keeps the `NotAllowedError` name so reconnect logic still treats it as an
 * owner action rather than a transient failure.
 */
export async function openMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error(
      t("Microphone access requires the desktop app or a secure browser context."),
    );
    error.name = "NotSupportedError";
    throw error;
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (cause) {
    // DOMException can originate in another realm; do not depend on instanceof.
    const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "";
    let message: string;
    if (BLOCKED_NAMES.has(name)) {
      const native = isTauri() ? await systemPermissionsStatus().catch(() => undefined) : undefined;
      message =
        native?.entries.find((entry) => entry.id === "microphone")?.state === "granted"
          ? webviewMicrophoneBlockedMessage()
          : microphoneBlockedMessage();
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError")
      message = t(
        "No microphone was found. Connect or enable an input device in system sound settings, then try again.",
      );
    else if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
      message = t(
        "The microphone could not start. Close other apps using it, check the input device in system sound settings, then try again.",
      );
    else if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
      message = t(
        "The selected microphone is unavailable. Select another input device or reconnect it, then try again.",
      );
    else throw cause;
    const error = new Error(message);
    error.name = BLOCKED_NAMES.has(name) ? "NotAllowedError" : name;
    throw error;
  }
}

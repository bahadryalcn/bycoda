import { PermissionRecoveryAction } from "../../permissions";
import { canOpenMicrophoneSettings, isMicrophoneBlocked } from "../model/microphoneAccess";

/** OS recovery is never offered for a webview refusal after an OS grant. */
export function MicrophoneRecoveryAction({ message }: { message: string }) {
  return canOpenMicrophoneSettings() && isMicrophoneBlocked(message) ? (
    <PermissionRecoveryAction id="microphone" />
  ) : null;
}

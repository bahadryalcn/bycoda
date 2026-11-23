import { PermissionRecoveryAction } from "../../permissions";
import { openSettingsSection } from "../../settings/public/settingsLink";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Text } from "../../../shared/ui/Text";
import { canOpenMicrophoneSettings, isMicrophoneBlocked } from "../model/microphoneAccess";

const SETUP_REFUSAL = /^(?:Error: )?(?:Host rejected request: )?Voice setup is incomplete:\s*/i;

/** Matches the setup refusal from both old and current Hosts, including the bridge prefix. */
export function isVoiceSetupError(message: string) {
  return SETUP_REFUSAL.test(message);
}

export function VoiceRecoveryAction({ message }: { message: string }) {
  if (!isVoiceSetupError(message)) return <MicrophoneRecoveryAction message={message} />;
  const detail = message.replace(SETUP_REFUSAL, "").split(". Open Settings", 1)[0];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Button onClick={() => openSettingsSection("voice")}>{t("Voice settings")}</Button>
      {detail ? (
        <InfoPopover label={t("Technical details")}>
          <Text as="p" size="caption" tone="secondary">
            {detail}
          </Text>
        </InfoPopover>
      ) : null}
    </span>
  );
}

/** OS recovery is never offered for a webview refusal after an OS grant. */
export function MicrophoneRecoveryAction({ message }: { message: string }) {
  return canOpenMicrophoneSettings() && isMicrophoneBlocked(message) ? (
    <PermissionRecoveryAction id="microphone" />
  ) : null;
}

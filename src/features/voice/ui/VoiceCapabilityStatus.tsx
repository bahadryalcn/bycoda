import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Row } from "../../settings/public/settingsControls";
import { CapabilityStatus } from "../../../shared/ui/CapabilityStatus";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../model/voiceActivity";

export function VoiceCapabilityStatus({
  enabled,
  checked,
  busy,
  installing,
  ready,
  failed,
}: {
  enabled: boolean;
  checked: boolean;
  busy: boolean;
  installing: boolean;
  ready: boolean;
  failed: boolean;
}) {
  const active = useSyncExternalStore(
    subscribeVoiceConversationActivity,
    isVoiceConversationActive,
    () => false,
  );
  return (
    <Row label={t("Status")}>
      <CapabilityStatus
        permission={enabled ? "enabled" : "disabled"}
        readiness={
          failed
            ? "unknown"
            : busy || installing
              ? "checking"
              : checked
                ? ready
                  ? "ready"
                  : "unavailable"
                : "unknown"
        }
        // A local live claim proves activity; its absence cannot prove another window idle.
        activity={active ? "running" : "unknown"}
      />
    </Row>
  );
}
